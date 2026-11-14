import { Area, AreaChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts'
import { C, SCALE_GRADIENT, SENSORS, buildColorStops, last, score, scoreColor, scoreWord } from '../sensors'
import InfoTip from './InfoTip'

const word = (key, sc) => {
  if (sc == null) return null
  if (key === 'accel_var' || key === 'gyro_mag') return sc >= 0.66 ? 'steady' : sc >= 0.33 ? 'active' : 'restless'
  return scoreWord(sc)
}

function Tile({ s, rows, gate, active, onToggle }) {
  const v = last(rows, s.key)
  const paused = s.gated && gate === 'SPEAKING'
  const sc = score(s.key, rows)
  const col = scoreColor(sc)
  const data = rows.slice(-90)
  const stops = buildColorStops(s.key, data)
  const lineCol = sc != null ? col : C.good

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onToggle?.(s.key)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle?.(s.key))}
      title={`Click to toggle ${s.name} in Flight Recorder (${s.role})`}
      className={`panel relative cursor-pointer overflow-visible px-3 pt-2.5 pb-0 transition ${
        active ? 'border-accent/55 ring-1 ring-accent/20' : 'hover:border-line-strong'
      }`}
    >
      <span className="absolute inset-y-2 left-0 w-[3px] rounded-r transition-colors duration-500" style={{ background: col }} />

      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="rounded bg-sunk px-1 py-0.5 font-mono text-[9px] font-medium text-muted ring-1 ring-line">
            #{s.num}
          </span>
          <span className="truncate text-[12px] font-medium text-ink">{s.name}</span>
          <span onClick={(e) => e.stopPropagation()} className="inline-flex">
            <InfoTip k={s.key} />
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {sc != null && !paused && (
            <span className="font-mono text-[10px] font-medium transition-colors duration-500" style={{ color: col }}>
              {word(s.key, sc)}
            </span>
          )}
          <span
            className={`h-1.5 w-1.5 rounded-full transition ${active ? 'bg-accent' : 'bg-line-strong'}`}
            title={active ? 'Plotted in Flight Recorder' : 'Hidden in Flight Recorder'}
          />
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between gap-1.5">
        <span className="truncate rounded bg-sunk px-1.5 py-0.5 font-mono text-[9px] text-muted" title={s.api}>
          {s.api}
        </span>
        {s.gated && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-medium ${
              paused ? 'bg-note-soft text-note' : 'bg-accent-soft text-accent'
            }`}
          >
            {paused ? '⏸ Gated (Moving)' : '✓ Stillness Trusted'}
          </span>
        )}
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] text-faint">
          {paused ? 'paused while speaking' : s.sub}
        </span>
        <span className={`font-mono transition-opacity ${paused ? 'opacity-40' : ''}`}>
          <span className="text-[19px] font-medium transition-colors duration-500" style={{ color: paused ? C.faint : col }}>
            {v == null ? '—' : Number(v).toFixed(s.digits)}
          </span>
          <span className="ml-0.5 text-[10px] text-faint">{s.unit}</span>
        </span>
      </div>

      {s.key === 'accel_var' && (
        <div className="font-mono text-[10px] text-faint">
          pitch {Number(last(rows, 'pitch') ?? 0).toFixed(0)}° · roll {Number(last(rows, 'roll') ?? 0).toFixed(0)}°
        </div>
      )}

      <div className="-mx-3 h-10">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`tile-stroke-${s.key}`} x1="0" y1="0" x2="1" y2="0">
                {stops.map((st, idx) => (
                  <stop key={idx} offset={st.offset} stopColor={st.color} stopOpacity={1} />
                ))}
              </linearGradient>
              <linearGradient id={`tile-fill-${s.key}`} x1="0" y1="0" x2="1" y2="0">
                {stops.map((st, idx) => (
                  <stop key={idx} offset={st.offset} stopColor={st.color} stopOpacity={0.32} />
                ))}
              </linearGradient>
            </defs>
            <YAxis hide domain={s.domain} allowDataOverflow />
            {s.threshold && <ReferenceLine y={s.threshold} stroke={C.faint} strokeDasharray="3 3" />}
            <Area
              type="monotone"
              dataKey={s.key}
              stroke={stops.length > 1 ? `url(#tile-stroke-${s.key})` : lineCol}
              strokeWidth={1.7}
              fill={stops.length > 1 ? `url(#tile-fill-${s.key})` : lineCol}
              fillOpacity={stops.length > 1 ? 1 : 0.32}
              baseValue="dataMin"
              isAnimationActive={false}
              connectNulls
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function ScaleLegend() {
  return (
    <span className="inline-flex items-center gap-2 text-[10.5px] text-muted">
      <span>high</span>
      <span className="h-1.5 w-20 rounded-full" style={{ background: SCALE_GRADIENT }} />
      <span>calm</span>
    </span>
  )
}

export default function SensorStrip({ telemetry, gate, activeChannels = [], onToggleChannel }) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-0.5">
        <span className="label">6 Garmin Fenix 7 Pro sensors · click any tile to toggle in flight recorder</span>
        <ScaleLegend />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SENSORS.map((s) => (
          <Tile
            key={s.key}
            s={s}
            rows={telemetry}
            gate={gate}
            active={activeChannels.includes(s.key)}
            onToggle={onToggleChannel}
          />
        ))}
      </div>
    </div>
  )
}
