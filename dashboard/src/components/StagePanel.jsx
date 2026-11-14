import { fmtT, post } from '../hooks'
import { last } from '../sensors'
import { PHASES } from './Navbar'

const STAGE_INFO = {
  IDLE: {
    does: 'The watch tracks your GPS distance to the venue from the calendar event. Nothing vibrates.',
    next: 'Within 100 m of the venue and 15 min of the start time, or Venue arrival is pressed.',
  },
  PRIMER: {
    does: 'Guided physiological sigh every 10 s: two short "inhale" pulses, then one long, gentle "exhale" pulse. It watches HRV, SpO₂ and skin temperature recover.',
    next: 'HRV reaches 55 ms after at least 20 s, 90 s pass, you start speaking, or START is pressed.',
  },
  LIVE: {
    does: 'The screen dims to a plain analog face. Wrist motion decides Speaking vs Listening. No vibration ever fires while you speak.',
    next: 'Back button or Finish & Save on the watch.',
  },
  DONE: {
    does: 'Session saved to the .FIT file with the composure and fidget fields. Review the flight recorder below.',
    next: 'Reset starts a new session.',
  },
}

const PACER_KINDS = new Set(['pacer', 'pacer_decision', 'pacer_debug'])

export default function StagePanel({ telemetry, events, stage }) {
  const row = telemetry[telemetry.length - 1]
  const phase = row?.phase ?? stage?.phase ?? 'IDLE'
  const idx = PHASES.findIndex((p) => p.id === phase)
  const phaseEv = [...events].reverse().find((e) => e.kind === 'phase' && e.reason)

  const base = last(telemetry, 'baseline_hr') ?? 72
  const peak = row?.gate === 'SPEAKING' ? row?.peak_hr : last(telemetry, 'peak_hr')
  const delta = peak != null ? peak - base : null
  const still = row?.gate === 'SPEAKING' ? row?.still_ms ?? 0 : null
  const pacerLog = events.filter((e) => PACER_KINDS.has(e.kind)).slice(-6).reverse()

  return (
    <div className="panel flex flex-col p-3">
      <div className="text-[13px] font-semibold text-ink">Stage & pacer</div>

      {/* Stage stepper with reasoning */}
      <ol className="mt-2.5 space-y-1.5">
        {PHASES.map((p, i) => {
          const cur = i === idx, done = i < idx
          return (
            <li key={p.id} className={`rounded-md border px-2.5 py-2 transition ${cur ? 'border-accent/40 bg-accent-soft/60' : 'border-transparent'}`}>
              <div className="flex items-center gap-2">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px] ${
                  cur ? 'bg-accent text-white' : done ? 'bg-line-strong text-white' : 'border border-line-strong text-faint'}`}>
                  {done ? '✓' : i + 1}
                </span>
                <span className={`text-[12px] font-medium ${cur ? 'text-accent' : done ? 'text-muted' : 'text-faint'}`}>{p.label}</span>
              </div>
              {cur && (
                <div className="mt-1.5 space-y-1.5 pl-6 text-[11.5px] leading-snug">
                  <p className="text-ink/85">{STAGE_INFO[p.id].does}</p>
                  {phaseEv && phaseEv.phase === p.id && (
                    <p className="text-muted"><span className="font-medium text-ink">Why now: </span>{phaseEv.reason} <span className="font-mono text-[10px] text-faint">({fmtT(phaseEv.t)})</span></p>
                  )}
                  <p className="text-muted"><span className="font-medium text-ink">Moves on when: </span>{STAGE_INFO[p.id].next}</p>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {/* Pacer debug */}
      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-center justify-between">
          <span className="label">Pacer debug</span>
          <button onClick={() => post('/api/control', { action: 'force_pacer' })} disabled={stage?.force_pending}
            className="rounded border border-line bg-card px-2 py-0.5 text-[11px] text-ink transition hover:border-accent hover:text-accent disabled:opacity-50">
            {stage?.force_pending ? 'Waiting for watch…' : 'Force pacer'}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted">
          Fires when you have been still for 2.5 s after an answer in which HR peaked more than 15 bpm above baseline. Live stage only.
        </p>

        <div className="mt-2 grid grid-cols-3 gap-1.5 font-mono text-[10.5px]">
          <Readout k="baseline" v={`${base.toFixed(0)} bpm`} />
          <Readout k="peak (answer)" v={peak != null ? `${peak.toFixed(0)} bpm` : '—'} />
          <Readout k="Δ vs +15" v={delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}` : '—'}
            tone={delta == null ? '' : delta > 15 ? 'text-alert' : 'text-ink'} />
        </div>
        <div className="mt-1.5">
          <div className="flex justify-between font-mono text-[10px] text-faint">
            <span>stillness</span>
            <span>{still == null ? 'listening' : `${(Math.min(still, 2500) / 1000).toFixed(1)} / 2.5 s`}</span>
          </div>
          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-sunk ring-1 ring-line">
            <div className="h-full bg-accent transition-[width] duration-700"
              style={{ width: `${still == null ? 100 : Math.min(100, (still / 2500) * 100)}%` }} />
          </div>
        </div>

        <ul className="mt-2.5 space-y-1.5">
          {pacerLog.length === 0 && <li className="text-[11px] text-faint">No pacer activity yet.</li>}
          {pacerLog.map((e) => (
            <li key={e.id} className="text-[11px] leading-snug">
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(e)}`} />
                <span className="font-mono text-[10px] text-faint">{fmtT(e.t)}</span>
                <span className="font-medium text-ink">{e.label}</span>
              </div>
              {e.reason && <p className="pl-3 text-muted">{e.reason}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const dot = (e) => {
  if (e.kind === 'pacer' || (e.kind === 'pacer_decision' && e.fired)) return 'bg-accent'
  if (e.label?.includes('not confirmed')) return 'bg-alert'
  if (e.kind === 'pacer_decision') return 'bg-faint'
  return 'bg-note'
}

const Readout = ({ k, v, tone = 'text-ink' }) => (
  <div className="rounded border border-line bg-sunk px-1.5 py-1">
    <div className="text-[9px] uppercase tracking-wider text-faint">{k}</div>
    <div className={tone}>{v}</div>
  </div>
)
