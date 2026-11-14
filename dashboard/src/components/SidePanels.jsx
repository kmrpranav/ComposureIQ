import { useEffect, useRef } from 'react'
import { fmtT } from '../hooks'

export function Transcript({ transcript, interim, callouts, onJump }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }) }, [transcript.length, interim])
  const flagged = new Set(callouts.map((c) => c.question_id))
  return (
    <div className="panel flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-ink">Transcript</div>
        <div className="font-mono text-[10px] text-faint">live</div>
      </div>
      <div ref={ref} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {transcript.length === 0 && !interim && (
          <div className="py-6 text-center text-[12px] text-faint">Start the mic and ask a question.</div>
        )}
        {transcript.map((l) => {
          const isFlag = flagged.has(l.id)
          return (
            <button key={l.id} onClick={() => onJump(l.t)}
              className={`block w-full rounded-md border-l-2 px-2.5 py-1.5 text-left text-[13px] leading-snug transition hover:bg-sunk ${
                l.is_question ? (isFlag ? 'border-alert bg-alert-soft/60' : 'border-note bg-note-soft/60') : 'border-transparent'}`}>
              <span className="mr-2 font-mono text-[10px] text-faint">{fmtT(l.t)}</span>
              {l.is_question && (
                <span className={`mr-1.5 font-mono text-[10px] font-medium ${isFlag ? 'text-alert' : 'text-note'}`}>Q</span>
              )}
              <span className={l.is_question ? 'text-ink' : 'text-muted'}>{l.text}</span>
            </button>
          )
        })}
        {interim && <div className="px-2.5 text-[13px] italic text-faint">{interim}…</div>}
      </div>
    </div>
  )
}

export function Callouts({ callouts, onJump }) {
  return (
    <div className="panel flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-ink">Stress moments</div>
        <div className="font-mono text-[10px] text-faint">{callouts.length} flagged</div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {callouts.length === 0 && (
          <div className="py-4 text-center text-[12px] leading-relaxed text-faint">
            18 s after each question, the readings are compared with the 30 s before it.
          </div>
        )}
        {[...callouts].reverse().map((c) => (
          <button key={c.id} onClick={() => onJump(c.t)}
            className="block w-full rounded-md border border-line bg-sunk p-2.5 text-left transition hover:border-line-strong hover:bg-card">
            <div className="mb-1 flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${c.severity === 'high' ? 'bg-alert' : 'bg-note'}`} />
              <span className="font-mono text-[10px] text-muted">{fmtT(c.t)} · {c.severity}</span>
            </div>
            <div className="text-[12.5px] leading-snug text-ink">{c.text}</div>
            <div className="mt-2 flex flex-wrap gap-1 font-mono text-[10px]">
              <Chip k="ΔHR" v={`${c.metrics.hr_delta > 0 ? '+' : ''}${c.metrics.hr_delta}`} />
              <Chip k="fidget" v={`${c.metrics.fidget_pct}%`} />
              <Chip k="jerk" v={`${c.metrics.jerk_ratio}×`} />
              <Chip k="SpO₂" v={`-${c.metrics.spo2_dip}`} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

const Chip = ({ k, v }) => (
  <span className="rounded border border-line bg-card px-1.5 py-0.5 text-muted">{k} <span className="text-ink">{v}</span></span>
)
