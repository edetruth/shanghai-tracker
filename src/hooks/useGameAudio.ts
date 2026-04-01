import { useState, useEffect } from 'react'
import { preloadSounds, getSfxVolume, getNotifVolume, setSfxVolume, setNotifVolume } from '../lib/sounds'

export function useGameAudio() {
  const [sfxVol, setSfxVol] = useState(getSfxVolume)
  const [notifVol, setNotifVol] = useState(getNotifVolume)

  useEffect(() => { preloadSounds() }, [])

  function updateSfxVol(v: number) { setSfxVol(v); setSfxVolume(v) }
  function updateNotifVol(v: number) { setNotifVol(v); setNotifVolume(v) }

  return { sfxVol, notifVol, updateSfxVol, updateNotifVol }
}
