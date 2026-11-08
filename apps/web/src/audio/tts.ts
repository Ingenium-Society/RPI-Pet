import { voice } from './voice'

type Lang = 'id' | 'en'

// Preferred voice: GET /__tts on the laptop's Vite server (see tts-endpoint.ts), which uses
// Microsoft Edge's neural voices and needs internet the first time a line is spoken.
// Fallback: the browser's own built-in voice, which works offline but sounds more robotic.
//
// A failed request (no internet, service hiccup) only affects that one reply. The endpoint is
// written off only when it plainly does not exist, e.g. a static build without the dev server.
let endpointMissing = false

/** Speaks `text` in the given language. Returns false when nothing could be played. */
export async function speak(text: string, lang: Lang = 'id'): Promise<boolean> {
  if (!endpointMissing) {
    try {
      const res = await fetch(`/__tts?${new URLSearchParams({ text, lang })}`)
      const type = res.headers.get('content-type') ?? ''
      if (res.ok && type.startsWith('audio/')) {
        await voice.play(await res.arrayBuffer())
        return true
      }
      // 404, or the SPA fallback page (200 text/html): there is no such endpoint.
      if (res.status === 404 || type.includes('text/html')) endpointMissing = true
    } catch {
      /* network error or undecodable audio: use the browser voice for this reply */
    }
  }
  return speakWithBrowser(text, lang)
}

const LOCALE: Record<Lang, string> = { id: 'id-ID', en: 'en-US' }

function speakWithBrowser(text: string, lang: Lang): Promise<boolean> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve(false)
  const synth = window.speechSynthesis
  synth.cancel() // never talk over a previous reply

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = LOCALE[lang]
  // Prefer an installed voice for the language (the list can be empty until the browser loads it).
  const prefix = lang
  utterance.voice =
    synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(prefix)) ?? null
  utterance.pitch = 0.65 // deep and flat, to sit close to the robotic Edge voice
  utterance.rate = 0.95

  return new Promise((resolve) => {
    utterance.onend = () => resolve(true)
    utterance.onerror = () => resolve(false)
    synth.speak(utterance)
  })
}
