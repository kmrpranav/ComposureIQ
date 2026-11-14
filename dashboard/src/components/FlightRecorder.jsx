import { useMemo, useState } from 'react'
import {
  Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fmtT } from '../hooks'
import {
  ALL_8_CHANNELS, ALL_CHANNELS, C, CORE_CHANNELS, SCALE_GRADIENT, SENSOR_6_CHANNELS,
  buildColorStops, last, rowScore, score, scoreColor, scoreWord, speakingSegments,
} from '../sensors'
import InfoTip from './InfoTip'

const WINDOWS = [
  { id: 'live', label: 'Last 2 min' },
  { id: 'full', label: 'Full session' },
]

const PRESETS = [
  { id: 'core', label: 'Core 6', keys: CORE_CHANNELS },
  { id: 'sensors6', label: 'All 6 Sensors', keys: SENSOR_6_CHANNELS },
  { id: 'all8', label: 'All 8 Channels', keys: ALL_8_CHANNELS },
]

const PHASE_NAMES = { IDLE: 'Baseline', PRIMER: 'Primer', LIVE: 'Live Interview', DONE: 'Debrief' }

const PHASE_META = {
  PRIMER: {
    title: 'Primer Started',
    defaultDetail: 'Guided 10s physiological sigh begins to elevate vagal HRV.',
    color: C.accent,
  },
  LIVE: {
    title: 'Interview Started',
    defaultDetail: 'Watch enters dim Stealth Mode; Listening Gate armed for +15 bpm spikes.',
    color: C.good,
  },
  DONE: {
    title: 'Interview Complete',
    defaultDetail: 'Session complete; debrief & habit scorecard generated.',
    color: C.ink,
  },
}

const MILESTONE_PRIORITY = { phase: 4, pacer: 3, question: 2, speaking: 1 }

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function snapToTelemetry(telemetry, t, expectedPhase = null) {
  if (!telemetry?.length) return t
  if (expectedPhase) {
    let phaseBestT = null
    let phaseBestDiff = 1.5
    for (const r of telemetry) {
      if (r.phase !== expectedPhase) continue
      const diff = Math.abs(r.t - t)
      if (diff <= phaseBestDiff) {
        phaseBestT = r.t
        phaseBestDiff = diff
      }
    }
    if (phaseBestT != null) return phaseBestT
  }
  let bestT = t
  let bestDiff = 1.5
  for (const r of telemetry) {
    const diff = Math.abs(r.t - t)
    if (diff <= bestDiff) {
      bestT = r.t
      bestDiff = diff
    }
  }
  return bestT
}

function normalizePhaseLabel(raw, fallback) {
  if (raw === 'Starting Interview') return 'Interview Started'
  if (raw === 'Starting Primer') return 'Primer Started'
  return raw || fallback
}

function buildMilestones(telemetry, events, transcript, flagged, x0, x1) {
  const candidates = []
  const allPhaseEvents = events.filter((e) => e.kind === 'phase' && PHASE_META[e.phase])

  for (const e of allPhaseEvents) {
    const meta = PHASE_META[e.phase]
    const label = normalizePhaseLabel(e.graph_label, meta.title)
    candidates.push({
      id: `ev-${e.id}`,
      t: e.t,
      expectedPhase: e.phase,
      title: label,
      detail: e.reason || meta.defaultDetail,
      color: meta.color,
      kind: 'phase',
    })
  }

  // Synthesize phase transitions from telemetry if no explicit phase event exists near that timestamp
  let prevPhase = telemetry[0]?.phase
  for (let i = 1; i < telemetry.length; i++) {
    const r = telemetry[i]
    if (r.phase && r.phase !== prevPhase && PHASE_META[r.phase]) {
      const hasEvent = allPhaseEvents.some((e) => e.phase === r.phase && Math.abs(e.t - r.t) <= 2.5)
      if (!hasEvent) {
        const meta = PHASE_META[r.phase]
        candidates.push({
          id: `syn-${r.phase}-${Math.floor(r.t)}`,
          t: r.t,
          expectedPhase: r.phase,
          title: meta.title,
          detail: meta.defaultDetail,
          color: meta.color,
          kind: 'phase',
        })
      }
    }
    prevPhase = r.phase ?? prevPhase
  }

  for (const q of transcript) {
    if (!q.is_question) continue
    const isFlag = flagged.has(q.id)
    candidates.push({
      id: `q-${q.id}`,
      t: q.t,
      title: isFlag ? 'Question Asked (Spike Flagged)' : 'Question Asked',
      detail: q.text,
      color: isFlag ? C.alert : C.note,
      kind: 'question',
    })
  }

  for (const p of events) {
    if (p.kind !== 'pacer') continue
    candidates.push({
      id: `p-${p.id}`,
      t: p.t,
      title: '60-BPM Pacer Fired',
      detail: p.reason || '2.5s stillness confirmed after HR spike (>+15 bpm); double wrist pulse delivered.',
      color: C.accent,
      kind: 'pacer',
    })
  }

  // Detect Answer Started transitions when gate flips from LISTENING to SPEAKING
  for (let i = 1; i < telemetry.length; i++) {
    const prev = telemetry[i - 1]
    const r = telemetry[i]
    if (r.gate === 'SPEAKING' && prev?.gate !== 'SPEAKING') {
      candidates.push({
        id: `spk-${Math.floor(r.t)}`,
        t: r.t,
        title: 'Answer Started',
        detail: 'Candidate speaking — 25Hz wrist motion gates haptics.',
        color: C.note,
        kind: 'speaking',
      })
    }
  }

  // Snap to exact telemetry point and deduplicate by integer second with priority
  const bySec = new Map()
  for (const cand of candidates) {
    const plotT = snapToTelemetry(telemetry, cand.t, cand.expectedPhase)
    if (plotT < x0 - 0.5 || plotT > x1 + 0.5) continue
    const sec = Math.floor(plotT)
    const entry = {
      ...cand,
      plotT,
      sec,
      shortLabel: `${fmtT(plotT)} · ${cand.title}`,
    }
    const existing = bySec.get(sec)
    if (!existing || MILESTONE_PRIORITY[entry.kind] > MILESTONE_PRIORITY[existing.kind]) {
      bySec.set(sec, entry)
    }
  }

  return Array.from(bySec.values()).sort((a, b) => a.plotT - b.plotT)
}

function SingleChartTooltip({ active, payload, channel, baselineHr, isVoice }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null

  const rawVal = payload[0]?.value
  const sc = !isVoice && channel ? rowScore(channel.key, row, baselineHr) : null
  const valColor = sc != null ? scoreColor(sc) : C.ink
  const stageName = PHASE_NAMES[row.phase] ?? row.phase ?? 'Baseline'
  const gateName = row.gate === 'SPEAKING' ? 'Speaking' : 'Listening'
  const ev = row.milestone

  return (
    <div className="max-w-[260px] rounded-md border border-line bg-white/95 px-2.5 py-2 text-[11px] text-ink shadow-md">
      {ev && (
        <div
          className="mb-1.5 rounded px-2 py-1 text-[10.5px] leading-snug"
          style={{ borderLeft: `3px solid ${ev.color}`, background: 'rgba(30,42,54,0.04)' }}
        >
          <div className="font-mono font-semibold text-ink">{ev.shortLabel}</div>
          <div className="line-clamp-2 text-[10px] text-muted">{ev.detail}</div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-b border-line/70 pb-1">
        <span className="font-mono font-semibold text-ink">{fmtT(row.t)}</span>
        <span className="font-mono text-[10px] text-muted">{stageName} · {gateName}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-muted">{isVoice ? 'Voice level' : channel.name}:</span>
        <span className="font-mono font-semibold tabular-nums" style={{ color: valColor }}>
          {rawVal == null
            ? '—'
            : isVoice
              ? `${Math.round(rawVal)}%`
              : `${Number(rawVal).toFixed(1)}${channel.unit ? ` ${channel.unit}` : ''}`}
          {sc != null ? ` (${scoreWord(sc)})` : ''}
        </span>
      </div>
    </div>
  )
}

export default function FlightRecorder({
  telemetry,
  transcript,
  events,
  callouts,
  view,
  setView,
  activeChannels = CORE_CHANNELS,
  setActiveChannels,
}) {
  const [hoverT, setHoverT] = useState(null)
  const [hoveredChart, setHoveredChart] = useState(null)
  const [selectedMilestoneId, setSelectedMilestoneId] = useState(null)
  const now = telemetry.length ? telemetry[telemetry.length - 1].t : 0
  const [x0, x1] = useMemo(() => {
    if (view.mode === 'zoom') return [view.from, view.to]
    if (view.mode === 'live') return [Math.max(0, now - 120), Math.max(120, now)]
    return [0, Math.max(now, 30)]
  }, [view, now])

  const segs = useMemo(() => {
    const windowRows = telemetry.filter((r) => r.t >= x0 - 1 && r.t <= x1 + 1)
    return speakingSegments(windowRows)
  }, [telemetry, x0, x1])
  const flagged = useMemo(() => new Set(callouts.map((c) => c.question_id)), [callouts])
  const baselineHr = last(telemetry, 'baseline_hr') ?? 72

  const milestones = useMemo(
    () => buildMilestones(telemetry, events, transcript, flagged, x0, x1),
    [telemetry, events, transcript, flagged, x0, x1],
  )

  const data = useMemo(() => {
    const filtered = telemetry.filter((r) => r.t >= x0 - 1 && r.t <= x1 + 1)
    const secsPresent = new Set(filtered.map((r) => Math.floor(r.t)))
    return filtered.map((r) => {
      const sec = Math.floor(r.t)
      const exact =
        milestones.find((m) => m.sec === sec) ??
        milestones.find((m) => !secsPresent.has(m.sec) && Math.abs(m.plotT - r.t) <= 0.75) ??
        null
      return { ...r, mic_pct: Math.round((r.mic_level ?? 0) * 100), milestone: exact }
    })
  }, [telemetry, milestones, x0, x1])

  const hoveredRow = useMemo(() => {
    if (!data.length) return null
    if (hoverT == null) return data[data.length - 1]
    let best = data[0]
    let bestDiff = Math.abs(best.t - hoverT)
    for (let i = 1; i < data.length; i++) {
      const diff = Math.abs(data[i].t - hoverT)
      if (diff < bestDiff) {
        best = data[i]
        bestDiff = diff
      }
    }
    return best
  }, [data, hoverT])

  const activeMilestone = useMemo(() => {
    if (!milestones.length) return null
    if (hoverT != null) {
      if (hoveredRow?.milestone) return hoveredRow.milestone
      let best = null
      let bestDiff = 2.0
      for (const m of milestones) {
        const diff = Math.abs(m.plotT - hoverT)
        if (diff <= bestDiff) {
          best = m
          bestDiff = diff
        }
      }
      if (best) return best
    }
    if (selectedMilestoneId) {
      const picked = milestones.find((m) => m.id === selectedMilestoneId)
      if (picked) return picked
    }
    return milestones[milestones.length - 1]
  }, [milestones, hoverT, hoveredRow, selectedMilestoneId])

  const channels = useMemo(
    () => ALL_CHANNELS.filter((c) => activeChannels.includes(c.key)),
    [activeChannels],
  )

  const toggleChannel = (key) => {
    if (!setActiveChannels) return
    setActiveChannels((prev) => {
      if (prev.includes(key)) {
        return prev.length > 1 ? prev.filter((k) => k !== key) : prev
      }
      return ALL_8_CHANNELS.filter((k) => prev.includes(k) || k === key)
    })
  }

  const zoomAt = (t) => t != null && setView({ mode: 'zoom', from: Math.max(0, t - 10), to: t + 25 })
  const stageName = PHASE_NAMES[hoveredRow?.phase] ?? hoveredRow?.phase ?? 'Baseline'
  const gateName = hoveredRow?.gate === 'SPEAKING' ? 'Speaking' : 'Listening'
  const handleChartMove = (chartId) => (e) => {
    setHoveredChart(chartId)
    if (e?.activeLabel != null) setHoverT(Number(e.activeLabel))
  }

  return (
    <div className="panel flex h-full min-h-0 flex-col p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-ink">Flight Recorder</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted">
            <span className="font-mono">{fmtT(x0)} – {fmtT(x1)}</span>
            <Legend swatch={<span className="h-2.5 w-3 rounded-sm bg-accent-soft ring-1 ring-accent/20" />}>speaking</Legend>
            <Legend swatch={<span className="h-3 w-0 border-l-2 border-dashed border-good" />}>stage</Legend>
            <Legend swatch={<span className="h-3 w-0 border-l border-dashed border-note" />}>question</Legend>
            <Legend swatch={<span className="h-3 w-0 border-l border-dashed border-alert" />}>flagged</Legend>
            <Legend swatch={<span className="h-3 w-0.5 bg-accent" />}>pacer</Legend>
            <span className="inline-flex items-center gap-1.5">
              <span>stress</span>
              <span className="h-1.5 w-14 rounded-full" style={{ background: SCALE_GRADIENT }} />
              <span>calm</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Channel preset switcher */}
          {setActiveChannels && (
            <div className="flex items-center gap-1 rounded-md border border-line bg-sunk p-0.5">
              {PRESETS.map((p) => {
                const active = arraysEqual(activeChannels, p.keys)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveChannels(p.keys)}
                    className={`rounded px-2 py-1 text-[11px] transition ${
                      active ? 'bg-card font-medium text-accent shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          )}

          {/* Time window switcher */}
          <div className="flex items-center gap-1 rounded-md border border-line bg-sunk p-0.5">
            {view.mode === 'zoom' && (
              <span className="px-2 font-mono text-[10px] text-accent">zoomed</span>
            )}
            {WINDOWS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setView({ mode: w.id })}
                className={`rounded px-2.5 py-1 text-[11px] transition ${
                  view.mode === w.id ? 'bg-card text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Individual channel toggle pills */}
      {setActiveChannels && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {ALL_CHANNELS.map((c) => {
            const on = activeChannels.includes(c.key)
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggleChannel(c.key)}
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition ${
                  on
                    ? 'border-accent/40 bg-accent-soft text-accent'
                    : 'border-line bg-sunk text-faint hover:border-line-strong hover:text-muted'
                }`}
              >
                {c.shortName}
              </button>
            )
          })}
        </div>
      )}

      {/* Single non-overlapping Timeline Cue Card */}
      <div
        className="mb-2 rounded-md border border-line bg-sunk/70 px-3 py-2"
        style={activeMilestone ? { borderLeftWidth: 3, borderLeftColor: activeMilestone.color } : undefined}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label">Timeline Cue</span>
            <span className="font-mono text-[10px] text-muted">
              {hoverT != null && hoveredRow ? `Hovering ${fmtT(hoveredRow.t)}` : `Latest ${hoveredRow ? fmtT(hoveredRow.t) : '00:00'}`} · {stageName} · {gateName}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {milestones.map((m) => {
              const isSelected = activeMilestone?.id === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedMilestoneId(m.id)}
                  title={`${m.shortLabel}: ${m.detail}`}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] transition ${
                    isSelected
                      ? 'bg-card font-semibold text-ink shadow-sm ring-1 ring-line-strong'
                      : 'text-muted hover:bg-card hover:text-ink'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
                  <span>{fmtT(m.plotT)}</span>
                </button>
              )
            })}
            {activeMilestone && (
              <button
                type="button"
                onClick={() => zoomAt(activeMilestone.plotT)}
                className="ml-1 rounded border border-line bg-card px-2 py-0.5 font-mono text-[9.5px] text-accent transition hover:border-accent"
              >
                Zoom
              </button>
            )}
          </div>
        </div>

        {activeMilestone ? (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11.5px]">
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white"
              style={{ background: activeMilestone.color }}
            >
              {activeMilestone.shortLabel}
            </span>
            {activeMilestone.title && !activeMilestone.shortLabel.includes(activeMilestone.title) && (
              <span className="font-medium text-ink">{activeMilestone.title}:</span>
            )}
            <span className="text-muted">{activeMilestone.detail}</span>
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-faint">
            Stage transitions (Primer Started, 00:12 Interview Started), questions, and 60-BPM pacer cues will appear here in a single cue card.
          </div>
        )}
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col"
        onMouseLeave={() => {
          setHoverT(null)
          setHoveredChart(null)
        }}
      >
        {/* Top synchronized Voice & Stillness Gate activity strip */}
        <div
          className="relative h-[48px] shrink-0 border-b border-line/70 pb-0.5"
          onMouseEnter={() => setHoveredChart('voice')}
        >
          <div className="pointer-events-none absolute left-12 top-0.5 z-10 flex items-center gap-1.5 rounded bg-card/90 pr-1.5">
            <span className="text-[10.5px] font-medium text-muted">Voice &amp; Gate</span>
            <span className="font-mono text-[10px] font-semibold text-ink tabular-nums">
              {hoveredRow ? `${hoveredRow.mic_pct}% · ${gateName}` : '—'}
            </span>
            {hoverT != null && hoveredRow && (
              <span className="font-mono text-[9.5px] text-faint">@ {fmtT(hoveredRow.t)}</span>
            )}
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              syncId="fr"
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              onMouseMove={handleChartMove('voice')}
              onClick={(e) => zoomAt(e?.activeLabel)}
            >
              <XAxis dataKey="t" type="number" domain={[x0, x1]} allowDataOverflow hide />
              <YAxis domain={[0, 100]} width={44} stroke={C.faint} fontSize={8.5} ticks={[0, 100]}
                tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
              {segs.map((s, k) => (
                <ReferenceArea key={k} x1={s.x1} x2={s.x2} fill={C.accentSoft} fillOpacity={0.9} ifOverflow="hidden" />
              ))}
              {milestones.map((m) => (
                <ReferenceLine
                  key={m.id}
                  x={m.plotT}
                  stroke={m.color}
                  strokeDasharray={m.kind === 'pacer' ? undefined : m.kind === 'phase' ? '3 3' : '4 3'}
                  strokeWidth={m.kind === 'phase' || m.kind === 'pacer' ? 1.5 : 1.2}
                  ifOverflow="hidden"
                />
              ))}
              <Tooltip
                cursor={{ stroke: C.ink, strokeWidth: 1, strokeDasharray: '2 2' }}
                wrapperStyle={{ zIndex: 50, pointerEvents: 'none' }}
                allowEscapeViewBox={{ x: false, y: true }}
                content={(props) =>
                  hoveredChart === 'voice'
                    ? <SingleChartTooltip {...props} isVoice baselineHr={baselineHr} />
                    : null
                }
              />
              <Area type="monotone" dataKey="mic_pct" stroke={C.note} strokeWidth={1.2} fill={C.note} fillOpacity={0.18}
                dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Synchronized sensor channels (red-to-green AreaCharts) */}
        {channels.map((c, i) => {
          const thresholdY = c.thresholdDelta != null ? baselineHr + c.thresholdDelta : c.threshold
          const stops = buildColorStops(c.key, data)
          const curScore = score(c.key, data)
          const fallbackCol = curScore != null ? scoreColor(curScore) : C.good
          const displayVal = hoveredRow?.[c.key]
          const displayScore = rowScore(c.key, hoveredRow, baselineHr)
          const displayCol = displayScore != null ? scoreColor(displayScore) : fallbackCol
          const strokeId = `fr-stroke-${c.key}`
          const fillId = `fr-fill-${c.key}`

          return (
            <div
              key={c.key}
              className="relative min-h-[68px] flex-1"
              onMouseEnter={() => setHoveredChart(c.key)}
            >
              <div className="pointer-events-none absolute left-12 top-0.5 z-10 flex items-center gap-1.5 rounded bg-card/90 pr-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: displayCol }} />
                <span className="text-[10.5px] font-medium text-muted">{c.name}</span>
                <span className="font-mono text-[10px] font-semibold tabular-nums" style={{ color: displayCol }}>
                  {displayVal == null ? '—' : `${Number(displayVal).toFixed(1)}${c.unit ? ` ${c.unit}` : ''}`}
                  {displayScore != null ? ` (${scoreWord(displayScore)})` : ''}
                </span>
                {hoverT != null && hoveredRow && (
                  <span className="font-mono text-[9.5px] text-faint">@ {fmtT(hoveredRow.t)}</span>
                )}
                <span className="pointer-events-auto">
                  <InfoTip k={c.key} className="scale-90" />
                </span>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data}
                  syncId="fr"
                  margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
                  onMouseMove={handleChartMove(c.key)}
                  onClick={(e) => zoomAt(e?.activeLabel)}
                >
                  <defs>
                    <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
                      {stops.map((st, idx) => (
                        <stop key={idx} offset={st.offset} stopColor={st.color} stopOpacity={1} />
                      ))}
                    </linearGradient>
                    <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="0">
                      {stops.map((st, idx) => (
                        <stop key={idx} offset={st.offset} stopColor={st.color} stopOpacity={0.28} />
                      ))}
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={[x0, x1]} allowDataOverflow
                    hide={i !== channels.length - 1} tickFormatter={fmtT} stroke={C.faint} fontSize={10} tickCount={8} />
                  <YAxis domain={c.domain} width={44} stroke={C.faint} fontSize={9} tickCount={3}
                    tickFormatter={(v) => Math.round(v)} allowDataOverflow axisLine={false} tickLine={false} />
                  {segs.map((s, k) => (
                    <ReferenceArea key={k} x1={s.x1} x2={s.x2} fill={C.accentSoft} fillOpacity={0.8} ifOverflow="hidden" />
                  ))}
                  {thresholdY != null && (
                    <ReferenceLine
                      y={thresholdY}
                      stroke={C.faint}
                      strokeDasharray="3 3"
                      ifOverflow="extendDomain"
                      label={{
                        value: c.thresholdLabel ?? `${thresholdY}`,
                        position: 'insideBottomRight',
                        fill: C.muted,
                        fontSize: 9,
                      }}
                    />
                  )}
                  {milestones.map((m) => (
                    <ReferenceLine
                      key={m.id}
                      x={m.plotT}
                      stroke={m.color}
                      strokeDasharray={m.kind === 'pacer' ? undefined : m.kind === 'phase' ? '3 3' : '4 3'}
                      strokeWidth={m.kind === 'phase' || m.kind === 'pacer' ? 1.5 : 1.2}
                      ifOverflow="hidden"
                    />
                  ))}
                  <Tooltip
                    cursor={{ stroke: C.ink, strokeWidth: 1, strokeDasharray: '2 2' }}
                    wrapperStyle={{ zIndex: 50, pointerEvents: 'none' }}
                    allowEscapeViewBox={{ x: false, y: true }}
                    content={(props) =>
                      hoveredChart === c.key
                        ? <SingleChartTooltip {...props} channel={c} baselineHr={baselineHr} />
                        : null
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey={c.key}
                    stroke={stops.length > 1 ? `url(#${strokeId})` : fallbackCol}
                    strokeWidth={1.75}
                    fill={stops.length > 1 ? `url(#${fillId})` : fallbackCol}
                    fillOpacity={stops.length > 1 ? 1 : 0.28}
                    baseValue="dataMin"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const Legend = ({ swatch, children }) => (
  <span className="inline-flex items-center gap-1.5">{swatch}{children}</span>
)
