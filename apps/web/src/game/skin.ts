import { OrbScene } from './orbScene'
import { PetScene } from './scene'
import type { SceneCtor } from './sceneContract'

export type Skin = 'orb' | 'pet'

/**
 * The glowing orb companion is the default. `?skin=pet` (or `?skin=default`) brings back the
 * original pink pet. Read once at module load so the choice cannot change mid-session.
 */
function readSkin(): Skin {
  if (typeof window === 'undefined') return 'orb'
  try {
    const value = new URLSearchParams(window.location.search).get('skin')
    return value === 'pet' || value === 'default' ? 'pet' : 'orb'
  } catch {
    return 'orb'
  }
}

export const SKIN: Skin = readSkin()
export const isOrb: boolean = SKIN === 'orb'

/** The scene class `PetCanvas` should instantiate. */
export function sceneClass(): SceneCtor {
  return isOrb ? OrbScene : PetScene
}
