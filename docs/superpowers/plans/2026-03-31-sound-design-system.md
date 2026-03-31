# Sound Design System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audio feedback to every meaningful game moment — 15 sounds across two volume channels, triggered from existing game event handlers.

**Architecture:** Single `src/lib/sounds.ts` module wrapping Web Audio API with lazy initialization, two gain nodes (SFX + Notification), localStorage-persisted volume, and a `playSound(name)` function called inline at existing game handlers — same pattern as the existing `haptic()` utility.

**Tech Stack:** Web Audio API, `.mp3` assets in `public/sounds/`, localStorage for volume persistence

---

### Task 1: Create the Sound Engine Module

**Files:**
- Create: `src/lib/sounds.ts`

- [ ] **Step 1: Create `src/lib/sounds.ts` with types and volume management**

```typescript
// src/lib/sounds.ts

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

  // Enforce concurrent limit
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd D:/shanghai-tracker && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd D:/shanghai-tracker && git add src/lib/sounds.ts && git commit -m "feat(sound): add sound engine module — Web Audio API, 2 channels, volume persistence"
```

---

### Task 2: Add Placeholder Sound Assets

**Files:**
- Create: `public/sounds/` directory with 15 `.mp3` placeholder files

Sound files need to exist for the engine to load them. Use short silent or generated placeholder `.mp3` files. Real assets can be swapped in later without code changes.

- [ ] **Step 1: Create the sounds directory and generate placeholder files**

We'll use `ffmpeg` to generate short silent `.mp3` files. If `ffmpeg` is not available, create minimal valid `.mp3` files another way.

```bash
cd D:/shanghai-tracker && mkdir -p public/sounds

# Generate a 0.3s silent mp3 for each sound name
for name in card-draw card-snap card-deal card-shuffle meld-slam lay-off joker-swap going-out shanghai-sting buy-ding round-fanfare win-celebration turn-notify button-tap error-buzz countdown-tick; do
  ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 -q:a 9 "public/sounds/$name.mp3" -y 2>/dev/null
done
ls public/sounds/
```

If `ffmpeg` is unavailable, use a JavaScript one-liner to create minimal valid mp3 files, or download a tiny silent mp3 and copy it 15 times with different names.

- [ ] **Step 2: Verify all 15 files exist**

```bash
cd D:/shanghai-tracker && ls public/sounds/*.mp3 | wc -l
```
Expected: 16 (15 sounds — check count matches)

- [ ] **Step 3: Commit**

```bash
cd D:/shanghai-tracker && git add public/sounds/ && git commit -m "feat(sound): add 15 placeholder sound assets"
```

---

### Task 3: Wire Sounds into GameBoard — Card Actions

**Files:**
- Modify: `src/components/play/GameBoard.tsx`

Add `playSound()` calls alongside existing `haptic()` calls in the game action handlers. The pattern: find each `haptic()` call and add the corresponding `playSound()` next to it.

- [ ] **Step 1: Add import at top of GameBoard.tsx**

Add after the existing `haptic` import:
```typescript
import { playSound, preloadSounds } from '../../lib/sounds'
```

- [ ] **Step 2: Add preload call in a useEffect**

Add after the existing state declarations (around line 340), a one-time preload:
```typescript
useEffect(() => { preloadSounds() }, [])
```

- [ ] **Step 3: Add sounds to handleDrawFromPile**

Find `function handleDrawFromPile()` (line ~1201). Inside, after the state update, add:
```typescript
playSound('card-draw')
```

- [ ] **Step 4: Add sounds to handleTakeDiscard**

Find `function handleTakeDiscard()` (line ~1310). Add:
```typescript
playSound('card-snap')
```

- [ ] **Step 5: Add sounds to handleDiscard**

Find `function handleDiscard()` (line ~1952). Add after the haptic call:
```typescript
playSound('card-snap')
```

- [ ] **Step 6: Add sounds to handleMeldConfirm**

Find `function handleMeldConfirm()` (line ~1576). Add:
```typescript
playSound('meld-slam')
```

- [ ] **Step 7: Add sounds to handleLayOff**

Find `function handleLayOff()` (line ~1662). Add at the success path (not the error path):
```typescript
playSound('lay-off')
```

At the error paths (where `haptic('error')` is called), add:
```typescript
playSound('error-buzz')
```

- [ ] **Step 8: Add sounds to handleJokerSwap**

Find `function handleJokerSwap()` (line ~1836). Add:
```typescript
playSound('joker-swap')
```

- [ ] **Step 9: Add sounds to triggerGoingOut**

Find `function triggerGoingOut()` (line ~1421). Add:
```typescript
playSound('going-out')
```

- [ ] **Step 10: Add shuffle sound to reshuffle**

Find the proactive reshuffle effect (around line 630-656). Where `setReshuffleMsg(true)` is called, add:
```typescript
playSound('card-shuffle')
```

Also in `handleDrawFromPile` around line 1284 where `needsReshuffle` is handled, add:
```typescript
playSound('card-shuffle')
```

- [ ] **Step 11: Add sounds to handleBuyDecision**

Find `function handleBuyDecision()` (line ~2096). Add in the `wantsToBuy === true` path:
```typescript
playSound('buy-ding')
```

- [ ] **Step 12: Verify TypeScript compiles**

Run: `cd D:/shanghai-tracker && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 13: Commit**

```bash
cd D:/shanghai-tracker && git add src/components/play/GameBoard.tsx && git commit -m "feat(sound): wire 11 sound effects into GameBoard action handlers"
```

---

### Task 4: Wire Sounds into RoundAnnouncement and RoundSummary

**Files:**
- Modify: `src/components/play/RoundAnnouncement.tsx`
- Modify: `src/components/play/RoundSummary.tsx`

- [ ] **Step 1: Add countdown tick and round fanfare to RoundAnnouncement**

Add import at top of `RoundAnnouncement.tsx`:
```typescript
import { playSound } from '../../lib/sounds'
```

Find the countdown rendering block (line ~341, `if (stage === 'countdown-3' || stage === 'countdown-2' || stage === 'countdown-1')`). The component re-renders when stage changes, so add a `useEffect` that plays the sound when stage changes to a countdown value:

Add a `useEffect` near the top of the component (after the existing `useEffect`s):
```typescript
useEffect(() => {
  if (stage === 'countdown-3' || stage === 'countdown-2' || stage === 'countdown-1') {
    playSound('countdown-tick')
  }
  if (stage === 'countdown-1') {
    // Small delay so fanfare plays after the final tick
    setTimeout(() => playSound('round-fanfare'), 600)
  }
}, [stage])
```

- [ ] **Step 2: Add shanghai sting to RoundSummary**

Add import at top of `RoundSummary.tsx`:
```typescript
import { playSound } from '../../lib/sounds'
```

Find where the shanghai exposure is revealed. There's a `useEffect` that fires when `shanghaiedCount >= 1` (around line 227). Add the sound there:
```typescript
playSound('shanghai-sting')
```

Also find where the winner result is shown and add:
```typescript
if (winnerResult) playSound('win-celebration')
```
This should be in a `useEffect` that runs once on mount or when results are available.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd D:/shanghai-tracker && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
cd D:/shanghai-tracker && git add src/components/play/RoundAnnouncement.tsx src/components/play/RoundSummary.tsx && git commit -m "feat(sound): add countdown tick, round fanfare, shanghai sting, win celebration"
```

---

### Task 5: Wire Sounds into BuyingCinematic

**Files:**
- Modify: `src/components/play/BuyingCinematic.tsx`

- [ ] **Step 1: Add buy-ding sound to the snatched phase**

Add import at top:
```typescript
import { playSound } from '../../lib/sounds'
```

The `BuyingCinematic` default export renders the overlay. When `phase === 'snatched'`, the card flies away. Add a `useEffect` inside the component:

```typescript
useEffect(() => {
  if (phase === 'snatched') {
    playSound('buy-ding')
  }
}, [phase])
```

Note: The `buy-ding` in `handleBuyDecision` (Task 3) fires on the host. This one fires for the visual cinematic on all players watching the overlay. Both are valid — the host hears it from the action, remote players hear it from the cinematic phase change.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd D:/shanghai-tracker && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
cd D:/shanghai-tracker && git add src/components/play/BuyingCinematic.tsx && git commit -m "feat(sound): add buy-ding to buying cinematic snatched phase"
```

---

### Task 6: Wire Sounds into RemoteGameBoard

**Files:**
- Modify: `src/components/play/RemoteGameBoard.tsx`

Remote players don't call game handlers — they receive state updates. Trigger sounds from state changes.

- [ ] **Step 1: Add import**

Add at top of `RemoteGameBoard.tsx`:
```typescript
import { playSound, preloadSounds } from '../../lib/sounds'
```

- [ ] **Step 2: Add preload**

Add near the top of the component:
```typescript
useEffect(() => { preloadSounds() }, [])
```

- [ ] **Step 3: Add sounds triggered by view state changes**

Add a new `useEffect` that watches for game events and plays corresponding sounds. Place it after the existing toast/event processing effect:

```typescript
// Sound effects triggered by remote state changes
const prevViewRef = useRef<RemoteGameView | null>(null)
useEffect(() => {
  if (!view) return
  const prev = prevViewRef.current
  prevViewRef.current = view

  if (!prev) return

  // Going out cinematic
  if (view.goingOutSequence === 'flash' && prev.goingOutSequence !== 'flash') {
    playSound('going-out')
  }

  // Turn notification (when tab is hidden)
  if (view.currentPlayerIndex === view.myPlayerIndex &&
      prev.currentPlayerIndex !== view.myPlayerIndex &&
      document.hidden) {
    playSound('turn-notify')
  }

  // Buying phase — someone snatched
  if (view.buyingCinematicPhase === 'snatched' && prev.buyingCinematicPhase !== 'snatched') {
    playSound('buy-ding')
  }

  // Event-based sounds from lastEvent string matching
  if (view.lastEvent && view.lastEvent !== prev.lastEvent) {
    const evt = view.lastEvent.toLowerCase()
    if (evt.includes('drew') || evt.includes('draw')) playSound('card-draw')
    else if (evt.includes('discard') || evt.includes('took')) playSound('card-snap')
    else if (evt.includes('went down') || evt.includes('laid down')) playSound('meld-slam')
    else if (evt.includes('laid off')) playSound('lay-off')
    else if (evt.includes('swapped a joker') || evt.includes('heist')) playSound('joker-swap')
    else if (evt.includes('bought')) playSound('buy-ding')
  }
}, [view])
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd D:/shanghai-tracker && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
cd D:/shanghai-tracker && git add src/components/play/RemoteGameBoard.tsx && git commit -m "feat(sound): wire remote player sounds from view state changes"
```

---

### Task 7: Volume Control UI in Pause Menu

**Files:**
- Modify: `src/components/play/GameBoard.tsx` (pause menu section)
- Modify: `src/components/play/RemoteGameBoard.tsx` (pause menu section)

Both files have a pause modal. Add two volume sliders to each.

- [ ] **Step 1: Add volume state and sliders to GameBoard pause menu**

Add imports (if not already present from Task 3):
```typescript
import { getSfxVolume, getNotifVolume, setSfxVolume, setNotifVolume } from '../../lib/sounds'
```

Add state for sliders near other state declarations:
```typescript
const [sfxVol, setSfxVol] = useState(getSfxVolume)
const [notifVol, setNotifVol] = useState(getNotifVolume)
```

Find the pause menu modal in GameBoard (search for "Pause" or "Resume" button). Add the sliders between the game speed selector and the Resume button:

```typescript
{/* Volume controls */}
<div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ color: '#a8d0a8', fontSize: 12, minWidth: 90 }}>Game Sounds</span>
    <input
      type="range" min="0" max="1" step="0.1"
      value={sfxVol}
      onChange={e => { const v = Number(e.target.value); setSfxVol(v); setSfxVolume(v) }}
      style={{ flex: 1, accentColor: '#e2b858' }}
    />
  </div>
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ color: '#a8d0a8', fontSize: 12, minWidth: 90 }}>Notifications</span>
    <input
      type="range" min="0" max="1" step="0.1"
      value={notifVol}
      onChange={e => { const v = Number(e.target.value); setNotifVol(v); setNotifVolume(v) }}
      style={{ flex: 1, accentColor: '#e2b858' }}
    />
  </div>
</div>
```

- [ ] **Step 2: Add the same volume sliders to RemoteGameBoard pause menu**

Same imports and state as Step 1. Find the pause modal in RemoteGameBoard (search for "Online Game" or "Resume" button). Add the same slider markup.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd D:/shanghai-tracker && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
cd D:/shanghai-tracker && git add src/components/play/GameBoard.tsx src/components/play/RemoteGameBoard.tsx && git commit -m "feat(sound): add volume control sliders to pause menu (both local and remote)"
```

---

### Task 8: Build Verification and Final Test

- [ ] **Step 1: TypeScript check**

Run: `cd D:/shanghai-tracker && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 2: Build**

Run: `cd D:/shanghai-tracker && npm run build 2>&1 | tail -15`
Expected: Build succeeds

- [ ] **Step 3: Run tests**

Run: `cd D:/shanghai-tracker && npx vitest run 2>&1 | tail -15`
Expected: All tests pass (1457+)

- [ ] **Step 4: Manual smoke test**

Start dev server: `npm run dev`
1. Open game, start a local game
2. Draw a card — should hear `card-draw` (or silence if placeholder)
3. Discard — should hear `card-snap`
4. Open pause menu — should see two volume sliders
5. Set SFX to 0 — actions should be silent
6. Refresh — volume should persist
7. Check browser console for any audio errors

- [ ] **Step 5: Push to GitHub**

```bash
cd D:/shanghai-tracker && git push origin main
```

---

## Execution Notes

- Tasks 1-2 are foundations (sound engine + assets) — must be done first
- Tasks 3-6 are independent (GameBoard, RoundAnnouncement, BuyingCinematic, RemoteGameBoard) — can be done in any order after Tasks 1-2
- Task 7 (volume UI) depends on Task 1 for the volume functions
- Task 8 (verification) must be last
- Sound assets are placeholders — real `.mp3` files should be sourced/created and swapped in. The code doesn't change when assets are replaced.
- The `playSound()` function is async but fire-and-forget — no `await` needed at call sites
