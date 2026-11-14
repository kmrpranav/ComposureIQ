"""Spike Correlation Engine: joins transcript question timestamps with sensor anomalies."""
from __future__ import annotations

import re
from statistics import mean

QUESTION_RE = re.compile(
    r"^\s*(tell me|walk me|describe|explain|how|what|why|when|where|which|who|can you|could you|would you|have you|do you|did you|are you|is there|give me)\b",
    re.I,
)
EVAL_DELAY_S = 18     # window after the question we inspect
BASELINE_S = 30       # window before the question used as baseline


def is_question(text: str) -> bool:
    t = text.strip()
    return t.endswith("?") or bool(QUESTION_RE.match(t))


def fmt_t(t: float) -> str:
    t = max(0, int(t))
    return f"{t // 60:02d}:{t % 60:02d}"


def _vals(rows, key):
    return [r[key] for r in rows if r.get(key) is not None]


def _jerk(rows):
    g = _vals(rows, "gyro_mag")
    if len(g) < 2:
        return 0.0
    return mean(abs(b - a) for a, b in zip(g, g[1:]))


def evaluate(question: dict, telemetry: list[dict]) -> dict | None:
    tq = question["t"]
    base = [r for r in telemetry if tq - BASELINE_S <= r["t"] < tq]
    win = [r for r in telemetry if tq <= r["t"] <= tq + EVAL_DELAY_S]
    if len(base) < 3 or len(win) < 3:
        return None

    hr_b, hr_w = mean(_vals(base, "hr")), max(_vals(win, "hr"))
    fid_b, fid_w = mean(_vals(base, "fidget_index")) or 1, mean(_vals(win, "fidget_index"))
    jerk_b, jerk_w = _jerk(base) or 1, _jerk(win)
    spo2_b, spo2_w = _vals(base, "spo2"), _vals(win, "spo2")
    rm_b, rm_w = _vals(base, "rmssd"), _vals(win, "rmssd")

    metrics = {
        "hr_delta": round(hr_w - hr_b, 1),
        "fidget_pct": round((fid_w - fid_b) / max(fid_b, 15) * 100),
        "jerk_ratio": round(jerk_w / max(jerk_b, 4.0), 1),
        "spo2_dip": round(mean(spo2_b) - min(spo2_w), 1) if spo2_b and spo2_w else 0.0,
        "rmssd_drop": round(mean(rm_b) - min(rm_w), 1) if rm_b and rm_w else 0.0,
    }
    parts = []
    if metrics["hr_delta"] >= 8:
        parts.append(f"HR rose {metrics['hr_delta']:+.0f} BPM")
    if metrics["fidget_pct"] >= 25:
        parts.append(f"Fidget Index rose {metrics['fidget_pct']}%")
    if metrics["jerk_ratio"] >= 1.5:
        parts.append(f"Gyro Angular Jerk spiked {metrics['jerk_ratio']}x")
    if metrics["spo2_dip"] >= 1.0:
        parts.append(f"SpO₂ dipped {metrics['spo2_dip']:.1f}%")
    if metrics["rmssd_drop"] >= 10:
        parts.append(f"HRV (RMSSD) fell {metrics['rmssd_drop']:.0f} ms")
    if not parts:
        return None

    severity = "high" if len(parts) >= 3 or metrics["hr_delta"] >= 15 else "medium"
    quote = question["text"].strip()
    if len(quote) > 80:
        quote = quote[:77] + "…"
    return {
        "t": tq,
        "question_id": question["id"],
        "question": quote,
        "severity": severity,
        "metrics": metrics,
        "text": f"At {fmt_t(tq)} (‘{quote}’), " + ", ".join(parts[:-1])
                + (" and " if len(parts) > 1 else "") + parts[-1] + ".",
    }
