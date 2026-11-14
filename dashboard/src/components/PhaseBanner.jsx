import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { post } from '../hooks'
import { C, last, score, scoreColor } from '../sensors'

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function BaselineBanner({ telemetry, stage }) {
  const hr = last(telemetry, 'hr')
  const rmssd = last(telemetry, 'rmssd')
  const spo2 = last(telemetry, 'spo2')
  const temp = last(telemetry, 'temp')
  const cal = stage?.calendar_event
  const minsLeft = cal?.start_epoch ? Math.max(0, Math.round((cal.start_epoch - Date.now() / 1000) / 60)) : 10

  return (
    <div className="panel flex flex-wrap items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-accent">
            Stage 1 · Baseline Calibration
          </span>
          <span className="text-[13px] font-semibold text-ink">
            {cal?.title ?? 'Senior SWE Onsite'}
          </span>
          <span className="font-mono text-[11px] text-muted">starts in ~{minsLeft} min</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
          <span>
            Calibrating resting baseline before your interview begins:
          </span>
          <span className="font-mono text-[11px]">
            HR <strong className="text-ink">{hr != null ? `${hr.toFixed(0)} bpm` : '—'}</strong> ·
            HRV <strong className="text-ink">{rmssd != null ? `${rmssd.toFixed(0)} ms` : '—'}</strong> ·
            SpO₂ <strong className="text-ink">{spo2 != null ? `${spo2.toFixed(1)}%` : '—'}</strong> ·
            skin <strong className="text-ink">{temp != null ? `${temp.toFixed(1)}°C` : '—'}</strong>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => post('/api/control', { action: 'set_phase', phase: 'PRIMER' })}
          className="shrink-0 rounded-md bg-accent px-3.5 py-2 text-[12px] font-medium text-white shadow-sm transition hover:bg-accent/90 active:translate-y-px"
        >
          Start Breathing Primer →
        </button>
        <button
          type="button"
          onClick={() => post('/api/control', { action: 'set_phase', phase: 'LIVE' })}
          className="shrink-0 rounded-md border border-line-strong bg-card px-3 py-2 text-[12px] font-medium text-ink transition hover:border-accent hover:text-accent active:translate-y-px"
        >
          Start Interview Now →
        </button>
      </div>
    </div>
  )
}

function PrimerBanner({ telemetry }) {
  const [tickMs, setTickMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setTickMs(Date.now()), 100)
    return () => clearInterval(id)
  }, [])

  const cycleSec = (tickMs / 1000) % 10
  let stepLabel, cueDetail, scale, vibeCue
  if (cycleSec < 2.0) {
    stepLabel = 'Inhale deeply (1/2)'
    cueDetail = 'Nasal inhale'
    scale = 0.55 + 0.3 * (cycleSec / 2.0)
    vibeCue = 'VibeProfile(40, 180) · inhale pulse'
  } else if (cycleSec < 3.0) {
    stepLabel = 'Top-up inhale (2/2)'
    cueDetail = 'Quick second sip of air'
    scale = 0.85 + 0.15 * (cycleSec - 2.0)
    vibeCue = 'VibeProfile(40, 180) · top-up pulse'
  } else {
    stepLabel = 'Long slow exhale'
    cueDetail = 'Drop shoulders · soften jaw'
    scale = 1.0 - 0.45 * ((cycleSec - 3.0) / 7.0)
    vibeCue = cycleSec < 5.5 ? 'VibeProfile(12, 2500) · soft exhale' : 'Quiet vagal recovery window'
  }

  const rmssd = last(telemetry, 'rmssd')
  const spo2 = last(telemetry, 'spo2')
  const temp = last(telemetry, 'temp')
  const hrvTargetPct = rmssd == null ? 0 : Math.min(100, Math.round((rmssd / 55) * 100))

  return (
    <div className="panel flex flex-wrap items-center justify-between gap-4 border-accent/35 bg-gradient-to-r from-accent-soft/50 via-card to-card px-4 py-3">
      <div className="flex items-center gap-4">
        {/* 10s physiological sigh ring */}
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-card">
          <div
            className="rounded-full bg-accent/20 ring-2 ring-accent transition-transform duration-100"
            style={{ width: 52, height: 52, transform: `scale(${scale})` }}
          />
          <span className="absolute font-mono text-[11px] font-semibold text-accent">
            {cycleSec.toFixed(1)}s
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-accent px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-white">
              Stage 2 · 10s Physiological Sigh
            </span>
            <span className="text-[14px] font-semibold text-ink">{stepLabel}</span>
            <span className="text-[12px] text-muted">· {cueDetail}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
            <span className="text-accent">{vibeCue}</span>
            <span>
              HRV <strong className="text-ink">{rmssd != null ? `${rmssd.toFixed(0)} ms` : '—'}</strong> / 55 ms ({hrvTargetPct}%)
            </span>
            <span>
              SpO₂ <strong className="text-ink">{spo2 != null ? `${spo2.toFixed(1)}%` : '—'}</strong>
            </span>
            <span>
              Skin <strong className="text-ink">{temp != null ? `${temp.toFixed(1)}°C` : '—'}</strong>
            </span>
          </div>
        </div>
      </div>

      <button
        onClick={() => post('/api/control', { action: 'set_phase', phase: 'LIVE' })}
        className="shrink-0 rounded-md border border-accent bg-card px-3.5 py-2 text-[12px] font-medium text-accent transition hover:bg-accent-soft active:translate-y-px"
      >
        Skip Primer → Enter Live Stealth Mode
      </button>
    </div>
  )
}

function LiveBanner({ telemetry, events, pacerActive }) {
  const row = telemetry[telemetry.length - 1]
  const base = last(telemetry, 'baseline_hr') ?? 72
  const peak = row?.gate === 'SPEAKING' ? row?.peak_hr : last(telemetry, 'peak_hr')
  const delta = peak != null ? peak - base : 0
  const still = row?.gate === 'SPEAKING' ? (row?.still_ms ?? 0) : 2500
  const pacerCount = events.filter((e) => e.kind === 'pacer').length
  const gate = row?.gate ?? 'LISTENING'

  return (
    <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${pacerActive ? 'animate-ping bg-accent' : gate === 'SPEAKING' ? 'bg-note' : 'bg-accent'}`} />
          <span className="text-[12.5px] font-semibold text-ink">
            Watch UI: Dim Stealth Analog Face
          </span>
          <span className="text-[11.5px] text-muted">
            Zero visual alerts · {gate === 'SPEAKING' ? 'Haptics muted while speaking' : 'Listening gate armed'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
          <span className="rounded border border-line bg-sunk px-2 py-0.5 text-muted">
            Answer peak <strong className={delta > 15 ? 'text-alert' : 'text-ink'}>
              {peak != null ? `${peak.toFixed(0)} bpm (${delta >= 0 ? '+' : ''}${delta.toFixed(0)})` : '—'}
            </strong> / +15 trigger
          </span>
          <span className="rounded border border-line bg-sunk px-2 py-0.5 text-muted">
            Stillness <strong className="text-ink">
              {gate === 'LISTENING' ? '2.5 / 2.5 s' : `${(Math.min(still, 2500) / 1000).toFixed(1)} / 2.5 s`}
            </strong>
          </span>
          <span className="rounded border border-line bg-sunk px-2 py-0.5 text-muted">
            60-BPM cues <strong className="text-accent">{pacerCount}</strong>
          </span>
        </div>
      </div>

      <button
        onClick={() => post('/api/control', { action: 'set_phase', phase: 'DONE' })}
        className="shrink-0 rounded-md border border-line-strong bg-card px-3 py-1.5 text-[12px] font-medium text-ink transition hover:border-accent hover:text-accent active:translate-y-px"
      >
        Finish Interview → View Debrief
      </button>
    </div>
  )
}

function ProgressionTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  return (
    <div className="rounded-md border border-line bg-white/95 px-2.5 py-1.5 text-[11px] text-ink shadow-md">
      <div className="mb-1 border-b border-line/70 pb-0.5 font-semibold">{row.label}</div>
      <div className="space-y-0.5 font-mono text-[10.5px]">
        <div style={{ color: C.good }}>Composure: {row.composure}</div>
        <div style={{ color: C.alert }}>Fidget: {row.fidget}</div>
        <div className="text-muted">Apnea dips: {row.apnea}</div>
      </div>
    </div>
  )
}

export function DebriefBanner({ telemetry, events, callouts, transcript, stage, onSelectChannel }) {
  const summary = useMemo(() => {
    const composures = telemetry.map((r) => r.composure_index).filter((v) => v != null)
    const fidgets = telemetry.map((r) => r.fidget_index).filter((v) => v != null)
    const hrs = telemetry.map((r) => r.hr).filter((v) => v != null)
    const gyros = telemetry.map((r) => r.gyro_mag).filter((v) => v != null)
    const spo2s = telemetry.map((r) => r.spo2).filter((v) => v != null)
    const rmssds = telemetry.map((r) => r.rmssd).filter((v) => v != null)
    const temps = telemetry.map((r) => r.temp).filter((v) => v != null)

    const avgComp = mean(composures)
    const minComp = composures.length ? Math.min(...composures) : null
    const finalComp = composures.length ? composures[composures.length - 1] : null

    const avgFid = mean(fidgets)
    const peakFid = fidgets.length ? Math.max(...fidgets) : null
    const peakGyro = gyros.length ? Math.max(...gyros) : null
    const peakHr = hrs.length ? Math.max(...hrs) : null
    const baseHr = last(telemetry, 'baseline_hr') ?? 72
    const speakingCount = telemetry.filter((r) => r.gate === 'SPEAKING').length
    const speakingPct = telemetry.length ? Math.round((speakingCount / telemetry.length) * 100) : 0

    const minSpo2 = spo2s.length ? Math.min(...spo2s) : null
    // Count distinct apnea dip episodes (<96.5%)
    let apneaDips = 0
    let inDip = false
    for (const r of telemetry) {
      if (r.spo2 != null && r.spo2 < 96.5) {
        if (!inDip) { apneaDips += 1; inDip = true }
      } else if (r.spo2 != null) {
        inDip = false
      }
    }

    const hrvDelta = rmssds.length >= 2 ? rmssds[rmssds.length - 1] - rmssds[0] : null
    const tempDelta = temps.length >= 2 ? temps[temps.length - 1] - temps[0] : null

    const pacerEvents = events.filter((e) => e.kind === 'pacer')
    const pacerDrops = []
    for (const ev of pacerEvents) {
      const atCue = telemetry.filter((r) => r.t >= ev.t - 2 && r.t <= ev.t + 1 && r.hr != null).map((r) => r.hr)
      const afterCue = telemetry.filter((r) => r.t > ev.t + 1 && r.t <= ev.t + 15 && r.hr != null).map((r) => r.hr)
      if (atCue.length && afterCue.length >= 2) {
        const drop = Math.max(...atCue) - Math.min(...afterCue)
        if (drop > 0) pacerDrops.push(drop)
      }
    }
    const avgPacerDrop = pacerDrops.length ? mean(pacerDrops) : null

    return {
      avgComp, minComp, finalComp, avgFid, peakFid, peakGyro, peakHr, baseHr,
      speakingPct, minSpo2, apneaDips, hrvDelta, tempDelta,
      pacerCount: pacerEvents.length, avgPacerDrop,
    }
  }, [telemetry, events])

  const liveCompVal = Math.round(summary.avgComp ?? 78)
  const liveFidVal = Math.round(summary.avgFid ?? 21)
  const historyRows = [
    { short: 'Session 1', label: 'Session 1 (2 wks ago)', composure: 54, fidget: 48, apnea: 4 },
    { short: 'Session 2', label: 'Session 2 (1 wk ago)', composure: 63, fidget: 37, apnea: 2 },
    { short: 'Session 3', label: 'Session 3 (3 days ago)', composure: 71, fidget: 28, apnea: 1 },
    { short: 'Today (Live)', label: 'Today (Live)', composure: liveCompVal, fidget: liveFidVal, apnea: summary.apneaDips, live: true },
  ]

  const exportJson = () => {
    downloadBlob(
      `composureiq-session-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`,
      JSON.stringify({ stage, summary, callouts, transcript, telemetry }, null, 2),
      'application/json',
    )
  }

  const exportCsv = () => {
    const cols = ['t', 'phase', 'gate', 'hr', 'rmssd', 'spo2', 'temp', 'accel_var', 'gyro_mag', 'fidget_index', 'composure_index', 'pacer_fired']
    const lines = [cols.join(','), ...telemetry.map((r) => cols.map((c) => r[c] ?? '').join(','))]
    downloadBlob(
      `composureiq-records-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`,
      lines.join('\n'),
      'text/csv',
    )
  }

  const compColor = scoreColor(score('composure_index', telemetry))
  const hrPeakDelta = summary.peakHr != null ? summary.peakHr - summary.baseHr : null

  return (
    <div className="panel space-y-3 border-accent/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-accent px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-white">
            Stage 4 · Post-Interview Debrief & Habit Scorecard
          </span>
          <span className="text-[13px] font-semibold text-ink">
            {stage?.calendar_event?.title ?? 'Interview Session Complete'}
          </span>
          <span className="font-mono text-[11px] text-muted">
            {telemetry.length} 1-Hz records · {callouts.length} spike callout{callouts.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportJson}
            className="rounded border border-line bg-sunk px-2.5 py-1 text-[11px] font-medium text-ink transition hover:border-accent hover:text-accent">
            ⬇ Export Session (JSON)
          </button>
          <button onClick={exportCsv}
            className="rounded border border-line bg-sunk px-2.5 py-1 text-[11px] font-medium text-ink transition hover:border-accent hover:text-accent">
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Row 1: 4 metric cards */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <button onClick={() => onSelectChannel?.('composure_index')}
          className="rounded-md border border-line bg-sunk p-2.5 text-left transition hover:border-line-strong hover:bg-card">
          <div className="label">Composure Index</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-[24px] font-semibold leading-none" style={{ color: compColor }}>
              {summary.avgComp != null ? Math.round(summary.avgComp) : '—'}
            </span>
            <span className="font-mono text-[11px] text-muted">avg / 100</span>
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-muted">
            min {summary.minComp != null ? Math.round(summary.minComp) : '—'} · final {summary.finalComp != null ? Math.round(summary.finalComp) : '—'}
          </div>
        </button>

        <button onClick={() => onSelectChannel?.('hr')}
          className="rounded-md border border-line bg-sunk p-2.5 text-left transition hover:border-line-strong hover:bg-card">
          <div className="label">60-BPM Pacer Efficacy</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-[24px] font-semibold leading-none text-accent">
              {summary.pacerCount}
            </span>
            <span className="font-mono text-[11px] text-muted">cue{summary.pacerCount === 1 ? '' : 's'} delivered</span>
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-muted">
            {summary.avgPacerDrop != null
              ? `-${summary.avgPacerDrop.toFixed(1)} bpm avg HR drop within 15s`
              : summary.pacerCount > 0
                ? 'HR recovery window recorded'
                : 'No cues needed (HR stayed < +15)'}
          </div>
        </button>

        <button onClick={() => onSelectChannel?.('fidget_index')}
          className="rounded-md border border-line bg-sunk p-2.5 text-left transition hover:border-line-strong hover:bg-card">
          <div className="label">Motion & Gesture Control</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-[24px] font-semibold leading-none text-ink">
              {summary.avgFid != null ? Math.round(summary.avgFid) : '—'}
            </span>
            <span className="font-mono text-[11px] text-muted">avg fidget (peak {summary.peakFid != null ? Math.round(summary.peakFid) : '—'})</span>
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-muted">
            peak gyro {summary.peakGyro != null ? `${summary.peakGyro.toFixed(0)}°/s` : '—'} · speaking {summary.speakingPct}%
          </div>
        </button>

        <button onClick={() => onSelectChannel?.('spo2')}
          className="rounded-md border border-line bg-sunk p-2.5 text-left transition hover:border-line-strong hover:bg-card">
          <div className="label">Autonomic & Apnea Check</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`font-mono text-[24px] font-semibold leading-none ${summary.minSpo2 != null && summary.minSpo2 < 96.5 ? 'text-alert' : 'text-ink'}`}>
              {summary.minSpo2 != null ? `${summary.minSpo2.toFixed(1)}%` : '—'}
            </span>
            <span className="font-mono text-[11px] text-muted">min SpO₂</span>
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-muted">
            {summary.apneaDips} apnea dip{summary.apneaDips === 1 ? '' : 's'} · HRV {summary.hrvDelta != null ? `${summary.hrvDelta >= 0 ? '+' : ''}${summary.hrvDelta.toFixed(0)} ms` : '—'} · skin {summary.tempDelta != null ? `${summary.tempDelta >= 0 ? '+' : ''}${summary.tempDelta.toFixed(1)}°C` : '—'}
          </div>
        </button>
      </div>

      {/* Row 2: Habit Prescriptions + .FIT & 4-Session Habit Progression */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="label">Personalized Habit Prescriptions (Triggered by Your Sensors)</div>
          <div className="space-y-1.5">
            <div className="rounded-md border border-line bg-card px-3 py-2">
              <div className="flex items-center justify-between text-[11.5px] font-semibold text-ink">
                <span>1. Breath Pacing · Prevent Speaker&apos;s Apnea</span>
                <span className="font-mono text-[10px] text-accent">SpO₂ {summary.minSpo2 != null ? `${summary.minSpo2.toFixed(1)}%` : '—'}</span>
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
                {summary.apneaDips > 0
                  ? `Detected ${summary.apneaDips} breath-hold dip(s) below 96.5%. Take one slow 4s nasal inhale during the 2.5s listening pause before launching into technical answers.`
                  : 'Oxygen saturation stayed steady above 96.5%—keep anchoring your opening sentence with a relaxed nasal inhale.'}
              </p>
            </div>
            <div className="rounded-md border border-line bg-card px-3 py-2">
              <div className="flex items-center justify-between text-[11.5px] font-semibold text-ink">
                <span>2. Somatic Grounding · Cut Micro-Fidgets</span>
                <span className="font-mono text-[10px] text-note">Peak Fidget {summary.peakFid != null ? Math.round(summary.peakFid) : '—'}</span>
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
                {summary.peakFid != null && summary.peakFid >= 45
                  ? `Wrist fidget peaked at ${Math.round(summary.peakFid)} (gyro ${summary.peakGyro?.toFixed(0) ?? '—'}°/s). Rest forearms lightly on the table edge after finishing an answer to eliminate defensive wrist flicks.`
                  : 'Gestures stayed grounded—continue resting hands calmly during listening windows so HRV and SpO₂ settle cleanly.'}
              </p>
            </div>
            <div className="rounded-md border border-line bg-card px-3 py-2">
              <div className="flex items-center justify-between text-[11.5px] font-semibold text-ink">
                <span>3. Cardiovascular Reset · Tough Questions</span>
                <span className="font-mono text-[10px] text-alert">
                  Peak {hrPeakDelta != null ? `${hrPeakDelta >= 0 ? '+' : ''}${hrPeakDelta.toFixed(0)} bpm` : '—'}
                </span>
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
                {callouts.length > 0
                  ? `${callouts.length} question(s) triggered sympathetic spikes. When you feel the 60-BPM double pulse on your wrist, drop your shoulders and lengthen your exhale.`
                  : 'Heart rate stayed controlled under questioning—review the timeline below to inspect recovery slopes between turns.'}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="rounded-md border border-line bg-card p-2.5">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="label">4-Session Habit Progression</span>
              <div className="flex items-center gap-3 font-mono text-[10px]">
                <span className="inline-flex items-center gap-1" style={{ color: C.good }}>
                  <span className="h-0.5 w-3 rounded-full" style={{ background: C.good }} />
                  Composure (calm ↑)
                </span>
                <span className="inline-flex items-center gap-1" style={{ color: C.alert }}>
                  <span className="w-3 border-t-2 border-dashed" style={{ borderColor: C.alert }} />
                  Fidget (stress ↓)
                </span>
              </div>
            </div>
            <div className="h-[175px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historyRows} margin={{ top: 8, right: 14, bottom: 2, left: 0 }}>
                  <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="short" stroke={C.faint} fontSize={10.5} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} width={28} stroke={C.faint} fontSize={9.5} ticks={[0, 50, 100]} tickLine={false} axisLine={false} />
                  <Tooltip content={<ProgressionTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="composure"
                    name="Composure"
                    stroke={C.good}
                    strokeWidth={2.25}
                    dot={{ r: 3.5, fill: C.good }}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="fidget"
                    name="Fidget"
                    stroke={C.alert}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={{ r: 3.5, fill: C.alert }}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1.5 rounded bg-sunk px-2 py-1 font-mono text-[10.5px] text-muted">
              S1 → Today: Composure 54 → <strong className="text-ink">{liveCompVal}</strong> · Fidget 48 → <strong className="text-ink">{liveFidVal}</strong> · Apnea dips 4 → <strong className="text-ink">{summary.apneaDips}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PhaseBanner({ telemetry, stage, events, pacerActive }) {
  const row = telemetry[telemetry.length - 1]
  const phase = row?.phase ?? stage?.phase ?? 'IDLE'

  if (phase === 'PRIMER') return <PrimerBanner telemetry={telemetry} />
  if (phase === 'LIVE') return <LiveBanner telemetry={telemetry} events={events} pacerActive={pacerActive} />
  if (phase === 'DONE') return null
  return <BaselineBanner telemetry={telemetry} stage={stage} />
}
