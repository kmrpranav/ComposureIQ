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
            case 'transcript_update':
              return { ...p, transcript: p.transcript.map((item) => (item.id === data.id ? data : item)) }
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

function estimatePitchHz(buf, sampleRate) {
  let sumSq = 0
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i]
  const rms = Math.sqrt(sumSq / buf.length)
  if (rms < 0.015) return null

  const minLag = Math.floor(sampleRate / 350)
  const maxLag = Math.min(Math.floor(buf.length / 2), Math.ceil(sampleRate / 75))
  let bestLag = -1
  let bestCorr = 0

  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0
    let e1 = 0
    let e2 = 0
    const len = buf.length - lag
    for (let i = 0; i < len; i++) {
      const a = buf[i]
      const b = buf[i + lag]
      dot += a * b
      e1 += a * a
      e2 += b * b
    }
    const denom = Math.sqrt(e1 * e2)
    if (denom > 0) {
      const corr = dot / denom
      if (corr > bestCorr) {
        bestCorr = corr
        bestLag = lag
      }
    }
  }
  if (bestLag <= 0 || bestCorr < 0.45) return null
  return Math.round((sampleRate / bestLag) * 10) / 10
}

const CAPTURE_RATE = 22050

function resampleLinear(input, srcRate, dstRate = CAPTURE_RATE) {
  if (srcRate === dstRate) return new Float32Array(input)
  const ratio = srcRate / dstRate
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const s0 = input[idx] ?? 0
    const s1 = idx + 1 < input.length ? input[idx + 1] : s0
    out[i] = s0 + (s1 - s0) * frac
  }
  return out
}

function encodeWavB64(samples, sampleRate = CAPTURE_RATE) {
  const dataBytes = samples.length * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)

  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
  }
  const gain = peak >= 0.008 && peak < 0.75 ? Math.min(12, 0.85 / peak) : 1

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i] * gain))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }

  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * System microphone: device enumeration + Web Audio RMS VAD + pitch estimator +
 * dual Speech-to-Text (Web Speech API for interim/Chrome + FastAPI /api/transcribe-audio fallback).
 */
export function useMic() {
  const [on, setOn] = useState(false)
  const [level, setLevel] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [speechSupported] = useState(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition))
  const [error, setError] = useState(null)
  const [devices, setDevices] = useState([])
  const [deviceId, setDeviceId] = useState('')
  const [speakerMode, setSpeakerModeState] = useState('auto')
  const [sttStatus, setSttStatus] = useState('idle')
  const [sttNote, setSttNote] = useState(null)
  const [pitchHz, setPitchHz] = useState(null)

  const refs = useRef({})
  const speakerModeRef = useRef('auto')
  const deviceIdRef = useRef('')

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const inputs = list
        .filter((d) => d.kind === 'audioinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `System Microphone ${idx + 1}`,
        }))
      setDevices(inputs)
    } catch {}
  }, [])

  useEffect(() => {
    refreshDevices()
    const md = navigator.mediaDevices
    if (!md?.addEventListener) return
    md.addEventListener('devicechange', refreshDevices)
    return () => md.removeEventListener('devicechange', refreshDevices)
  }, [refreshDevices])

  const stop = useCallback(() => {
    const r = refs.current
    if (r.pcmSamples >= CAPTURE_RATE * 0.25) {
      r.flushUtterance?.(true)
    }
    r.stopped = true
    cancelAnimationFrame(r.raf)
    clearInterval(r.hb)
    r.timers?.forEach((t) => clearTimeout(t))
    try { r.proc?.disconnect() } catch {}
    try { r.gain?.disconnect() } catch {}
    r.stream?.getTracks().forEach((t) => t.stop())
    try { r.ctx?.close() } catch {}
    try { r.rec?.stop() } catch {}
    refs.current = {}
    setOn(false)
    setSpeaking(false)
    setLevel(0)
    setPitchHz(null)
    setSttStatus('idle')
    setSttNote(null)
    post('/api/mic', { speaking: false, level: 0, speaker_mode: speakerModeRef.current })
  }, [])

  const start = useCallback(async (overrideDeviceId) => {
    const targetId = typeof overrideDeviceId === 'string' ? overrideDeviceId : deviceIdRef.current
    setError(null)
    setSttNote(null)
    try {
      const audioConstraint = targetId
        ? { deviceId: { exact: targetId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint })
      refreshDevices()

      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 1024
      src.connect(an)

      // 22.05 kHz PCM capture node for backend STT fallback
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(proc)
      proc.connect(gain)
      gain.connect(ctx.destination)

      const buf = new Float32Array(an.fftSize)
      const r = {
        stream,
        ctx,
        an,
        proc,
        gain,
        stopped: false,
        noise: 0.01,
        lastVoice: 0,
        speaking: false,
        level: 0,
        preRoll: [],
        pcmChunks: [],
        pcmSamples: 0,
        uttStartMs: 0,
        pitchSum: 0,
        pitchCount: 0,
        lastPitch: null,
        lastWebSpeechEventAt: 0,
        lastWebSpeechFinalAt: 0,
        webSpeechFailed: false,
        timers: new Set(),
      }
      refs.current = r

      const flushUtterance = (immediate = false) => {
        if (r.pcmSamples < CAPTURE_RATE * 0.25) {
          r.pcmChunks = []
          r.pcmSamples = 0
          r.pitchSum = 0
          r.pitchCount = 0
          return
        }
        const total = new Float32Array(r.pcmSamples)
        let off = 0
        for (const c of r.pcmChunks) {
          total.set(c, off)
          off += c.length
        }
        const uttStart = r.uttStartMs
        const avgPitch = r.pitchCount > 0 ? Math.round((r.pitchSum / r.pitchCount) * 10) / 10 : r.lastPitch
        r.pcmChunks = []
        r.pcmSamples = 0
        r.pitchSum = 0
        r.pitchCount = 0

        const wavB64 = encodeWavB64(total, CAPTURE_RATE)
        const waitMs = immediate || r.webSpeechFailed || !speechSupported || r.lastWebSpeechEventAt < uttStart ? 0 : 400

        const sendAudio = async () => {
          if (!immediate && r.stopped) return
          if (r.lastWebSpeechFinalAt >= uttStart) return
          setSttStatus('transcribing')
          const res = await post('/api/transcribe-audio', {
            audio_b64: wavB64,
            pitch_hz: avgPitch,
            speaker_mode: speakerModeRef.current,
          })
          if (res?.ok && res?.text) {
            setSttNote(null)
          } else if (res && !res.ok) {
            setSttNote(
              res.error === 'no speech recognized'
                ? 'Voice detected, but words were unclear — try speaking slightly louder'
                : res.error,
            )
          } else if (!res) {
            setSttNote('Backend STT unreachable')
          }
          setSttStatus(r.stopped ? 'idle' : 'listening')
        }

        if (waitMs === 0) {
          void sendAudio()
        } else {
          const timer = setTimeout(() => {
            r.timers.delete(timer)
            void sendAudio()
          }, waitMs)
          r.timers.add(timer)
        }
      }
      r.flushUtterance = flushUtterance

      proc.onaudioprocess = (ev) => {
        if (r.stopped) return
        const input = ev.inputBuffer.getChannelData(0)
        const down = resampleLinear(input, ctx.sampleRate)
        if (r.speaking) {
          r.pcmChunks.push(down)
          r.pcmSamples += down.length
          const pauseMs = performance.now() - r.lastVoice
          if (r.pcmSamples >= CAPTURE_RATE * 5.5 || (pauseMs > 260 && r.pcmSamples >= CAPTURE_RATE * 2.5)) {
            flushUtterance()
            r.uttStartMs = performance.now()
          }
        } else {
          r.preRoll.push(down)
          if (r.preRoll.length > 4) r.preRoll.shift()
        }
      }

      const send = () => post('/api/mic', {
        speaking: r.speaking,
        level: r.level,
        speaker_mode: speakerModeRef.current,
      })

      const loop = () => {
        if (r.stopped) return
        an.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)
        if (!r.speaking) r.noise = r.noise * 0.995 + rms * 0.005
        const now = performance.now()
        if (rms > Math.max(0.015, r.noise * 3)) r.lastVoice = now
        const sp = now - r.lastVoice < 520
        r.level = Math.min(1, rms * 8)
        setLevel(r.level)

        if (sp) {
          const hz = estimatePitchHz(buf, ctx.sampleRate)
          if (hz) {
            r.pitchSum += hz
            r.pitchCount += 1
            r.lastPitch = hz
            setPitchHz(hz)
          }
        }

        if (sp !== r.speaking) {
          r.speaking = sp
          setSpeaking(sp)
          if (sp) {
            r.uttStartMs = now
            r.pcmChunks = [...r.preRoll]
            r.pcmSamples = r.preRoll.reduce((acc, c) => acc + c.length, 0)
            r.preRoll = []
          } else {
            setPitchHz(null)
            flushUtterance()
          }
          send()
        }
        r.raf = requestAnimationFrame(loop)
      }
      loop()
      r.hb = setInterval(send, 1000)

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition
      if (SR) {
        const rec = new SR()
        rec.continuous = true
        rec.interimResults = true
        rec.lang = 'en-US'
        rec.onresult = (e) => {
          r.lastWebSpeechEventAt = performance.now()
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i]
            const avgPitch = r.pitchCount > 0 ? Math.round((r.pitchSum / r.pitchCount) * 10) / 10 : r.lastPitch
            if (res.isFinal) r.lastWebSpeechFinalAt = performance.now()
            post('/api/transcript', {
              text: res[0].transcript,
              final: res.isFinal,
              speaker_mode: speakerModeRef.current,
              pitch_hz: avgPitch,
              engine: 'web-speech',
            })
          }
        }
        rec.onerror = (e) => {
          if (e.error === 'network' || e.error === 'service-not-allowed') {
            r.webSpeechFailed = true
            setSttNote('Backend STT active')
            try { rec.stop() } catch {}
          } else if (e.error !== 'no-speech') {
            setError(`speech: ${e.error}`)
          }
        }
        rec.onend = () => {
          if (!r.stopped && !r.webSpeechFailed) {
            try { rec.start() } catch {}
          }
        }
        rec.start()
        r.rec = rec
      } else {
        r.webSpeechFailed = true
        setSttNote('Backend STT active')
      }

      setOn(true)
      setSttStatus('listening')
    } catch (e) {
      setError(e.message || String(e))
    }
  }, [refreshDevices, speechSupported])

  const selectDevice = useCallback(async (nextId) => {
    deviceIdRef.current = nextId
    setDeviceId(nextId)
    if (refs.current.stream) {
      stop()
      await start(nextId)
    }
  }, [start, stop])

  const setSpeakerMode = useCallback((mode) => {
    speakerModeRef.current = mode
    setSpeakerModeState(mode)
    post('/api/control', { action: 'set_speaker_mode', speaker_mode: mode })
    if (refs.current.stream) {
      post('/api/mic', { speaking: refs.current.speaking, level: refs.current.level, speaker_mode: mode })
    }
  }, [])

  useEffect(() => () => refs.current.stream && stop(), [stop])

  return {
    on,
    level,
    speaking,
    speechSupported,
    error,
    devices,
    deviceId,
    selectDevice,
    speakerMode,
    setSpeakerMode,
    sttStatus,
    sttNote,
    pitchHz,
    start,
    stop,
  }
}

export const fmtT = (t) => {
  t = Math.max(0, Math.floor(t || 0))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
