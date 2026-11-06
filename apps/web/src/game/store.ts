import { create } from 'zustand'
import { speak } from '../audio/tts'
import { MAX_INPUT_CHARS, askPet, logInteraction, type Health } from '../net/api'
import { S } from '../strings'
import { TUNING, afterVisitorMessage, buildStyleHint, step, type Stats } from './rules'

type Bubble = { kind: 'idle' | 'pending' | 'reply' | 'error'; text: string }
type LastReply = { ms: number; chars: number; source: 'llama' | 'mock' }

interface GameState {
  /** Rounded snapshot, refreshed about once per second (and after each message). */
  stats: Stats
  health: Health | null
  busy: boolean
  bubble: Bubble
  last: LastReply | null
  /** performance.now() timestamp until which the mouth moves (when there is no audio). */
  speakingUntil: number
  setHealth: (h: Health | null) => void
  tick: (dtSec: number) => void
  sendMessage: (text: string) => Promise<void>
}

export const useGame = create<GameState>()((set, get) => {
  // Precise values live outside React state so per-frame updates don't re-render the UI.
  let precise: Stats = { ...TUNING.start }
  let idleSec = 0
  let acc = 0
  const commit = () => set({ stats: { ...precise } })
  const rounded = () => ({ energy: Math.round(precise.energy), happiness: Math.round(precise.happiness) })

  return {
    stats: { ...precise },
    health: null,
    busy: false,
    bubble: { kind: 'idle', text: S.greeting },
    last: null,
    speakingUntil: 0,

    setHealth: (health) => set({ health }),

    tick: (dtSec) => {
      idleSec += dtSec
      precise = step(precise, dtSec, idleSec)
      acc += dtSec
      if (acc >= 1) {
        acc = 0
        commit()
      }
    },

    sendMessage: async (raw) => {
      const message = raw.trim().slice(0, MAX_INPUT_CHARS)
      if (!message || get().busy || !get().health) return

      const styleHint = buildStyleHint(precise) // the mood this question arrives in
      idleSec = 0
      precise = afterVisitorMessage(precise)
      commit()
      set({ busy: true, bubble: { kind: 'pending', text: S.thinking } })

      const started = performance.now()
      try {
        const { reply, source } = await askPet(message, styleHint)
        const ms = Math.round(performance.now() - started)
        set({
          busy: false,
          bubble: { kind: 'reply', text: reply },
          last: { ms, chars: reply.length, source },
          speakingUntil: performance.now() + reply.length * 70,
        })
        logInteraction({ message, reply, source, ms, style_hint: styleHint, ...rounded() })
        void speak(reply)
      } catch (err) {
        const ms = Math.round(performance.now() - started)
        const error =
          err instanceof DOMException && err.name === 'TimeoutError'
            ? S.timeout
            : err instanceof Error
              ? err.message
              : 'unknown error'
        set({ busy: false, bubble: { kind: 'error', text: `${S.failedPrefix}: ${error}` } })
        logInteraction({ message, error, ms, style_hint: styleHint, ...rounded() })
      }
    },
  }
})
