import { useMemo } from 'react'
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fmtT } from '../hooks'
import { ALL_10_CHANNELS, ALL_CHANNELS, C, CORE_CHANNELS, SENSOR_8_CHANNELS, last, speakingSegments } from '../sensors'
import InfoTip from './InfoTip'

const WINDOWS = [
  { id: 'live', label: 'Last 2 min' },
  { id: 'full', label: 'Full session' },
]

const PRESETS = [
  { id: 'core', label: 'Core 6', keys: CORE_CHANNELS },
  { id: 'sensors8', label: 'All 8 Sensors', keys: SENSOR_8_CHANNELS },
  { id: 'all10', label: 'All 10', keys: ALL_10_CHANNELS },
]

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i])
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
  const now = telemetry.length ? telemetry[telemetry.length - 1].t : 0
  const [x0, x1] = useMemo(() => {
    if (view.mode === 'zoom') return [view.from, view.to]
    if (view.mode === 'live') return [Math.max(0, now - 120), Math.max(120, now)]
    return [0, Math.max(now, 30)]
  }, [view, now])

  const data = useMemo(
    () =>
      telemetry
        .filter((r) => r.t >= x0 - 1 && r.t <= x1 + 1)
        .map((r) => ({ ...r, mic_pct: Math.round((r.mic_level ?? 0) * 100) })),
    [telemetry, x0, x1],
  )
  const segs = useMemo(() => speakingSegments(data), [data])
  const questions = transcript.filter((q) => q.is_question && q.t >= x0 && q.t <= x1)
  const pacers = events.filter((e) => e.kind === 'pacer' && e.t >= x0 && e.t <= x1)
  const flagged = new Set(callouts.map((c) => c.question_id))
  const baselineHr = last(telemetry, 'baseline_hr') ?? 72

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
      return ALL_10_CHANNELS.filter((k) => prev.includes(k) || k === key)
    })
  }

  const zoomAt = (t) => t != null && setView({ mode: 'zoom', from: Math.max(0, t - 10), to: t + 25 })

  return (
    <div className="panel flex h-full min-h-0 flex-col p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-ink">Flight Recorder</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted">
            <span className="font-mono">{fmtT(x0)} – {fmtT(x1)}</span>
            <Legend swatch={<span className="h-2.5 w-3 rounded-sm bg-accent-soft ring-1 ring-accent/20" />}>speaking</Legend>
            <Legend swatch={<span className="h-3 w-0 border-l border-dashed border-note" />}>question</Legend>
            <Legend swatch={<span className="h-3 w-0 border-l border-dashed border-alert" />}>flagged</Legend>
            <Legend swatch={<span className="h-3 w-0.5 bg-accent" />}>pacer</Legend>
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

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Top synchronized Voice & Stillness Gate activity strip */}
        <div className="relative h-[48px] shrink-0 border-b border-line/70 pb-0.5">
          <div className="absolute left-12 top-0.5 z-10 flex items-center gap-1.5 bg-card/80 pr-1">
            <span className="text-[10.5px] font-medium text-muted">Voice &amp; Gate</span>
            <span className="font-mono text-[9.5px] text-faint">mic %</span>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} syncId="fr" margin={{ top: 4, right: 8, bottom: 0, left: 0 }} onClick={(e) => zoomAt(e?.activeLabel)}>
              <XAxis dataKey="t" type="number" domain={[x0, x1]} allowDataOverflow hide />
              <YAxis domain={[0, 100]} width={44} stroke={C.faint} fontSize={8.5} ticks={[0, 100]}
                tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
              {segs.map((s, k) => (
                <ReferenceArea key={k} x1={s.x1} x2={s.x2} fill={C.accentSoft} fillOpacity={0.9} ifOverflow="hidden" />
              ))}
              {questions.map((q) => (
                <ReferenceLine key={q.id} x={q.t} stroke={flagged.has(q.id) ? C.alert : C.note}
                  strokeDasharray="4 3" strokeWidth={1.2} ifOverflow="hidden"
                  label={{ value: 'Q', position: 'insideTopLeft', fill: flagged.has(q.id) ? C.alert : C.note, fontSize: 9 }} />
              ))}
              {pacers.map((p) => (
                <ReferenceLine key={p.id} x={p.t} stroke={C.accent} strokeWidth={1.5} ifOverflow="hidden"
                  label={{ value: 'P', position: 'insideTopRight', fill: C.accent, fontSize: 9 }} />
              ))}
              <Tooltip
                cursor={{ stroke: C.faint }}
                contentStyle={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 11, color: C.ink }}
                labelFormatter={fmtT}
                formatter={(v) => [`${v ?? 0}%`, 'Voice level']}
              />
              <Area type="monotone" dataKey="mic_pct" stroke={C.note} strokeWidth={1.2} fill={C.note} fillOpacity={0.18}
                dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Synchronized sensor channels */}
        {channels.map((c, i) => {
          const thresholdY = c.thresholdDelta != null ? baselineHr + c.thresholdDelta : c.threshold
          return (
            <div key={c.key} className="relative min-h-[62px] flex-1">
              <div className="absolute left-12 top-0.5 z-10 flex items-center gap-1 bg-card/80 pr-1">
                <span className="text-[10.5px] font-medium text-muted">{c.name}</span>
                <InfoTip k={c.key} className="scale-90" />
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} syncId="fr" margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  onClick={(e) => zoomAt(e?.activeLabel)}>
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
                  {questions.map((q) => (
                    <ReferenceLine key={q.id} x={q.t} stroke={flagged.has(q.id) ? C.alert : C.note}
                      strokeDasharray="4 3" strokeWidth={1.2} ifOverflow="hidden" />
                  ))}
                  {pacers.map((p) => (
                    <ReferenceLine key={p.id} x={p.t} stroke={C.accent} strokeWidth={1.5} ifOverflow="hidden" />
                  ))}
                  <Tooltip
                    cursor={{ stroke: C.faint }}
                    contentStyle={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 11, color: C.ink }}
                    labelFormatter={fmtT}
                    formatter={(v) => [v == null ? '—' : `${Number(v).toFixed(1)} ${c.unit}`, c.name]}
                  />
                  <Line type="monotone" dataKey={c.key} stroke={c.key === 'composure_index' ? C.ink : C.accent}
                    strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />
                </LineChart>
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
