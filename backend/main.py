"""ComposureIQ Event Spine — FastAPI.

Endpoints
  POST /api/telemetry        watch -> server, 1 Hz; response carries live stage state
  POST /api/mic              browser voice-activity {speaking, level}
  POST /api/transcript       browser speech text {text, final}
  POST /api/control          presenter overrides {action}
  GET  /api/session          full session history (flight recorder replay)
  GET  /api/calendar         mocked upcoming calendar event
  WS   /ws/flight-recorder   live broadcast of telemetry/transcript/callout/stage events
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import itertools
import json
import math
import os
import shutil
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import wave

import speech_recognition as sr
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import correlation
import physics

WATCH_TIMEOUT_S = 3.0
MIC_TIMEOUT_S = 2.0
STRESS_DECAY_PER_S = 0.025


class Stage:
    def __init__(self):
        self.reset()

    def reset(self):
        self.session_start = time.time()
        self.mic_speaking = False
        self.mic_level = 0.0
        self.mic_last = 0.0
        self.stress = 0.0
        self.geofence_override = False
        self.phase_override: str | None = None
        self.force_pacer = False
        self.force_requested_at = None
        self.last_watch = 0.0
        self.sim_speaking_until = 0.0
        self.sim_speaking_level = 0.0
        self.finish_override = False
        self.primer_started_at = None
        self.speaker_mode: str = "auto"
        self.pitch_profile: dict = {"interviewer": None, "candidate": None}
        self.active_answer_id: int | None = None
        self.utterance_started_at: float | None = None
        self.phase = "IDLE"
        self.gate = "LISTENING"
        self.telemetry: list[dict] = []
        self.transcript: list[dict] = []
        self.callouts: list[dict] = []
        self.events: list[dict] = []
        self.pending_q: list[dict] = []
        self.ids = itertools.count(1)
        self.physics = physics.PhysicsState()

    def t(self) -> float:
        return round(time.time() - self.session_start, 2)

    @property
    def live_mic_speaking(self) -> bool:
        return self.mic_speaking and time.time() - self.mic_last < MIC_TIMEOUT_S

    @property
    def speaking(self) -> bool:
        if self.speaker_mode == "interviewer":
            return time.time() < self.sim_speaking_until
        return self.live_mic_speaking or time.time() < self.sim_speaking_until

    @property
    def effective_mic_level(self) -> float:
        now = time.time()
        if now < self.sim_speaking_until:
            return round(0.45 + 0.35 * abs(math.sin(now * 6.5)), 3)
        if self.live_mic_speaking:
            return self.mic_level
        return 0.0

    @property
    def watch_connected(self) -> bool:
        return time.time() - self.last_watch < WATCH_TIMEOUT_S

    def calendar_event(self) -> dict:
        return {
            "title": "Senior SWE Onsite — Platform Calgary",
            "lat": physics.CALGARY[0],
            "lon": physics.CALGARY[1],
            "radius_m": 100,
            "start_epoch": int(self.session_start + 10 * 60),
        }

    def stage_response(self) -> dict:
        return {
            "mic_speaking": self.speaking,
            "stress_modulator": round(self.stress, 3),
            "geofence_override": self.geofence_override,
            "phase_override": self.phase_override,
            "force_pacer": self.force_pacer,
            "calendar_event": self.calendar_event(),
        }

    def stage_snapshot(self) -> dict:
        return {
            **self.stage_response(),
            "watch_connected": self.watch_connected,
            "mic_level": round(self.effective_mic_level, 3),
            "sim_speaking": time.time() < self.sim_speaking_until,
            "speaker_mode": self.speaker_mode,
            "phase": self.phase,
            "gate": self.gate,
            "force_pending": self.force_requested_at is not None,
            "t": self.t(),
        }


S = Stage()
app = FastAPI(title="ComposureIQ")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Hub:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def broadcast(self, msg: dict):
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()


async def log_event(kind: str, label: str, **extra):
    ev = {"id": next(S.ids), "t": S.t(), "kind": kind, "label": label, **extra}
    S.events.append(ev)
    await hub.broadcast({"type": "event", "data": ev})


PHASE_LABEL = {"IDLE": "Baseline", "PRIMER": "Primer", "LIVE": "Live Interview", "DONE": "Debrief"}
PHASE_GRAPH_LABEL = {
    "IDLE": "Baseline Standby",
    "PRIMER": "Primer Started",
    "LIVE": "Interview Started",
    "DONE": "Interview Complete",
}


def phase_reason(prev: str, new: str, x: dict) -> str:
    """Plain-language reason for a stage change, inferred from the sample that caused it."""
    if len(S.telemetry) <= 1 and new != "IDLE":
        return f"Starting in {PHASE_LABEL.get(new, new)} stage."
    if new == "PRIMER":
        return "Started 10 s physiological sigh breathing primer to elevate HRV before the interview."
    if new == "LIVE":
        if prev == "PRIMER":
            if S.speaking:
                return "Starting interview — voice detected during primer, entering dim Stealth Mode."
            rm = x.get("rmssd")
            if rm is not None and rm >= 55:
                return f"Starting interview — HRV recovered to {rm:.0f} ms (55 ms+ target), entering Stealth Mode."
        return "Starting interview — watch dimmed to Stealth Mode and armed the Listening Gate."
    if new == "DONE":
        return "Interview finished — post-interview debrief and habit scorecard ready."
    return "Baseline calibration standby."


async def pacer_decision(x: dict):
    """Explain why the pacer did or did not fire when an answer ended."""
    peak = x.get("peak_hr")
    if peak is None:
        hs = [r["hr"] for r in reversed(S.telemetry[:-1]) if r.get("gate") == "SPEAKING" and r.get("hr") is not None][:60]
        peak = max(hs) if hs else x.get("hr", 0)
    base = x.get("baseline_hr") or physics.BASELINE_HR
    delta = peak - base
    fired = bool(x.get("pacer_fired"))
    if fired:
        reason = (f"Answer ended. HR peaked at {peak:.0f} bpm, {delta:+.0f} over your {base:.0f} bpm baseline "
                  f"(limit +{physics.PACER_HR_DELTA:.0f}), so the pacer fired once you had been still for 2.5 s.")
    elif x.get("phase") != "LIVE":
        reason = "Pacer skipped: it only runs during the Live stage."
    else:
        reason = (f"Pacer skipped: HR peaked at {peak:.0f} bpm, only {delta:+.0f} over your {base:.0f} bpm "
                  f"baseline. It needs more than +{physics.PACER_HR_DELTA:.0f}.")
    await log_event("pacer_decision", "Pacer fired" if fired else "Pacer skipped", fired=fired,
                    peak=round(peak, 1), baseline=round(base, 1), delta=round(delta, 1), reason=reason)


async def ingest(sample: dict):
    sample["t"] = S.t()
    sample.setdefault("mic_level", round(S.effective_mic_level, 3))
    prev_phase, prev_gate = S.phase, S.gate
    S.phase = sample.get("phase", S.phase)
    S.gate = sample.get("gate", S.gate)
    S.telemetry.append(sample)
    await hub.broadcast({"type": "telemetry", "data": sample})
    if S.phase != prev_phase:
        await log_event(
            "phase",
            f"Stage: {PHASE_LABEL.get(S.phase, S.phase)}",
            phase=S.phase,
            graph_label=PHASE_GRAPH_LABEL.get(S.phase, S.phase),
            reason=phase_reason(prev_phase, S.phase, sample),
        )
    if S.gate != prev_gate:
        await log_event("gate", f"{S.gate.title()} gate")
        if prev_gate == "SPEAKING" and S.gate == "LISTENING" and not sample.get("pacer_forced"):
            await pacer_decision(sample)
    if sample.get("pacer_fired"):
        forced = bool(sample.get("pacer_forced")) or S.force_requested_at is not None
        if forced:
            S.force_requested_at = None
        await log_event("pacer", "60-BPM pacer fired" + (" (forced)" if forced else ""), forced=forced,
                        reason="Forced from the presenter bar or watch menu." if forced else None)
    if sample.get("pacer_fired") or (prev_gate == "SPEAKING" and S.gate == "LISTENING"):
        now_t = S.t()
        for entry in reversed(S.transcript):
            if now_t - entry["t"] > 15.0:
                break
            if entry.get("kind") == "answer":
                entry["metrics"] = correlation.answer_metrics(
                    entry.get("t_start", max(0.0, entry["t"] - 4.0)),
                    now_t,
                    S.telemetry,
                    S.events,
                )
                await hub.broadcast({"type": "transcript_update", "data": entry})
                break


# ---------------------------------------------------------------- watch API
class Telemetry(BaseModel):
    model_config = {"extra": "allow"}


@app.post("/api/telemetry")
async def telemetry(body: Telemetry):
    S.last_watch = time.time()
    sample = body.model_dump()
    sample.setdefault("source", "watch")
    if S.phase_override and sample.get("phase") != S.phase_override:
        sample["phase"] = S.phase_override
    mot = physics.compute_motion(S.t(), S.speaking, S.stress)
    sample["gyro_mag"] = round(mot["gyro_mag"], 1)
    sample["pitch"] = round(mot["pitch"], 1)
    sample["roll"] = round(mot["roll"], 1)
    sample["fidget_index"] = round(mot["fidget_index"], 1)
    if S.speaking or sample.get("accel_var") is None or sample.get("accel_var", 0) < 50:
        sample["accel_var"] = round(mot["accel_var"], 1)
    base_hr = sample.get("baseline_hr") or physics.BASELINE_HR
    hr_v = sample.get("hr")
    rmssd_v = sample.get("rmssd") if sample.get("rmssd") is not None else 50.0
    spo2_v = sample.get("spo2") if sample.get("spo2") is not None else 97.5
    if hr_v is not None:
        sample["composure_index"] = round(
            max(0.0, min(100.0, 100.0 - 0.9 * max(0.0, hr_v - base_hr) - 0.35 * sample["fidget_index"]
                         - 4.0 * max(0.0, 97.5 - spo2_v) + 0.25 * (rmssd_v - 40.0))),
            1,
        )
    await ingest(sample)
    resp = S.stage_response()
    if S.phase_override:
        S.phase_override = None  # one-shot, consumed by the watch
    if S.force_pacer:
        S.force_pacer = False  # one-shot, consumed by the watch
        await log_event("pacer_debug", "Force pacer delivered to watch",
                        reason="Sent in this 1 Hz sync reply. The watch reports the pulse on its next sync.")
    return resp


@app.get("/api/calendar")
async def calendar():
    return S.calendar_event()


# ---------------------------------------------------------------- browser API
class Mic(BaseModel):
    speaking: bool
    level: float = 0.0
    speaker_mode: str | None = None


@app.post("/api/mic")
async def mic(body: Mic):
    if body.speaker_mode in ("auto", "interviewer", "candidate"):
        S.speaker_mode = body.speaker_mode
    was_live = S.live_mic_speaking
    S.mic_speaking, S.mic_level, S.mic_last = body.speaking, body.level, time.time()
    if body.speaking and not was_live:
        S.utterance_started_at = S.t()
        await log_event("voice", "Voice start")
    elif not body.speaking and was_live:
        await log_event("voice", "Voice stop")
    return {"ok": True}


class Transcript(BaseModel):
    text: str
    final: bool = True
    speaker_mode: str | None = None
    pitch_hz: float | None = None
    t_start: float | None = None
    t_end: float | None = None
    engine: str = "web-speech"


async def record_transcript_text(
    text: str,
    speaker_mode: str | None = None,
    pitch_hz: float | None = None,
    t_start: float | None = None,
    t_end: float | None = None,
    engine: str = "web-speech",
) -> list[dict]:
    mode = speaker_mode if speaker_mode in ("auto", "interviewer", "candidate") else S.speaker_mode
    now_t = S.t()
    t_end_val = t_end if t_end is not None else now_t
    t_start_val = (
        t_start
        if t_start is not None
        else (S.utterance_started_at if S.utterance_started_at is not None else max(0.0, t_end_val - 3.0))
    )
    watch_moving = bool(
        S.telemetry
        and S.telemetry[-1].get("source") == "watch"
        and (S.telemetry[-1].get("accel_var") or 0) > 2500
    )

    entries: list[dict] = []
    for sent in correlation.split_sentences(text):
        last_turn_kind = S.transcript[-1].get("kind") if S.transcript else None
        cls = correlation.classify_utterance(
            sent,
            speaker_mode=mode,
            last_turn_kind=last_turn_kind,
            pitch_hz=pitch_hz,
            pitch_profile=S.pitch_profile,
            watch_moving=watch_moving,
        )
        sp = cls["speaker"]
        if pitch_hz and 65 <= pitch_hz <= 400:
            prev_hz = S.pitch_profile.get(sp)
            S.pitch_profile[sp] = pitch_hz if prev_hz is None else (0.7 * prev_hz + 0.3 * pitch_hz)

        metrics = (
            correlation.answer_metrics(t_start_val, t_end_val, S.telemetry, S.events)
            if cls["kind"] == "answer"
            else None
        )
        entry = {
            "id": next(S.ids),
            "t": t_end_val,
            "t_start": t_start_val,
            "text": cls["text"],
            "kind": cls["kind"],
            "is_question": cls["is_question"],
            "speaker": sp,
            "speaker_label": cls["speaker_label"],
            "format_tag": cls["format_tag"],
            "pitch_hz": round(pitch_hz, 1) if pitch_hz else None,
            "engine": engine,
            "metrics": metrics,
        }
        S.transcript.append(entry)
        await hub.broadcast({"type": "transcript", "data": entry})
        entries.append(entry)

        if cls["is_question"]:
            S.stress = max(S.stress, 0.85)
            S.pending_q.append(entry)
        else:
            S.active_answer_id = entry["id"]
            if not S.live_mic_speaking and engine != "demo":
                S.sim_speaking_until = max(S.sim_speaking_until, time.time() + 2.0)

    S.utterance_started_at = None
    return entries


@app.post("/api/transcript")
async def transcript(body: Transcript):
    text = body.text.strip()
    if not text:
        return {"ok": False}
    if not body.final:
        await hub.broadcast({
            "type": "interim",
            "data": {
                "t": S.t(),
                "text": text,
                "speaker_mode": body.speaker_mode or S.speaker_mode,
            },
        })
        return {"ok": True}
    entries = await record_transcript_text(
        text,
        speaker_mode=body.speaker_mode,
        pitch_hz=body.pitch_hz,
        t_start=body.t_start,
        t_end=body.t_end,
        engine=body.engine,
    )
    return {"ok": True, "is_question": any(e["is_question"] for e in entries), "entries": entries}


class AudioTranscribe(BaseModel):
    audio_b64: str
    pitch_hz: float | None = None
    t_start: float | None = None
    t_end: float | None = None
    speaker_mode: str | None = None


def _normalize_wav_bytes(wav_bytes: bytes) -> tuple[bytes, int]:
    """Scale quiet 16-bit PCM speech up cleanly before encoding to FLAC."""
    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
        nchannels = w.getnchannels()
        sampwidth = w.getsampwidth()
        framerate = w.getframerate()
        frames = w.readframes(w.getnframes())

    if sampwidth != 2 or len(frames) < 2:
        return wav_bytes, framerate

    count = len(frames) // 2
    samples = struct.unpack(f"<{count}h", frames[: count * 2])
    peak = max((abs(s) for s in samples), default=0)
    if 250 <= peak < 24000:
        gain = 27500.0 / peak
        scaled = [max(-32768, min(32767, int(round(s * gain)))) for s in samples]
        frames = struct.pack(f"<{count}h", *scaled)

    out_buf = io.BytesIO()
    with wave.open(out_buf, "wb") as out_w:
        out_w.setnchannels(nchannels)
        out_w.setsampwidth(sampwidth)
        out_w.setframerate(framerate)
        out_w.writeframes(frames)
    return out_buf.getvalue(), framerate


def _stt_wav_bytes(wav_bytes: bytes) -> str | None:
    """Transcode normalized WAV to 44.1 kHz FLAC via macOS afconvert (avoids 32-bit flac-mac crash and 16 kHz blocksize rejection)."""
    norm_wav, _ = _normalize_wav_bytes(wav_bytes)
    afconvert = shutil.which("afconvert")
    if not afconvert:
        recognizer = sr.Recognizer()
        with sr.AudioFile(io.BytesIO(norm_wav)) as src:
            audio_data = recognizer.record(src)
        return recognizer.recognize_google(audio_data, language="en-US")

    with tempfile.TemporaryDirectory() as tmpdir:
        wav_path = os.path.join(tmpdir, "utterance.wav")
        flac_path = os.path.join(tmpdir, "utterance.flac")
        with open(wav_path, "wb") as f:
            f.write(norm_wav)

        proc = subprocess.run(
            [afconvert, "-f", "flac", "-d", "flac@44100", wav_path, flac_path],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if proc.returncode != 0 or not os.path.exists(flac_path):
            raise RuntimeError(f"afconvert failed ({proc.returncode}): {proc.stderr.strip()}")

        with open(flac_path, "rb") as f:
            flac_bytes = f.read()

    params = urllib.parse.urlencode(
        {
            "client": "chromium",
            "lang": "en-US",
            "key": "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw",
            "pFilter": 0,
        }
    )
    url = f"http://www.google.com/speech-api/v2/recognize?{params}"
    req = urllib.request.Request(
        url,
        data=flac_bytes,
        headers={"Content-Type": "audio/x-flac; rate=44100"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            response_text = resp.read().decode("utf-8")
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        raise sr.RequestError(f"recognition connection failed: {e}") from e

    alternatives: list[dict] = []
    for line in response_text.splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        result = payload.get("result") or []
        if result and result[0].get("alternative"):
            alternatives.extend(result[0]["alternative"])

    transcript_choices = [a for a in alternatives if a.get("transcript")]
    if not transcript_choices:
        raise sr.UnknownValueError()

    best = max(transcript_choices, key=lambda a: a.get("confidence", 0.5))
    return best["transcript"]


@app.post("/api/transcribe-audio")
async def transcribe_audio(body: AudioTranscribe):
    try:
        wav_bytes = base64.b64decode(body.audio_b64)
    except Exception as e:
        print(f"[STT] invalid audio payload: {e}", flush=True)
        return {"ok": False, "error": f"invalid audio payload: {e}"}

    try:
        text = await asyncio.to_thread(_stt_wav_bytes, wav_bytes)
    except sr.UnknownValueError:
        return {"ok": False, "error": "no speech recognized"}
    except sr.RequestError as e:
        print(f"[STT] unavailable: {e}", flush=True)
        return {"ok": False, "error": f"stt unavailable: {e}"}
    except Exception as e:
        print(f"[STT] error: {e}", flush=True)
        return {"ok": False, "error": f"stt error: {e}"}

    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "empty transcription"}

    now_t = S.t()
    norm = " ".join(text.lower().split())
    for prev in S.transcript[-3:]:
        if now_t - prev["t"] <= 3.5 and " ".join(prev["text"].lower().split()) == norm:
            return {"ok": True, "deduped": True, "text": text, "entries": []}

    entries = await record_transcript_text(
        text,
        speaker_mode=body.speaker_mode,
        pitch_hz=body.pitch_hz,
        t_start=body.t_start,
        t_end=body.t_end,
        engine="backend-stt",
    )
    return {"ok": True, "text": text, "entries": entries}


class Control(BaseModel):
    action: str
    text: str | None = None
    phase: str | None = None
    duration: float | None = None
    speaker_mode: str | None = None
    id: int | None = None


@app.post("/api/control")
async def control(body: Control):
    a = body.action
    if a == "venue_arrival":
        prev = S.phase
        S.geofence_override = True
        S.phase_override = "PRIMER"
        S.phase = "PRIMER"
        S.physics.phase = "PRIMER"
        S.physics.primer_started = time.time()
        await log_event(
            "phase",
            f"Stage: {PHASE_LABEL['PRIMER']}",
            phase="PRIMER",
            graph_label=PHASE_GRAPH_LABEL["PRIMER"],
            reason=phase_reason(prev, "PRIMER", S.telemetry[-1] if S.telemetry else {}),
        )
    elif a == "set_phase":
        target = (body.phase or "IDLE").upper()
        if target not in ("IDLE", "PRIMER", "LIVE", "DONE"):
            return {"ok": False, "error": f"unknown phase {target}"}
        prev = S.phase
        S.phase_override = target
        S.phase = target
        S.physics.phase = target
        if target == "PRIMER":
            S.geofence_override = True
            S.physics.primer_started = time.time()
            S.physics.lat, S.physics.lon = physics.CALGARY[0] + 0.0002, physics.CALGARY[1]
        elif target == "IDLE":
            S.geofence_override = False
            S.physics.lat, S.physics.lon = physics.CALGARY[0] + 0.004, physics.CALGARY[1]
            S.physics.primer_started = None
        await log_event(
            "phase",
            f"Stage: {PHASE_LABEL.get(target, target)}",
            phase=target,
            graph_label=PHASE_GRAPH_LABEL.get(target, target),
            reason=phase_reason(prev, target, S.telemetry[-1] if S.telemetry else {}),
        )
    elif a == "simulate_answer":
        dur = float(body.duration or 6.0)
        if S.phase in ("IDLE", "PRIMER"):
            S.phase = "LIVE"
            S.physics.phase = "LIVE"
            S.phase_override = "LIVE"
        S.stress = max(S.stress, 0.9)
        S.sim_speaking_until = time.time() + dur
        if body.text:
            await record_transcript_text(
                body.text,
                speaker_mode="candidate",
                t_start=S.t(),
                t_end=S.t() + dur,
                engine="demo",
            )
        await log_event(
            "control",
            f"Simulated {dur:.0f}s spoken answer (Speaking Gate open -> 2.5s stillness -> Pacer)",
        )
    elif a == "set_speaker_mode":
        if body.speaker_mode in ("auto", "interviewer", "candidate"):
            S.speaker_mode = body.speaker_mode
            await hub.broadcast({"type": "stage", "data": S.stage_snapshot()})
    elif a == "toggle_transcript_kind":
        if body.id is None:
            return {"ok": False, "error": "missing transcript id"}
        target_entry = next((e for e in S.transcript if e["id"] == body.id), None)
        if not target_entry:
            return {"ok": False, "error": f"transcript {body.id} not found"}
        new_q = not bool(target_entry.get("is_question"))
        target_entry["is_question"] = new_q
        target_entry["kind"] = "question" if new_q else "answer"
        target_entry["speaker"] = "interviewer" if new_q else "candidate"
        target_entry["speaker_label"] = "Interviewer" if new_q else "You"
        target_entry["format_tag"] = "Direct Question ?" if new_q else "Candidate Answer"
        if new_q:
            target_entry["metrics"] = None
            if target_entry not in S.pending_q:
                S.pending_q.append(target_entry)
            S.stress = max(S.stress, 0.75)
        else:
            S.pending_q = [q for q in S.pending_q if q["id"] != target_entry["id"]]
            target_entry["metrics"] = correlation.answer_metrics(
                target_entry.get("t_start", max(0.0, target_entry["t"] - 4.0)),
                target_entry["t"],
                S.telemetry,
                S.events,
            )
        await hub.broadcast({"type": "transcript_update", "data": target_entry})
    elif a == "evaluate_now":
        targets = list(S.pending_q)
        if targets:
            S.pending_q.clear()
        else:
            flagged_ids = {c.get("question_id") for c in S.callouts}
            unflagged = [q for q in S.transcript if q.get("is_question") and q["id"] not in flagged_ids]
            if unflagged:
                targets = [unflagged[-1]]
            else:
                qs = [q for q in S.transcript if q.get("is_question")]
                if qs:
                    targets = [qs[-1]]
        evaluated = 0
        for q in targets:
            c = correlation.evaluate(q, S.telemetry, force=True)
            if c:
                c["id"] = next(S.ids)
                S.callouts.append(c)
                await hub.broadcast({"type": "callout", "data": c})
                evaluated += 1
        return {"ok": True, "evaluated": evaluated, "stage": S.stage_snapshot()}
    elif a == "stress_question":
        text = body.text or "Tell me about a time a production deployment failed."
        entry = {
            "id": next(S.ids),
            "t": S.t(),
            "t_start": S.t(),
            "text": text,
            "kind": "question",
            "is_question": True,
            "speaker": "interviewer",
            "speaker_label": "Interviewer",
            "format_tag": "Behavioral Prompt",
            "pitch_hz": None,
            "engine": "stage-preset",
            "metrics": None,
        }
        S.transcript.append(entry)
        S.pending_q.append(entry)
        S.stress = 0.95
        await hub.broadcast({"type": "transcript", "data": entry})
        await log_event("control", "High-stress question injected")
    elif a == "force_pacer":
        S.force_pacer = True
        S.force_requested_at = time.time()
        await log_event("pacer_debug", "Force pacer requested",
                        reason=("Queued for the watch's next sync." if S.watch_connected
                                else "No watch connected, so the backend simulator will fire it."))
    elif a == "calm":
        S.stress = 0.0
        await log_event("control", "Stress reset")
    elif a == "reset":
        clients = hub.clients
        S.reset()
        hub.clients = clients
        await hub.broadcast({"type": "reset"})
    else:
        return {"ok": False, "error": f"unknown action {a}"}
    return {"ok": True, "stage": S.stage_snapshot()}


@app.get("/api/session")
async def session():
    return {
        "stage": S.stage_snapshot(),
        "telemetry": S.telemetry,
        "transcript": S.transcript,
        "callouts": S.callouts,
        "events": S.events,
    }


@app.websocket("/ws/flight-recorder")
async def ws_flight_recorder(ws: WebSocket):
    await ws.accept()
    hub.clients.add(ws)
    try:
        await ws.send_json({"type": "hello", "data": {"stage": S.stage_snapshot()}})
        while True:
            await ws.receive_text()  # keepalive pings from client
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(ws)


# ---------------------------------------------------------------- 1 Hz spine loop
async def spine_loop():
    while True:
        await asyncio.sleep(1.0)
        try:
            S.stress = max(0.0, S.stress - STRESS_DECAY_PER_S)
            if S.force_requested_at and time.time() - S.force_requested_at > 5:
                S.force_requested_at = None
                await log_event("pacer_debug", "Force pacer not confirmed",
                                reason=("No pacer report within 5 s. Check the watch is connected and the "
                                        "simulator's 'Use Device HTTPS Requirements' is off."))
            if not S.watch_connected:
                force = S.force_pacer
                S.force_pacer = False
                po = S.phase_override
                S.phase_override = None
                sample = physics.step(S.physics, time.time(), S.speaking, S.stress,
                                      S.geofence_override, force, po)
                await ingest(sample)
            # Evaluate questions whose post-window has elapsed.
            now_t = S.t()
            ready = [q for q in S.pending_q if now_t - q["t"] >= correlation.EVAL_DELAY_S]
            for q in ready:
                S.pending_q.remove(q)
                c = correlation.evaluate(q, S.telemetry)
                if c:
                    c["id"] = next(S.ids)
                    S.callouts.append(c)
                    await hub.broadcast({"type": "callout", "data": c})
            await hub.broadcast({"type": "stage", "data": S.stage_snapshot()})
        except Exception as e:  # never let the spine die on stage
            print("spine error:", e)


@app.on_event("startup")
async def _start():
    app.state.loop_task = asyncio.create_task(spine_loop())


@app.on_event("shutdown")
async def _stop():
    app.state.loop_task.cancel()
    with contextlib.suppress(Exception):
        await app.state.loop_task
