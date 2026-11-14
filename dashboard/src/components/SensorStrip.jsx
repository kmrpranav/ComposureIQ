import { Area, AreaChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts'
import { C, SCALE_GRADIENT, SENSORS, last, score, scoreColor, scoreWord } from '../sensors'
import InfoTip from './InfoTip'

const word = (key, sc) => {
  if (sc == null) return null
  if (key === 'distance_m') return sc >= 0.99 ? 'at venue' : sc > 0.5 ? 'approaching' : 'far'
  if (key === 'accel_var' || key === 'gyro_mag') return sc >= 0.66 ? 'steady' : sc >= 0.33 ? 'active' : 'restless'
  if (key === 'heading') return sc >= 0.66 ? 'settled' : sc >= 0.33 ? 'shifting' : 'swiveling'
  return scoreWord(sc)
}

/**
 * Horizontal gradient stops so each stretch of the sparkline takes the colour of
 * its own score: the line turns amber/red exactly where the reading went wrong.
 */
function scoreStops(key, rows, data) {
  const start = rows.length - data.length
  const n = data.length
  let prev = null
  const out = []
  for (let i = 0; i < n; i++) {
    const at = start + i
    const sc = data[i][key] == null ? prev : score(key, rows.slice(Math.max(0, at - 15), at + 1))
    prev = sc ?? prev
    out.push({ offset: n > 1 ? i / (n - 1) : 0, color: scoreColor(prev) })
  }
  return out
}

function Tile({ s, rows, gate }) {
  const v = last(rows, s.key)
  const gated = ['rmssd', 'spo2', 'heading'].includes(s.key)
  const paused = gated && gate === 'SPEAKING'
  const sc = score(s.key, rows)
  const col = scoreColor(sc)
  const data = rows.slice(-90)
  const stops = scoreStops(s.key, rows, data)
  const gid = `score-${s.key}`
  return (
    <div className="panel relative overflow-hidden px-3 pt-2.5 pb-0">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-ink">{s.name}</span>
          <InfoTip k={s.key} />
        </div>
        {sc != null && !paused && (
          <span className="font-mono text-[10px] font-medium transition-colors duration-500" style={{ color: col }}>
            {word(s.key, sc)}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] text-faint">
          {paused ? 'paused while moving' : s.sub}
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
      <div className="-mx-3 h-11">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
                {stops.map((st, i) => <stop key={i} offset={st.offset} stopColor={st.color} />)}
              </linearGradient>
            </defs>
            <YAxis hide domain={s.domain} allowDataOverflow />
            {s.threshold && <ReferenceLine y={s.threshold} stroke={C.faint} strokeDasharray="3 3" />}
            <Area type="monotone" dataKey={s.key} stroke={`url(#${gid})`} strokeWidth={1.8} fill={`url(#${gid})`}
              fillOpacity={0.22} isAnimationActive={false} connectNulls dot={false} />
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

export default function SensorStrip({ telemetry, gate }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <span className="label">8 sensors · colored by how calm each reading is</span>
        <ScaleLegend />
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {SENSORS.map((s) => <Tile key={s.key} s={s} rows={telemetry} gate={gate} />)}
      </div>
    </div>
  )
}
