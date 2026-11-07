import type { Emotion, Reaction } from './rules'

/** Per-frame state both skins read from the zustand store. */
export type FrameInput = {
  emotion: Emotion
  talking: boolean
  sleepy: boolean
  reaction: Reaction | null
}

/** Shared constructor/API contract: `PetScene` and `OrbScene` are interchangeable. */
export interface Scene {
  init(host: HTMLElement): Promise<void>
  destroy(): void
}

export type SceneCtor = new (readInput: () => FrameInput, onPoke: () => void) => Scene
