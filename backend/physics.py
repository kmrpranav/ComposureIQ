"""Hybrid Simulator Physics Modulator.

Deterministic-ish physiology envelope used in two places:
  * Server-side fallback: when no watch has posted telemetry for a few seconds, the
    backend synthesizes the full 8-sensor payload so the dashboard always has data.
  * Mirrors the Monkey C modulator in watch-app/source/PhysicsModulator.mc so the
    curves look identical whether the watch simulator is attached or not.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

CALGARY = (51.0447, -114.0719)
BASELINE_HR = 72.0
SPEAK_VAR_THRESHOLD = 2500.0  # mg^2 — must match watch-app Config.SPEAK_VAR_THRESHOLD
LISTEN_HOLD_S = 2.5
PACER_HR_DELTA = 15.0


@dataclass
class PhysicsState:
    hr: float = BASELINE_HR
    hr_peak_answer: float = BASELINE_HR
    rmssd: float = 58.0
    spo2: float = 98.0
    temp: float = 33.4
    heading: float = 182.0
    still_since: float | None = None
    gate: str = "LISTENING"
    phase: str = "IDLE"
    primer_started: float | None = None
    t: float = 0.0
    lat: float = CALGARY[0] + 0.004  # starts ~450 m away
    lon: float = CALGARY[1]
    rr_buf: list = field(default_factory=list)


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _approach(cur: float, target: float, rate: float) -> float:
    return cur + (target - cur) * rate


def step(ps: PhysicsState, now: float, speaking: bool, stress: float,
         geofence_override: bool, force_pacer: bool) -> dict:
    """Advance one 1 Hz tick and return a telemetry payload shaped like the watch's."""
    ps.t += 1.0
    rnd = random.Random(int(now * 10))

    # --- GPS: walk toward the venue; override teleports inside the fence.
    if geofence_override:
        ps.lat, ps.lon = CALGARY[0] + 0.0002, CALGARY[1]
    elif ps.phase == "IDLE":
        ps.lat = _approach(ps.lat, CALGARY[0], 0.02)
    dist = haversine_m(ps.lat, ps.lon, *CALGARY)

    # --- Phase machine (mirrors the watch).
    if ps.phase == "IDLE" and dist < 100:
        ps.phase, ps.primer_started = "PRIMER", now
    elif ps.phase == "PRIMER" and (now - (ps.primer_started or now) > 90 or ps.rmssd > 55 and now - ps.primer_started > 20):
        ps.phase = "LIVE"
    if speaking and ps.phase in ("IDLE", "PRIMER"):
        ps.phase = "LIVE"

    # --- Motion: speaking produces gesture variance; stress adds fidget jitter.
    if speaking:
        accel_var = 3200 + 2600 * stress + rnd.uniform(-600, 900)
        gyro = 55 + 90 * stress + rnd.uniform(-15, 25)
        fidget = min(100, 25 + 60 * stress + rnd.uniform(-5, 8))
    else:
        accel_var = 300 + 900 * stress * rnd.random()
        gyro = 4 + 18 * stress * rnd.random()
        fidget = max(0, 6 + 25 * stress * rnd.random())
    pitch = -12 + (18 if speaking else 2) * math.sin(ps.t / 2.3) + rnd.uniform(-3, 3)
    roll = 8 + (25 if speaking else 3) * math.sin(ps.t / 1.7) + rnd.uniform(-3, 3)

    # --- Stillness gate with 2.5 s hold.
    pacer = False
    if accel_var > SPEAK_VAR_THRESHOLD:
        if ps.gate != "SPEAKING":
            ps.hr_peak_answer = ps.hr
        ps.gate, ps.still_since = "SPEAKING", None
        ps.hr_peak_answer = max(ps.hr_peak_answer, ps.hr)
    else:
        if ps.still_since is None:
            ps.still_since = now
        if ps.gate == "SPEAKING" and now - ps.still_since >= LISTEN_HOLD_S:
            ps.gate = "LISTENING"
            if ps.hr_peak_answer - BASELINE_HR > PACER_HR_DELTA:
                pacer = True
    if force_pacer:
        ps.gate, pacer = "LISTENING", True
        ps.still_since = now

    # --- Cardio / autonomic envelope.
    hr_target = BASELINE_HR + 28 * stress + (7 if speaking else 0) + (6 if ps.phase == "PRIMER" else 0)
    ps.hr = _approach(ps.hr, hr_target, 0.18) + rnd.uniform(-0.8, 0.8)
    rmssd_target = 62 - 34 * stress - (8 if speaking else 0)
    if ps.phase == "PRIMER":
        rmssd_target += min(20, (now - (ps.primer_started or now)) / 3)
    ps.rmssd = _approach(ps.rmssd, rmssd_target, 0.12) + rnd.uniform(-1.5, 1.5)
    # Speaker's apnea: SpO2 dips while still + stressed (formulating an answer).
    spo2_target = 98 - (2.6 * stress if not speaking else 0.6 * stress)
    ps.spo2 = _approach(ps.spo2, spo2_target, 0.15)
    temp_target = 33.6 - 1.8 * stress - (0.9 if ps.phase == "PRIMER" and ps.t < 40 else 0)
    ps.temp = _approach(ps.temp, temp_target, 0.04)
    ps.heading = (ps.heading + rnd.uniform(-1, 1) * (1 + 12 * stress * (0 if speaking else 1))) % 360

    composure = max(0, min(100, 100 - 0.9 * max(0, ps.hr - BASELINE_HR) - 0.35 * fidget
                         - 4 * max(0, 97.5 - ps.spo2) + 0.25 * (ps.rmssd - 40)))

    return {
        "source": "backend-sim",
        "phase": ps.phase,
        "gate": ps.gate,
        "hr": round(ps.hr, 1),
        "rmssd": round(ps.rmssd, 1) if ps.gate == "LISTENING" else None,
        "spo2": round(ps.spo2, 1) if ps.gate == "LISTENING" else None,
        "temp": round(ps.temp, 2),
        "heading": round(ps.heading, 1) if ps.gate == "LISTENING" else None,
        "accel_var": round(accel_var, 1),
        "gyro_mag": round(gyro, 1),
        "pitch": round(pitch, 1),
        "roll": round(roll, 1),
        "fidget_index": round(fidget, 1),
        "composure_index": round(composure, 1),
        "lat": round(ps.lat, 6),
        "lon": round(ps.lon, 6),
        "distance_m": round(dist, 1),
        "pacer_fired": pacer,
        "pacer_forced": bool(force_pacer),
        "baseline_hr": BASELINE_HR,
        "peak_hr": round(ps.hr_peak_answer, 1),
        "still_ms": 0 if ps.still_since is None else int((now - ps.still_since) * 1000),
    }
