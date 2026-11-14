import { useCallback, useEffect, useRef, useState } from 'react'

export const post = (path, body) =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => null)

const empty = { telemetry: [], transcript: [], callouts: [], events: [], stage: null, interim: '' }

/** Live session state: initial GET /api/session, then the /ws/flight-recorder stream. */
export function useSpine() {
  const [s, setS] = useState(empty)
  const [connected, setConnected] = useState(false)

  const load = useCallback(async () => {
    const d = await fetch('/api/session').then((r) => r.json()).catch(() => null)
    if (d) setS({ ...empty, ...d })
  }, [])

  useEffect(() => {
    let ws, ping, retry, alive = true
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws/flight-recorder`)
      ws.onopen = () => { setConnected(true); load(); ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 10000) }
      ws.onclose = () => { setConnected(false); clearInterval(ping); if (alive) retry = setTimeout(connect, 1000) }
      ws.onmessage = (m) => {
        const { type, data } = JSON.parse(m.data)
        setS((p) => {
          switch (type) {
            case 'telemetry': return { ...p, telemetry: [...p.telemetry, data] }
            case 'transcript': return { ...p, transcript: [...p.transcript, data], interim: '' }
            case 'interim': return { ...p, interim: data.text }
            case 'callout': return { ...p, callouts: [...p.callouts, data] }
            case 'event': return { ...p, events: [...p.events, data] }
            case 'stage': return { ...p, stage: data }
            case 'hello': return { ...p, stage: data.stage }
            case 'reset': return { ...empty }
            default: return p
          }
        })
      }
    }
    connect()
    return () => { alive = false; clearTimeout(retry); clearInterval(ping); ws && ws.close() }
  }, [load])

  return { ...s, connected }
}

/**
 * Laptop microphone: Web Audio RMS voice-activity detector (with hangover) +
 * Web Speech API continuous transcript. Streams both to FastAPI.
 */
export function useMic() {
  const [on, setOn] = useState(false)
  const [level, setLevel] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [speechSupported] = useState(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition))
  const [error, setError] = useState(null)
  const refs = useRef({})

  const stop = useCallback(() => {
    const r = refs.current
    r.stopped = true
    cancelAnimationFrame(r.raf)
    clearInterval(r.hb)
    r.stream?.getTracks().forEach((t) => t.stop())
    r.ctx?.close()
    try { r.rec?.stop() } catch {}
    refs.current = {}
    setOn(false); setSpeaking(false); setLevel(0)
    post('/api/mic', { speaking: false, level: 0 })
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 1024
      src.connect(an)
      const buf = new Float32Array(an.fftSize)
      const r = { stream, ctx, an, stopped: false, noise: 0.01, lastVoice: 0, speaking: false, level: 0 }
      refs.current = r

      const send = () => post('/api/mic', { speaking: r.speaking, level: r.level })
      const loop = () => {
        an.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)
        // adaptive noise floor
        if (!r.speaking) r.noise = r.noise * 0.995 + rms * 0.005
        const now = performance.now()
        if (rms > Math.max(0.015, r.noise * 3)) r.lastVoice = now
        const sp = now - r.lastVoice < 700 // hangover
        r.level = Math.min(1, rms * 8)
        setLevel(r.level)
        if (sp !== r.speaking) { r.speaking = sp; setSpeaking(sp); send() }
        r.raf = requestAnimationFrame(loop)
      }
      loop()
      r.hb = setInterval(send, 1000) // heartbeat so server-side timeout doesn't drop us

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition
      if (SR) {
        const rec = new SR()
        rec.continuous = true
        rec.interimResults = true
        rec.lang = 'en-US'
        rec.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i]
            post('/api/transcript', { text: res[0].transcript, final: res.isFinal })
          }
        }
        rec.onerror = (e) => e.error !== 'no-speech' && setError(`speech: ${e.error}`)
        rec.onend = () => { if (!r.stopped) try { rec.start() } catch {} }
        rec.start()
        r.rec = rec
      }
      setOn(true)
    } catch (e) {
      setError(e.message || String(e))
    }
  }, [])

  useEffect(() => () => refs.current.stream && stop(), [stop])

  return { on, level, speaking, speechSupported, error, start, stop }
}

export const fmtT = (t) => {
  t = Math.max(0, Math.floor(t || 0))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
