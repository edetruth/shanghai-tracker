// Sound engine — Web Audio API with two gain channels (SFX + Notification)
// Pattern: same as haptic() — fire-and-forget calls from game handlers

export type SoundName =
  | 'card-draw' | 'card-snap' | 'card-deal' | 'card-shuffle'
  | 'meld-slam' | 'lay-off' | 'joker-swap'
  | 'going-out' | 'shanghai-sting' | 'buy-ding' | 'round-fanfare' | 'win-celebration'
  | 'turn-notify' | 'button-tap' | 'error-buzz' | 'countdown-tick'

type SoundChannel = 'sfx' | 'notification'

const SOUND_CHANNELS: Record<SoundName, SoundChannel> = {
  'card-draw': 'sfx', 'card-snap': 'sfx', 'card-deal': 'sfx', 'card-shuffle': 'sfx',
  'meld-slam': 'sfx', 'lay-off': 'sfx', 'joker-swap': 'sfx',
  'going-out': 'sfx', 'shanghai-sting': 'sfx', 'buy-ding': 'sfx',
  'round-fanfare': 'sfx', 'win-celebration': 'sfx',
  'turn-notify': 'notification', 'button-tap': 'sfx', 'error-buzz': 'sfx', 'countdown-tick': 'sfx',
}

const LS_SFX_KEY = 'shanghai_sfx_volume'
const LS_NOTIF_KEY = 'shanghai_notif_volume'
const MAX_CONCURRENT = 4

let audioCtx: AudioContext | null = null
let sfxGain: GainNode | null = null
let notifGain: GainNode | null = null
const bufferCache = new Map<string, AudioBuffer>()
const activeSources: AudioBufferSourceNode[] = []

function ensureContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
    sfxGain = audioCtx.createGain()
    sfxGain.gain.value = getSfxVolume()
    sfxGain.connect(audioCtx.destination)
    notifGain = audioCtx.createGain()
    notifGain.gain.value = getNotifVolume()
    notifGain.connect(audioCtx.destination)
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

async function loadBuffer(name: string): Promise<AudioBuffer | null> {
  if (bufferCache.has(name)) return bufferCache.get(name)!
  try {
    const ctx = ensureContext()
    const response = await fetch(`/sounds/${name}.mp3`)
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    bufferCache.set(name, audioBuffer)
    return audioBuffer
  } catch {
    return null
  }
}

export async function playSound(name: SoundName): Promise<void> {
  const channel = SOUND_CHANNELS[name]
  const volume = channel === 'notification' ? getNotifVolume() : getSfxVolume()
  if (volume === 0) return

  const ctx = ensureContext()
  const buffer = await loadBuffer(name)
  if (!buffer) return

  // Enforce concurrent limit — drop oldest
  while (activeSources.length >= MAX_CONCURRENT) {
    const oldest = activeSources.shift()
    try { oldest?.stop() } catch { /* already stopped */ }
  }

  const source = ctx.createBufferSource()
  source.buffer = buffer
  const gainNode = channel === 'notification' ? notifGain! : sfxGain!
  source.connect(gainNode)
  source.onended = () => {
    const idx = activeSources.indexOf(source)
    if (idx !== -1) activeSources.splice(idx, 1)
  }
  activeSources.push(source)
  source.start()
}

export function getSfxVolume(): number {
  const stored = localStorage.getItem(LS_SFX_KEY)
  return stored !== null ? Number(stored) : 0.7
}

export function getNotifVolume(): number {
  const stored = localStorage.getItem(LS_NOTIF_KEY)
  return stored !== null ? Number(stored) : 0.7
}

export function setSfxVolume(v: number): void {
  const clamped = Math.max(0, Math.min(1, v))
  localStorage.setItem(LS_SFX_KEY, String(clamped))
  if (sfxGain) sfxGain.gain.value = clamped
}

export function setNotifVolume(v: number): void {
  const clamped = Math.max(0, Math.min(1, v))
  localStorage.setItem(LS_NOTIF_KEY, String(clamped))
  if (notifGain) notifGain.gain.value = clamped
}

/** Preload commonly used sounds so first play is instant */
export function preloadSounds(): void {
  const common: SoundName[] = ['card-draw', 'card-snap', 'card-deal', 'button-tap', 'countdown-tick']
  common.forEach(name => loadBuffer(name))
}
