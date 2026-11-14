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


def compute_motion(t: float, speaking: bool, stress: float, rnd: random.Random | None = None) -> dict:
    """Variable motion waveform reactive to stress, questions, and speech."""
    if rnd is None:
        rnd = random.Random(int(t * 100))

    if speaking:
        accel_var = max(2650.0, 3200 + 2600 * stress + 650 * math.sin(t * 1.3) + rnd.uniform(-450, 750))
        gyro = max(20.0, 74 + 62 * stress + 28 * math.sin(t * 1.45) + 14 * math.cos(t * 0.85) + rnd.uniform(-12, 16))
        fidget = min(100.0, max(0.0, 28 + 56 * stress + 10 * abs(math.sin(t * 1.2)) + rnd.uniform(-5, 8)))
    elif stress > 0.15:
        accel_var = max(100.0, min(2350.0, 450 + 1350 * stress * (0.55 + 0.45 * abs(math.sin(t * 1.1))) + rnd.uniform(-120, 220)))
        gyro = max(12.0, 44 + 64 * stress + 26 * math.sin(t * 1.25) + 15 * math.cos(t * 0.7) + rnd.uniform(-9, 12))
        fidget = min(100.0, max(0.0, 18 + 52 * stress + 12 * abs(math.sin(t * 1.1)) + rnd.uniform(-4, 6)))
    else:
        accel_var = max(60.0, 180 + 200 * abs(math.sin(t * 0.5)) + 500 * stress + rnd.uniform(-40, 80))
        gyro = max(3.0, 13 + 7 * math.sin(t * 0.65) + 4 * math.cos(t * 1.1) + 35 * stress + rnd.uniform(-2.5, 3.5))
        fidget = max(2.0, min(100.0, 6 + 4 * math.sin(t * 0.6) + 28 * stress + rnd.uniform(-2, 3)))

    amp_p = 18.0 if speaking else (9.0 * stress + 2.5)
    amp_r = 25.0 if speaking else (12.0 * stress + 3.0)
    pitch = -12 + amp_p * math.sin(t / 2.1) + rnd.uniform(-2.5, 2.5)
    roll = 8 + amp_r * math.sin(t / 1.6) + rnd.uniform(-2.5, 2.5)
    return {
        "accel_var": accel_var,
        "gyro_mag": gyro,
        "fidget_index": fidget,
        "pitch": pitch,
        "roll": roll,
    }


def step(ps: PhysicsState, now: float, speaking: bool, stress: float,
         geofence_override: bool, force_pacer: bool, phase_override: str | None = None) -> dict:
    """Advance one 1 Hz tick and return a telemetry payload shaped like the watch's."""
    ps.t += 1.0
    rnd = random.Random(int(now * 10))

    if phase_override in ("IDLE", "PRIMER", "LIVE", "DONE"):
        ps.phase = phase_override
        if phase_override == "PRIMER":
            ps.primer_started = now
            ps.lat, ps.lon = CALGARY[0] + 0.0002, CALGARY[1]
        elif phase_override == "IDLE":
            ps.lat, ps.lon = CALGARY[0] + 0.004, CALGARY[1]
            ps.primer_started = None

    # --- GPS: walk toward the venue; override teleports inside the fence.
    if geofence_override and ps.phase != "IDLE":
        ps.lat, ps.lon = CALGARY[0] + 0.0002, CALGARY[1]
    elif ps.phase == "IDLE":
        if geofence_override:
            ps.lat, ps.lon = CALGARY[0] + 0.0002, CALGARY[1]
        else:
            ps.lat = _approach(ps.lat, CALGARY[0], 0.02)
    dist = haversine_m(ps.lat, ps.lon, *CALGARY)

    # --- Phase machine (mirrors the watch). DONE holds steady until reset/override.
    if ps.phase != "DONE":
        if ps.phase == "IDLE" and dist < 100:
            ps.phase, ps.primer_started = "PRIMER", now
        elif ps.phase == "PRIMER" and (
            now - (ps.primer_started or now) > 90
            or (ps.rmssd > 55 and now - (ps.primer_started or now) > 20)
        ):
            ps.phase = "LIVE"
        if speaking and ps.phase in ("IDLE", "PRIMER"):
            ps.phase = "LIVE"

    # --- Motion: speaking produces gesture variance; questions/stress drive variable gyro rotation.
    mot = compute_motion(ps.t, speaking, stress, rnd)
    accel_var = mot["accel_var"]
    gyro = mot["gyro_mag"]
    fidget = mot["fidget_index"]
    pitch = mot["pitch"]
    roll = mot["roll"]

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
