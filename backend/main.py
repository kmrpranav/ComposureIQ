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


async def ingest(sample: dict):
    sample["t"] = S.t()
    prev_phase, prev_gate = S.phase, S.gate
    S.phase = sample.get("phase", S.phase)
    S.gate = sample.get("gate", S.gate)
    S.telemetry.append(sample)
    await hub.broadcast({"type": "telemetry", "data": sample})
    if S.phase != prev_phase:
        await log_event("phase", f"Phase → {S.phase}")
    if S.gate != prev_gate:
        await log_event("gate", f"{S.gate.title()} gate")
    if sample.get("pacer_fired"):
        await log_event("pacer", "60-BPM listening pacer fired")


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
        await log_event("control", "Forced listening pacer")
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
