import { OrbScene } from './orbScene'
import { PetScene } from './scene'
import type { SceneCtor } from './sceneContract'

export type Skin = 'default' | 'orb'

/**
 * `?skin=orb` is the only opt-in. Read once at module load so the choice cannot change
 * mid-session; anything else (including a missing parameter) is the original pet.
 */
function readSkin(): Skin {
  if (typeof window === 'undefined') return 'default'
  try {
    return new URLSearchParams(window.location.search).get('skin') === 'orb' ? 'orb' : 'default'
  } catch {
    return 'default'
  }
}

export const SKIN: Skin = readSkin()
export const isOrb: boolean = SKIN === 'orb'

/** The scene class `PetCanvas` should instantiate. Default is unchanged. */
export function sceneClass(): SceneCtor {
  return isOrb ? OrbScene : PetScene
}
