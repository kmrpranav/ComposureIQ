import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { INFO } from '../sensors'

/**
 * Small "i" button that shows what a reading means on hover or keyboard focus.
 * The overlay renders in a portal so chart containers never clip it.
 */
export default function InfoTip({ k, className = '' }) {
  const info = INFO[k]
  const btn = useRef(null)
  const [pos, setPos] = useState(null)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const W = 272
    const left = Math.min(Math.max(12, r.left + r.width / 2 - W / 2), window.innerWidth - W - 12)
    const below = r.bottom + 8 + 170 < window.innerHeight
    setPos({ left, top: below ? r.bottom + 8 : undefined, bottom: below ? undefined : window.innerHeight - r.top + 8, W })
  }, [open])

  if (!info) return null
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`About ${info.title}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-strong font-serif text-[10px] italic leading-none text-faint transition hover:border-accent hover:text-accent focus:border-accent focus:text-accent focus:outline-none ${className}`}
      >
        i
      </button>
      {open && pos && createPortal(
        <div
          role="tooltip"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.W }}
          className="pointer-events-none fixed z-50 rounded-md border border-line bg-card p-3 text-left shadow-[0_6px_24px_rgba(30,42,54,0.12)]"
        >
          <div className="text-[12px] font-semibold text-ink">{info.title}</div>
          <p className="mt-1 text-[11.5px] leading-snug text-muted">{info.what}</p>
          <p className="mt-1.5 text-[11.5px] leading-snug text-ink/80">{info.why}</p>
          {info.good && (
            <div className="mt-2 border-t border-line pt-1.5 font-mono text-[10px] text-accent">{info.good}</div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
