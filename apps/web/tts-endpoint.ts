// Text-to-speech for the pet, served by the Vite dev server (laptop side):
//   GET /__tts?text=...&lang=id|en   ->   audio/mpeg
//
// Uses Microsoft Edge's online "read aloud" voices through the node-edge-tts package: no API
// key, but the laptop needs internet, and it is not an official public API, so it can change
// or rate-limit without notice. Every clip is cached on disk (logs/tts-cache), and the pet's
// canned lines repeat a lot, so after the first play they work offline and answer instantly.
// The browser falls back to its own built-in voice whenever this endpoint fails.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { EdgeTTS } from 'node-edge-tts'

export type Lang = 'id' | 'en'
export type VoiceSettings = {
  voice: string
  lang: string
  /** SSML prosody offset, e.g. "-14Hz". Empty string keeps the service default. */
  pitch: string
  /** SSML prosody offset, e.g. "-4%". Empty string keeps the service default. */
  rate: string
}
export type Voices = Record<Lang, VoiceSettings>
export type Synth = (text: string, lang: Lang) => Promise<Buffer>

/** Replies are at most 300 characters (see MAX_ANSWER_CHARS in pet-core); nothing longer is read. */
export const MAX_TTS_CHARS = 300

// Deep male voices, pitched down and slowed a little: a flat, synthetic delivery rather than
// a chirpy assistant. Edge's neural voices cannot do a true vocoder effect, so "robotic" here
// means low, even and unhurried.
const DEFAULT_VOICES: Record<Lang, { voice: string; pitch: string; rate: string }> = {
  id: { voice: 'id-ID-ArdiNeural', pitch: '-14Hz', rate: '-4%' },
  en: { voice: 'en-US-ChristopherNeural', pitch: '-14Hz', rate: '-4%' },
}
const DEFAULT_PITCH = '-14Hz'
const DEFAULT_RATE = '-4%'

/** "id-ID-ArdiNeural" -> "id-ID". */
const localeOf = (voice: string) => voice.split('-').slice(0, 2).join('-')

/**
 * Default voices, overridable with TTS_VOICE_ID / TTS_VOICE_EN, and the prosody with
 * TTS_PITCH / TTS_RATE (SSML units, e.g. "-20Hz", "-10%"; "+0Hz" for neutral).
 */
export function voicesFromEnv(env: Record<string, string | undefined> = process.env): Voices {
  const pitch = env.TTS_PITCH?.trim() || DEFAULT_PITCH
  const rate = env.TTS_RATE?.trim() || DEFAULT_RATE
  const pick = (lang: Lang, key: string) => {
    const voice = env[key]?.trim() || DEFAULT_VOICES[lang].voice
    return { voice, lang: localeOf(voice), pitch, rate }
  }
  return { id: pick('id', 'TTS_VOICE_ID'), en: pick('en', 'TTS_VOICE_EN') }
}

/** Everything that changes the sound. A new tag invalidates the on-disk clip cache. */
export function voiceTag(voices: Voices): string {
  return (['id', 'en'] as const)
    .map((lang) => `${voices[lang].voice}|${voices[lang].pitch}|${voices[lang].rate}`)
    .join('~')
}

/**
 * What the voice should read: one line, no markdown marks or emoji (the service would
 * spell emoji out loud), at most MAX_TTS_CHARS characters. Empty string = nothing to say.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[*_`#~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TTS_CHARS)
    .trim()
}

/** The real synthesizer: one short websocket request to Edge's service per clip. */
export function edgeSynth(voices: Voices = voicesFromEnv()): Synth {
  return async (text, lang) => {
    const settings = voices[lang]
    const tts = new EdgeTTS({
      voice: settings.voice,
      lang: settings.lang,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      pitch: settings.pitch || undefined,
      rate: settings.rate || undefined,
      timeout: 10_000,
    })
    const chunks: Buffer[] = []
    for await (const chunk of tts.streamAudio(text)) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk) // (subtitle objects are not requested)
    }
    return Buffer.concat(chunks)
  }
}

type Options = {
  synth: Synth
  /** Folder for cached clips (created on first use). */
  cacheDir: string
  /** Anything that changes the sound (the voice names). A new tag means a fresh cache. */
  tag: string
}

/** Connect-style handler: `server.middlewares.use('/__tts', createTtsHandler(...))`. */
export function createTtsHandler({ synth, cacheDir, tag }: Options) {
  // Identical requests that arrive together share one synthesis.
  const inflight = new Map<string, Promise<Buffer>>()

  async function audioFor(text: string, lang: Lang): Promise<Buffer> {
    const key = createHash('sha1').update(`${tag}\n${lang}\n${text}`).digest('hex')
    const file = join(cacheDir, `${lang}-${key}.mp3`)
    try {
      return await readFile(file)
    } catch {
      /* not cached yet */
    }

    let pending = inflight.get(key)
    if (!pending) {
      pending = (async () => {
        const audio = await synth(text, lang)
        if (audio.length === 0) throw new Error('the voice service returned no audio')
        // Caching is best-effort: a read-only disk must not break speech.
        await mkdir(cacheDir, { recursive: true })
          .then(() => writeFile(file, audio))
          .catch(() => {})
        return audio
      })().finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    return pending
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const fail = (status: number, message: string) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(message)
    }

    if (req.method !== 'GET') return fail(405, 'GET only')
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams
    const text = cleanText(params.get('text') ?? '')
    if (!text) return fail(400, 'no text to speak')
    const lang: Lang = params.get('lang') === 'en' ? 'en' : 'id'

    try {
      const audio = await audioFor(text, lang)
      res.statusCode = 200
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('Content-Length', audio.length)
      res.end(audio)
    } catch (err) {
      // The page then uses the browser's own voice for this reply.
      fail(502, `text-to-speech failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
