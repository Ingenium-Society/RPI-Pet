import { create } from 'zustand'
import { speak } from '../audio/tts'
import { MAX_INPUT_CHARS, askPet, logInteraction, type ChatSource, type Health } from '../net/api'
import { S } from '../strings'
import {
  TUNING,
  afterVisitorMessage,
  applyCare,
  applyTouch,
  buildStyleHint,
  step,
  type CareAction,
  type Reaction,
  type Stats,
  type TouchKind,
} from './rules'

type Bubble = { kind: 'idle' | 'pending' | 'reply' | 'error'; text: string }
type LastReply = { ms: number; chars: number; source: ChatSource; factId?: string }
type CannedGroup = CareAction | TouchKind

interface GameState {
  /** Rounded snapshot, refreshed about once per second (and after each message). */
  stats: Stats
  health: Health | null
  busy: boolean
  bubble: Bubble
  last: LastReply | null
  /** performance.now() timestamp until which the mouth moves (when there is no audio). */
  speakingUntil: number
  /** Eyes stay closed until this timestamp after Sleep. */
  sleepUntil: number
  /** Latest instant animation cue; the scene watches `id` for changes. */
  reaction: Reaction | null
  setHealth: (h: Health | null) => void
  tick: (dtSec: number) => void
  sendMessage: (text: string) => Promise<void>
  /** Care buttons: instant stats + a pre-written line, no model call. */
  care: (action: CareAction) => void
  /** Tapping the pet, or dropping a treat on it. */
  touch: (kind: TouchKind) => void
}

export const useGame = create<GameState>()((set, get) => {
  // Precise values live outside React state so per-frame updates don't re-render the UI.
  let precise: Stats = { ...TUNING.start }
  let idleSec = 0
  let acc = 0
  let nextAttractAt = TUNING.attractAfterSec
  let reactionId = 0
  const commit = () => set({ stats: { ...precise } })
  const rounded = () => ({ energy: Math.round(precise.energy), happiness: Math.round(precise.happiness) })
  const noteActivity = () => {
    idleSec = 0
    nextAttractAt = TUNING.attractAfterSec
    set({ sleepUntil: 0 })
  }

  // Canned lines repeat a lot at a booth, so the TTS endpoint serves them from its cache.
  const turns: Record<CannedGroup, number> = { feed: 0, play: 0, sleep: 0, poke: 0, treat: 0 }
  const canned = (group: CannedGroup) => {
    const lines = S.canned[group]
    const line = lines[turns[group] % lines.length]
    turns[group] += 1
    return line
  }
  let lastSpokenAt = 0
  const say = (text: string) => {
    // A child mashing the pet must not queue up a dozen TTS requests.
    const now = performance.now()
    if (now - lastSpokenAt < 900) return
    lastSpokenAt = now
    void speak(text, 'id')
  }

  const react = (kind: Reaction['kind']) => set({ reaction: { id: ++reactionId, kind } })

  /** Booth attract mode: the pet calls out on its own when nobody has touched it. */
  const attract = () => {
    const line = S.attract
    set({
      bubble: { kind: 'idle', text: line },
      speakingUntil: performance.now() + line.length * 70,
    })
    react('call') // yawn + wave: this one is meant to pull people over
    say(line)
  }

  return {
    stats: { ...precise },
    health: null,
    busy: false,
    bubble: { kind: 'idle', text: S.greeting },
    last: null,
    speakingUntil: 0,
    sleepUntil: 0,
    reaction: null,

    setHealth: (health) => set({ health }),

    tick: (dtSec) => {
      idleSec += dtSec
      precise = step(precise, dtSec, idleSec)
      acc += dtSec
      if (acc >= 1) {
        acc = 0
        commit()
      }
      if (idleSec >= nextAttractAt) {
        // Do not invite questions while a reply is pending or the Pi link is down.
        const ready = !get().busy && get().health !== null
        nextAttractAt = idleSec + (ready ? TUNING.attractRepeatSec : 5)
        if (ready) attract()
      }
    },

    care: (action) => {
      noteActivity()
      precise = applyCare(precise, action)
      commit()
      const line = canned(action)
      set({
        bubble: { kind: 'idle', text: line },
        speakingUntil: performance.now() + line.length * 70,
        ...(action === 'sleep' ? { sleepUntil: performance.now() + TUNING.sleepSec * 1000 } : {}),
      })
      react(action === 'sleep' ? 'yawn' : 'giggle')
      say(line)
      logInteraction({ kind: 'care', action, ...rounded() })
    },

    touch: (kind) => {
      noteActivity()
      precise = applyTouch(precise, kind)
      commit()
      const line = canned(kind)
      set({
        bubble: { kind: 'idle', text: line },
        speakingUntil: performance.now() + line.length * 70,
      })
      react('giggle')
      say(line)
      logInteraction({ kind: 'touch', action: kind, ...rounded() })
    },

    sendMessage: async (raw) => {
      const message = raw.trim().slice(0, MAX_INPUT_CHARS)
      if (!message || get().busy || !get().health) return

      const styleHint = buildStyleHint(precise) // the mood this question arrives in
      noteActivity()
      precise = afterVisitorMessage(precise)
      commit()
      set({ busy: true, bubble: { kind: 'pending', text: S.thinking } })

      const started = performance.now()
      try {
        const { reply, source, fact_id: factId, lang } = await askPet(message, styleHint)
        const ms = Math.round(performance.now() - started)
        set({
          busy: false,
          bubble: { kind: 'reply', text: reply },
          last: { ms, chars: reply.length, source, factId },
          speakingUntil: performance.now() + reply.length * 70,
        })
        logInteraction({ kind: 'chat', message, reply, source, fact_id: factId, ms, style_hint: styleHint, ...rounded() })
        void speak(reply, lang)
      } catch (err) {
        const ms = Math.round(performance.now() - started)
        const error =
          err instanceof DOMException && err.name === 'TimeoutError'
            ? S.timeout
            : err instanceof Error
              ? err.message
              : 'unknown error'
        set({ busy: false, bubble: { kind: 'error', text: `${S.failedPrefix}: ${error}` } })
        logInteraction({ kind: 'chat', message, error, ms, style_hint: styleHint, ...rounded() })
      }
    },
  }
})
