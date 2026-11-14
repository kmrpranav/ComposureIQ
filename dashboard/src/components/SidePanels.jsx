import { useEffect, useRef, useState } from 'react'
import { fmtT, post } from '../hooks'

const SPEAKER_MODES = [
  { id: 'auto', label: 'Auto-Sort' },
  { id: 'interviewer', label: 'Interviewer (Q)' },
  { id: 'candidate', label: 'You (A)' },
]

export function Transcript({ transcript, interim, callouts, mic, stage, onJump }) {
  const ref = useRef(null)
  const [filter, setFilter] = useState('all')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [transcript.length, interim, mic?.speaking, mic?.sttStatus])

  const flagged = new Set(callouts.map((c) => c.question_id))
  const speakerMode = mic?.speakerMode ?? stage?.speaker_mode ?? 'auto'
  const qCount = transcript.filter((l) => l.is_question || l.kind === 'question').length
  const aCount = transcript.length - qCount

  const visible = transcript.filter((l) => {
    const isQ = l.is_question || l.kind === 'question'
    if (filter === 'q') return isQ
    if (filter === 'a') return !isQ
    return true
  })

  const sendDraft = async (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await post('/api/transcript', {
      text,
      final: true,
      speaker_mode: speakerMode,
      engine: 'manual-input',
    })
  }

  const flipKind = (e, id) => {
    e.stopPropagation()
    post('/api/control', { action: 'toggle_transcript_kind', id })
  }

  const statusText = !mic?.on
    ? 'Mic off'
    : mic.sttStatus === 'transcribing'
      ? 'Transcribing…'
      : mic.sttNote
        ? `Mic live · ${mic.sttNote}`
        : 'Mic live · Auto-sorting'

  return (
    <div className="panel flex min-h-0 flex-1 flex-col p-3">
      {/* Row 1: Title + Mic Connect button */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-[13px] font-semibold text-ink">Transcript · Q&amp;A Sort</div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9.5px] ${
              mic?.on
                ? mic.sttStatus === 'transcribing'
                  ? 'bg-note-soft text-note'
                  : 'bg-accent-soft text-accent'
                : 'bg-sunk text-faint'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                mic?.on ? (mic.speaking ? 'animate-ping bg-alert' : 'bg-accent') : 'bg-faint'
              }`}
            />
            {statusText}
          </span>
        </div>

        <button
          type="button"
          onClick={() => (mic?.on ? mic.stop() : mic?.start())}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition active:translate-y-px ${
            mic?.on
              ? 'border border-accent bg-accent-soft text-accent'
              : 'bg-accent text-white hover:bg-accent/90'
          }`}
        >
          <span>{mic?.on ? 'Mic Active' : 'Connect System Mic'}</span>
          {mic?.on && (
            <span className="h-1 w-9 overflow-hidden rounded-full bg-white">
              <span className="block h-full bg-accent transition-[width] duration-75" style={{ width: `${mic.level * 100}%` }} />
            </span>
          )}
          {mic?.on && mic.pitchHz && (
            <span className="font-mono text-[9.5px] text-ink/80">{Math.round(mic.pitchHz)}Hz</span>
          )}
        </button>
      </div>

      {/* Row 2: System Mic Device Picker + Speaker Mode */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 border-b border-line pb-2">
        <select
          aria-label="System Microphone"
          value={mic?.deviceId ?? ''}
          onChange={(e) => mic?.selectDevice(e.target.value)}
          className="min-w-0 max-w-[165px] flex-1 truncate rounded border border-line bg-sunk px-2 py-1 text-[10.5px] text-ink focus:border-accent focus:outline-none"
        >
          <option value="">Default System Mic</option>
          {(mic?.devices ?? []).map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-0.5 rounded border border-line bg-sunk p-0.5">
          {SPEAKER_MODES.map((m) => {
            const active = speakerMode === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => mic?.setSpeakerMode(m.id)}
                className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                  active ? 'bg-card font-medium text-accent shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'
                }`}
              >
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Row 3: Filter Tabs + Inline Test Input */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[10.5px]">
          {[
            { id: 'all', label: `All (${transcript.length})` },
            { id: 'q', label: `Questions (${qCount})` },
            { id: 'a', label: `Answers (${aCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded-full px-2 py-0.5 font-medium transition ${
                filter === tab.id ? 'bg-ink text-white' : 'bg-sunk text-muted hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mic?.error && <span className="text-[10px] text-alert">{mic.error}</span>}
      </div>

      <form onSubmit={sendDraft} className="mt-1.5 flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Or type a sentence to test Q/A sorting…"
          className="min-w-0 flex-1 rounded border border-line bg-sunk px-2 py-1 text-[11px] text-ink placeholder:text-faint focus:border-accent focus:bg-card focus:outline-none"
        />
        <button
          type="submit"
          className="rounded border border-line bg-card px-2 py-1 text-[10.5px] font-medium text-ink transition hover:border-accent hover:text-accent"
        >
          Send
        </button>
      </form>

      {/* Row 4: Threaded Q&A Stream */}
      <div ref={ref} className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {visible.length === 0 && !interim && !mic?.speaking && mic?.sttStatus !== 'transcribing' && (
          <div className="py-5 text-center text-[11.5px] leading-relaxed text-faint">
            Click <strong className="text-ink">Connect System Mic</strong> and speak. Sentences automatically sort into{' '}
            <span className="text-note">Questions (Interviewer)</span> and{' '}
            <span className="text-accent">Answers (You)</span>.
          </div>
        )}

        {visible.map((l) => {
          const isQ = l.is_question || l.kind === 'question'
          const isFlag = flagged.has(l.id)
          const m = l.metrics

          if (isQ) {
            return (
              <div
                key={l.id}
                role="button"
                tabIndex={0}
                onClick={() => onJump(l.t)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onJump(l.t)}
                className={`cursor-pointer rounded-md border-l-2 px-2.5 py-1.5 text-left transition hover:brightness-[0.98] ${
                  isFlag ? 'border-alert bg-alert-soft/55' : 'border-note bg-note-soft/55'
                }`}
              >
                <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[9.5px] text-faint">{fmtT(l.t)}</span>
                  <button
                    type="button"
                    onClick={(e) => flipKind(e, l.id)}
                    title="Click to reclassify as Answer (You)"
                    className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold transition ${
                      isFlag
                        ? 'bg-alert/15 text-alert hover:bg-alert/25'
                        : 'bg-note/15 text-note hover:bg-note/25'
                    }`}
                  >
                    Q · {l.speaker_label ?? 'Interviewer'} ⇄
                  </button>
                  <span className="rounded bg-card/80 px-1.5 py-0.5 font-mono text-[9px] text-muted ring-1 ring-line">
                    {l.format_tag ?? 'Question'}
                  </span>
                  {isFlag && (
                    <span className="rounded bg-alert px-1.5 py-0.5 font-mono text-[9px] font-medium text-white">
                      Flagged Spike
                    </span>
                  )}
                </div>
                <div className="text-[12.5px] font-medium leading-snug text-ink">{l.text}</div>
              </div>
            )
          }

          return (
            <div
              key={l.id}
              role="button"
              tabIndex={0}
              onClick={() => onJump(l.t)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onJump(l.t)}
              className="ml-3 cursor-pointer rounded-md border-l-2 border-accent bg-accent-soft/35 px-2.5 py-1.5 text-left transition hover:bg-accent-soft/55"
            >
              <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[9.5px] text-faint">{fmtT(l.t)}</span>
                <button
                  type="button"
                  onClick={(e) => flipKind(e, l.id)}
                  title="Click to reclassify as Question (Interviewer)"
                  className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-accent transition hover:bg-accent/25"
                >
                  A · {l.speaker_label ?? 'You'} ⇄
                </button>
                <span className="rounded bg-card/80 px-1.5 py-0.5 font-mono text-[9px] text-muted ring-1 ring-line">
                  {l.format_tag ?? 'Answer'}
                </span>
                {l.pitch_hz != null && (
                  <span className="font-mono text-[9px] text-faint">{Math.round(l.pitch_hz)} Hz</span>
                )}
              </div>
              <div className="text-[12.5px] leading-snug text-ink/90">{l.text}</div>
              {m && (m.peak_hr != null || m.fidget_avg != null || m.pacer_fired) && (
                <div className="mt-1 flex flex-wrap gap-1 font-mono text-[9.5px]">
                  {m.peak_hr != null && (
                    <span className="rounded border border-line bg-card px-1.5 py-0.5 text-muted">
                      Peak <strong className={m.hr_delta > 15 ? 'text-alert' : 'text-ink'}>{Math.round(m.peak_hr)} bpm</strong>
                      {m.hr_delta != null ? ` (${m.hr_delta >= 0 ? '+' : ''}${Math.round(m.hr_delta)})` : ''}
                    </span>
                  )}
                  {m.fidget_avg != null && (
                    <span className="rounded border border-line bg-card px-1.5 py-0.5 text-muted">
                      Fidget <strong className="text-ink">{m.fidget_avg}%</strong>
                    </span>
                  )}
                  {m.pacer_fired && (
                    <span className="rounded border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
                      60-BPM Pacer ✓
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {interim && (
          <div className="rounded-md border border-dashed border-line-strong bg-sunk px-2.5 py-1.5 text-[12px] italic text-muted">
            <span className="mr-1.5 font-mono text-[9.5px] not-italic text-accent">
              {speakerMode === 'interviewer' ? 'Interviewer…' : speakerMode === 'candidate' ? 'You…' : 'Listening…'}
            </span>
            {interim}…
          </div>
        )}

        {!interim && (mic?.speaking || mic?.sttStatus === 'transcribing') && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-accent/60 bg-accent-soft/25 px-2.5 py-1.5 text-[11.5px] text-ink">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  mic.sttStatus === 'transcribing' ? 'animate-pulse bg-note' : 'animate-pulse bg-alert'
                }`}
              />
              <span>
                {mic.sttStatus === 'transcribing'
                  ? 'Transcribing utterance via backend STT…'
                  : 'Capturing voice audio…'}
              </span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[9.5px] text-muted">
              <span>{Math.round((mic.level ?? 0) * 100)}%</span>
              {mic.pitchHz != null && <span>{Math.round(mic.pitchHz)} Hz</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function Callouts({ callouts, hasQuestions, onJump }) {
  return (
    <div className="panel flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-ink">Stress moments</div>
        <div className="flex items-center gap-2">
          {hasQuestions && (
            <button
              type="button"
              onClick={() => post('/api/control', { action: 'evaluate_now' })}
              className="rounded border border-line bg-sunk px-2 py-0.5 text-[10.5px] font-medium text-accent transition hover:border-accent hover:bg-accent-soft"
            >
              Evaluate spike now
            </button>
          )}
          <div className="font-mono text-[10px] text-faint">{callouts.length} flagged</div>
        </div>
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
