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
import contextlib
import itertools
import time

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
        self.force_pacer = False
        self.force_requested_at = None
        self.last_watch = 0.0
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
    def speaking(self) -> bool:
        return self.mic_speaking and time.time() - self.mic_last < MIC_TIMEOUT_S

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
            "force_pacer": self.force_pacer,
            "calendar_event": self.calendar_event(),
        }

    def stage_snapshot(self) -> dict:
        return {
            **self.stage_response(),
            "watch_connected": self.watch_connected,
            "mic_level": round(self.mic_level, 3),
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


PHASE_LABEL = {"IDLE": "En route", "PRIMER": "Primer", "LIVE": "Live", "DONE": "Debrief"}


def phase_reason(prev: str, new: str, x: dict) -> str:
    """Plain-language reason for a stage change, inferred from the sample that caused it."""
    if new == "PRIMER":
        if S.geofence_override:
            return "Presenter pressed Venue arrival (geofence override), so the breathing primer started."
        d = x.get("distance_m")
        return (f"You are {d:.0f} m from the venue (inside the 100 m geofence) and the interview starts "
                "within 15 min, so the breathing primer started.") if d is not None else \
            "Arrived inside the venue geofence within 15 min of the interview."
    if new == "LIVE":
        if prev == "PRIMER":
            if S.speaking:
                return "Voice detected during the primer, so it ended early and Live began."
            rm = x.get("rmssd")
            if rm is not None and rm >= 55:
                return f"HRV recovered to {rm:.0f} ms (target 55 ms or more, after at least 20 s of breathing)."
            return "Primer reached its 90 s limit."
        return "Voice detected before venue arrival, so Live started directly."
    if new == "DONE":
        return "Session finished and saved to the watch's .FIT file."
    return "Session reset."


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
    prev_phase, prev_gate = S.phase, S.gate
    S.phase = sample.get("phase", S.phase)
    S.gate = sample.get("gate", S.gate)
    S.telemetry.append(sample)
    await hub.broadcast({"type": "telemetry", "data": sample})
    if S.phase != prev_phase:
        await log_event("phase", f"Stage: {PHASE_LABEL.get(S.phase, S.phase)}", phase=S.phase,
                        reason=phase_reason(prev_phase, S.phase, sample))
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


# ---------------------------------------------------------------- watch API
class Telemetry(BaseModel):
    model_config = {"extra": "allow"}


@app.post("/api/telemetry")
async def telemetry(body: Telemetry):
    S.last_watch = time.time()
    sample = body.model_dump()
    sample.setdefault("source", "watch")
    await ingest(sample)
    resp = S.stage_response()
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


@app.post("/api/mic")
async def mic(body: Mic):
    was = S.speaking
    S.mic_speaking, S.mic_level, S.mic_last = body.speaking, body.level, time.time()
    if body.speaking != was:
        await log_event("voice", "Voice start" if body.speaking else "Voice stop")
    return {"ok": True}


class Transcript(BaseModel):
    text: str
    final: bool = True


@app.post("/api/transcript")
async def transcript(body: Transcript):
    text = body.text.strip()
    if not text:
        return {"ok": False}
    if not body.final:
        await hub.broadcast({"type": "interim", "data": {"t": S.t(), "text": text}})
        return {"ok": True}
    q = correlation.is_question(text)
    entry = {"id": next(S.ids), "t": S.t(), "text": text, "is_question": q}
    S.transcript.append(entry)
    await hub.broadcast({"type": "transcript", "data": entry})
    if q:
        S.stress = max(S.stress, 0.75)
        S.pending_q.append(entry)
    return {"ok": True, "is_question": q}


class Control(BaseModel):
    action: str
    text: str | None = None


@app.post("/api/control")
async def control(body: Control):
    a = body.action
    if a == "venue_arrival":
        S.geofence_override = True
        await log_event("control", "Simulated venue arrival")
    elif a == "stress_question":
        text = body.text or "Tell me about a time a production deployment failed."
        entry = {"id": next(S.ids), "t": S.t(), "text": text, "is_question": True}
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
                sample = physics.step(S.physics, time.time(), S.speaking, S.stress,
                                      S.geofence_override, force)
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
