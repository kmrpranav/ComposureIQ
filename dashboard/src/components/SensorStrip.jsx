import { Area, AreaChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts'
import { C, SENSORS, last } from '../sensors'
import InfoTip from './InfoTip'

function Tile({ s, rows, gate }) {
  const v = last(rows, s.key)
  const gated = ['rmssd', 'spo2', 'heading'].includes(s.key)
  const paused = gated && gate === 'SPEAKING'
  const data = rows.slice(-90)
  return (
    <div className="panel px-3 pt-2.5 pb-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] font-medium text-ink">{s.name}</span>
        <InfoTip k={s.key} />
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] text-faint">
          {paused ? 'paused while moving' : s.sub}
        </span>
        <span className={`font-mono transition-opacity ${paused ? 'opacity-40' : ''}`}>
          <span className="text-[19px] font-medium text-ink">{v == null ? '—' : Number(v).toFixed(s.digits)}</span>
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
            <YAxis hide domain={s.domain} allowDataOverflow />
            {s.threshold && <ReferenceLine y={s.threshold} stroke={C.faint} strokeDasharray="3 3" />}
            <Area type="monotone" dataKey={s.key} stroke={C.accent} strokeWidth={1.4} fill={C.accentSoft}
              fillOpacity={0.7} isAnimationActive={false} connectNulls dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function SensorStrip({ telemetry, gate }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {SENSORS.map((s) => <Tile key={s.key} s={s} rows={telemetry} gate={gate} />)}
    </div>
  )
}
