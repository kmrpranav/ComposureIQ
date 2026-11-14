"""Spike Correlation Engine: joins transcript question timestamps with sensor anomalies."""
from __future__ import annotations

import re
from statistics import mean

QUESTION_RE = re.compile(
    r"^\s*(tell me|walk me|describe|explain|how|what|why|when|where|which|who|can you|could you|would you|have you|do you|did you|are you|is there|give me)\b",
    re.I,
)
DIRECT_Q_RE = re.compile(
    r"^\s*(how|what|why|when|where|which|who|whom|whose|can you|could you|would you|will you|do you|did you|does|have you|had you|has|are you|were you|is there|are there|should we|shall we|may i)\b",
    re.I,
)
PROMPT_Q_RE = re.compile(
    r"\b(tell me about|walk me through|describe a|describe how|explain how|explain why|give me an example|share a time|talk about a time|suppose you|imagine you|what would you do if)\b",
    re.I,
)
EMBEDDED_Q_RE = re.compile(
    r"\b(wondering how|wondering why|curious how|curious why|curious what|like to know how|like to know what)\b",
    re.I,
)
ANSWER_STAR_RE = re.compile(
    r"\b(in my (last|previous|current) role|at my last|when we deployed|we had an outage|the root cause|i led|i built|i designed|i implemented|we migrated|as a result|our team|my responsibility)\b",
    re.I,
)
ANSWER_FIRST_PERSON_RE = re.compile(
    r"^\s*(i |i'm |i've |i'd |we |we've |we're |my |our |yes[, ]|no[, ]|sure[, ]|absolutely|definitely|so basically|first[, ]|to answer)\b",
    re.I,
)
EVAL_DELAY_S = 18     # window after the question we inspect
BASELINE_S = 30       # window before the question used as baseline


def split_sentences(text: str) -> list[str]:
    cleaned = " ".join(text.strip().split())
    if not cleaned:
        return []
    parts = [p.strip() for p in re.split(r"(?<=[.?!])\s+", cleaned) if p.strip()]
    if len(parts) <= 1:
        return [cleaned]
    merged: list[str] = []
    for part in parts:
        if merged:
            prev = merged[-1]
            diff_q = prev.endswith("?") != part.endswith("?")
            if not diff_q and (len(prev) < 12 or len(part) < 12):
                merged[-1] = f"{prev} {part}"
                continue
        merged.append(part)
    return merged


def classify_utterance(
    text: str,
    speaker_mode: str = "auto",
    last_turn_kind: str | None = None,
    pitch_hz: float | None = None,
    pitch_profile: dict | None = None,
    watch_moving: bool = False,
) -> dict:
    t = text.strip()
    ends_q = t.endswith("?")
    is_prompt = bool(PROMPT_Q_RE.search(t))
    is_direct_q = bool(DIRECT_Q_RE.match(t))
    is_embedded_q = bool(EMBEDDED_Q_RE.search(t))
    is_star = bool(ANSWER_STAR_RE.search(t))
    is_fp = bool(ANSWER_FIRST_PERSON_RE.match(t))

    if speaker_mode == "interviewer":
        speaker = "interviewer"
        is_q = True
        if is_prompt:
            format_tag = "Behavioral Prompt"
        elif ends_q or is_direct_q:
            format_tag = "Direct Question ?"
        else:
            format_tag = "Interviewer Prompt"
    elif speaker_mode == "candidate":
        speaker = "candidate"
        is_q = False
        if is_star:
            format_tag = "STAR Answer"
        elif ends_q:
            format_tag = "Clarifying Note"
        else:
            format_tag = "Technical Answer"
    else:
        q_score = 0.0
        if ends_q:
            q_score += 3.0
        if is_prompt:
            q_score += 3.0
        if is_direct_q:
            q_score += 2.5
        if is_embedded_q:
            q_score += 1.5
        if is_star:
            q_score -= 2.5
        if is_fp and not ends_q and not is_prompt:
            q_score -= 1.5
        if last_turn_kind == "question" and q_score < 2.5:
            q_score -= 1.5
        if watch_moving and q_score < 2.5:
            q_score -= 1.0
        if pitch_hz and pitch_profile:
            int_hz = pitch_profile.get("interviewer")
            cand_hz = pitch_profile.get("candidate")
            if int_hz is not None and cand_hz is not None and abs(int_hz - cand_hz) >= 8:
                if abs(pitch_hz - int_hz) < abs(pitch_hz - cand_hz):
                    q_score += 0.75
                else:
                    q_score -= 0.75

        is_q = q_score >= 1.5
        speaker = "interviewer" if is_q else "candidate"
        if is_q:
            if is_prompt:
                format_tag = "Behavioral Prompt"
            elif ends_q or is_direct_q:
                format_tag = "Direct Question ?"
            else:
                format_tag = "Follow-up Question"
        else:
            if is_star:
                format_tag = "STAR Answer"
            elif is_fp:
                format_tag = "Structured Answer"
            else:
                format_tag = "Candidate Answer"

    formatted_text = t
    if is_q and is_direct_q and not t.endswith(("?", ".", "!")):
        formatted_text = f"{t}?"

    return {
        "text": formatted_text,
        "kind": "question" if is_q else "answer",
        "is_question": is_q,
        "speaker": speaker,
        "speaker_label": "Interviewer" if speaker == "interviewer" else "You",
        "format_tag": format_tag,
    }


def answer_metrics(t_start: float, t_end: float, telemetry: list[dict], events: list[dict]) -> dict | None:
    rows = [r for r in telemetry if t_start - 1.0 <= r["t"] <= t_end + 3.0]
    if not rows and telemetry:
        rows = telemetry[-4:]
    if not rows:
        return None
    hrs = _vals(rows, "hr")
    fids = _vals(rows, "fidget_index")
    gyros = _vals(rows, "gyro_mag")
    bases = _vals(rows, "baseline_hr")
    base_hr = mean(bases) if bases else 72.0
    peak_hr = max(hrs) if hrs else None
    pacer_fired = any(
        e.get("kind") == "pacer" and t_start <= e["t"] <= t_end + 5.0
        for e in events
    )
    return {
        "peak_hr": round(peak_hr, 1) if peak_hr is not None else None,
        "hr_delta": round(peak_hr - base_hr, 1) if peak_hr is not None else None,
        "fidget_avg": round(mean(fids)) if fids else None,
        "gyro_peak": round(max(gyros), 1) if gyros else None,
        "pacer_fired": pacer_fired,
    }


def is_question(text: str) -> bool:
    t = text.strip()
    return t.endswith("?") or bool(QUESTION_RE.match(t)) or bool(PROMPT_Q_RE.search(t))


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


def evaluate(question: dict, telemetry: list[dict], force: bool = False) -> dict | None:
    tq = question["t"]
    base = [r for r in telemetry if tq - BASELINE_S <= r["t"] < tq]
    win = [r for r in telemetry if tq <= r["t"] <= tq + EVAL_DELAY_S]
    if not force:
        if len(base) < 3 or len(win) < 3:
            return None
    else:
        if len(win) < 2:
            win = telemetry[-8:]
        if not win:
            return None

    hr_base_vals = _vals(base, "hr")
    fid_base_vals = _vals(base, "fidget_index")
    spo2_b, spo2_w = _vals(base, "spo2"), _vals(win, "spo2")
    rm_b, rm_w = _vals(base, "rmssd"), _vals(win, "rmssd")

    hr_win_vals = _vals(win, "hr")
    fid_win_vals = _vals(win, "fidget_index")
    if not hr_win_vals or not fid_win_vals:
        return None

    hr_b = mean(hr_base_vals) if hr_base_vals else 72.0
    hr_w = max(hr_win_vals)
    fid_b = (mean(fid_base_vals) if fid_base_vals else 15.0) or 1.0
    fid_w = mean(fid_win_vals)
    jerk_b = (_jerk(base) if len(base) >= 2 else 4.0) or 1.0
    jerk_w = _jerk(win)

    base_spo2 = mean(spo2_b) if spo2_b else 98.0
    base_rmssd = mean(rm_b) if rm_b else 55.0

    metrics = {
        "hr_delta": round(hr_w - hr_b, 1),
        "fidget_pct": round((fid_w - fid_b) / max(fid_b, 15) * 100),
        "jerk_ratio": round(jerk_w / max(jerk_b, 4.0), 1),
        "spo2_dip": round(max(0.0, base_spo2 - min(spo2_w)), 1) if spo2_w else 0.0,
        "rmssd_drop": round(max(0.0, base_rmssd - min(rm_w)), 1) if rm_w else 0.0,
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
        if not force:
            return None
        parts.append(f"HR shifted {metrics['hr_delta']:+.0f} BPM")
        if metrics["fidget_pct"] > 0:
            parts.append(f"Fidget Index rose {metrics['fidget_pct']}%")

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


def force_evaluate(question: dict, telemetry: list[dict]) -> dict | None:
    return evaluate(question, telemetry, force=True)
