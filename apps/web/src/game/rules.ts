// Game rules: two stats (energy, happiness), the pet's expression, and the extra
// system-prompt text derived from them. Pure functions, no I/O, so they are easy to test.

export type Emotion = 'neutral' | 'happy' | 'sad' | 'sleepy' | 'thinking'
export type Stats = { energy: number; happiness: number } // each 0..100

/** Every game number lives here. Starting values, adjust while playtesting. */
export const TUNING = {
  start: { energy: 80, happiness: 60 } satisfies Stats,
  /** Loss per second. */
  decay: { energy: 0.03, happiness: 0.08 },
  /** Effect of one visitor message. */
  perMessage: { energy: -6, happiness: 8 },
  /** After this many quiet seconds the pet rests and energy recovers. */
  restAfterSec: 20,
  restRate: 0.4,
}

const clamp = (v: number) => Math.max(0, Math.min(100, v))

export function afterVisitorMessage(s: Stats): Stats {
  return {
    energy: clamp(s.energy + TUNING.perMessage.energy),
    happiness: clamp(s.happiness + TUNING.perMessage.happiness),
  }
}

export function step(s: Stats, dtSec: number, idleSec: number): Stats {
  const resting = idleSec > TUNING.restAfterSec
  return {
    energy: clamp(s.energy + (resting ? TUNING.restRate : -TUNING.decay.energy) * dtSec),
    happiness: clamp(s.happiness - TUNING.decay.happiness * dtSec),
  }
}

/** Expression comes from the rules, not the LLM, so the small model only has to write text. */
export function emotionFor(s: Stats): Emotion {
  if (s.energy < 25) return 'sleepy'
  if (s.happiness < 25) return 'sad'
  if (s.happiness > 70) return 'happy'
  return 'neutral'
}

/**
 * Extra system-prompt text for the LLM. Empty in a normal mood. English on purpose:
 * it is appended to pi-service's English system prompt, which tells the model to answer
 * in the visitor's language.
 */
export function buildStyleHint(s: Stats): string {
  const lines: string[] = []
  if (s.energy < 25) lines.push('You are very sleepy. Answer in one very short sentence.')
  else if (s.energy < 50) lines.push('You are a bit tired. Keep your answers short.')

  if (s.happiness < 25) lines.push('You are sad and lonely. Sound gloomy.')
  else if (s.happiness > 70) lines.push('You are cheerful and excited.')

  return lines.join(' ')
}
