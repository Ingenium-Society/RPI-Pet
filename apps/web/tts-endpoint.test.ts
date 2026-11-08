import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_TTS_CHARS, cleanText, createTtsHandler, voiceTag, voicesFromEnv, type Synth } from './tts-endpoint'

describe('cleanText', () => {
  it('collapses whitespace and strips markdown marks', () => {
    expect(cleanText('  *menguap*   halo\n\nkamu  ')).toBe('menguap halo kamu')
    expect(cleanText('`code` and _under_ #tag ~x~')).toBe('code and under tag x')
  })

  it('drops emoji, which the service would read out loud', () => {
    expect(cleanText('Halo 😀 apa kabar 🎉')).toBe('Halo apa kabar')
  })

  it('caps the length and never ends on a space', () => {
    const out = cleanText('kata '.repeat(200))
    expect(out.length).toBeLessThanOrEqual(MAX_TTS_CHARS)
    expect(out).toBe(out.trim())
  })

  it('returns an empty string when there is nothing to say', () => {
    expect(cleanText('   ')).toBe('')
    expect(cleanText('*** 😀 ###')).toBe('')
  })
})

describe('voicesFromEnv', () => {
  it('defaults to deep male voices, pitched down and slowed', () => {
    const v = voicesFromEnv({})
    expect(v.id).toEqual({ voice: 'id-ID-ArdiNeural', lang: 'id-ID', pitch: '-14Hz', rate: '-4%' })
    expect(v.en).toEqual({ voice: 'en-US-ChristopherNeural', lang: 'en-US', pitch: '-14Hz', rate: '-4%' })
  })

  it('can be overridden, deriving the locale from the voice name', () => {
    const v = voicesFromEnv({ TTS_VOICE_ID: 'id-ID-GadisNeural', TTS_VOICE_EN: ' en-GB-SoniaNeural ' })
    expect(v.id).toEqual({ voice: 'id-ID-GadisNeural', lang: 'id-ID', pitch: '-14Hz', rate: '-4%' })
    expect(v.en).toEqual({ voice: 'en-GB-SoniaNeural', lang: 'en-GB', pitch: '-14Hz', rate: '-4%' })
  })

  it('takes pitch and rate from the environment, for both languages', () => {
    const v = voicesFromEnv({ TTS_PITCH: ' -24Hz ', TTS_RATE: '-12%' })
    expect(v.id.pitch).toBe('-24Hz')
    expect(v.en.pitch).toBe('-24Hz')
    expect(v.id.rate).toBe('-12%')
    expect(v.en.rate).toBe('-12%')
  })

  it('ignores blank overrides', () => {
    const v = voicesFromEnv({ TTS_VOICE_ID: '  ', TTS_PITCH: '', TTS_RATE: '   ' })
    expect(v.id.voice).toBe('id-ID-ArdiNeural')
    expect(v.id.pitch).toBe('-14Hz')
    expect(v.id.rate).toBe('-4%')
  })

  it('changes the cache tag when only the prosody changes', () => {
    const base = voiceTag(voicesFromEnv({}))
    expect(voiceTag(voicesFromEnv({}))).toBe(base)
    expect(voiceTag(voicesFromEnv({ TTS_PITCH: '-24Hz' }))).not.toBe(base)
    expect(voiceTag(voicesFromEnv({ TTS_RATE: '-10%' }))).not.toBe(base)
    expect(base).toContain('id-ID-ArdiNeural')
  })
})

describe('/__tts handler', () => {
  const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3])
  let dir: string
  let server: Server
  let calls: { text: string; lang: string }[]

  /** Start a server around the handler; returns its base URL. */
  async function start(synth: Synth, tag = 'v1'): Promise<string> {
    server = createServer(createTtsHandler({ synth, cacheDir: dir, tag }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  const fakeSynth: Synth = async (text, lang) => {
    calls.push({ text, lang })
    return MP3
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tts-test-'))
    calls = []
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    await rm(dir, { recursive: true, force: true })
  })

  it('returns synthesized audio as audio/mpeg', async () => {
    const base = await start(fakeSynth)
    const res = await fetch(`${base}/?text=${encodeURIComponent('Halo!')}&lang=id`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(MP3)
    expect(calls).toEqual([{ text: 'Halo!', lang: 'id' }])
  })

  it('serves a repeated line from the cache without synthesizing again', async () => {
    const base = await start(fakeSynth)
    for (let i = 0; i < 3; i++) await fetch(`${base}/?text=Halo&lang=id`).then((r) => r.arrayBuffer())
    expect(calls).toHaveLength(1)
  })

  it('keeps the cache across restarts, so repeated lines work offline', async () => {
    let base = await start(fakeSynth)
    await fetch(`${base}/?text=Halo&lang=id`).then((r) => r.arrayBuffer())
    await new Promise<void>((resolve) => server.close(() => resolve()))

    base = await start(async () => {
      throw new Error('offline')
    })
    const res = await fetch(`${base}/?text=Halo&lang=id`)
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(MP3)
  })

  it('caches per language', async () => {
    const base = await start(fakeSynth)
    await fetch(`${base}/?text=Hi&lang=id`).then((r) => r.arrayBuffer())
    await fetch(`${base}/?text=Hi&lang=en`).then((r) => r.arrayBuffer())
    expect(calls.map((c) => c.lang)).toEqual(['id', 'en'])
  })

  it('treats an unknown language as Indonesian', async () => {
    const base = await start(fakeSynth)
    await fetch(`${base}/?text=Hi&lang=xx`).then((r) => r.arrayBuffer())
    await fetch(`${base}/?text=Hi`).then((r) => r.arrayBuffer())
    expect(calls).toEqual([{ text: 'Hi', lang: 'id' }])
  })

  it('a different voice tag starts a fresh cache', async () => {
    let base = await start(fakeSynth, 'voice-a')
    await fetch(`${base}/?text=Halo&lang=id`).then((r) => r.arrayBuffer())
    await new Promise<void>((resolve) => server.close(() => resolve()))
    base = await start(fakeSynth, 'voice-b')
    await fetch(`${base}/?text=Halo&lang=id`).then((r) => r.arrayBuffer())
    expect(calls).toHaveLength(2)
  })

  it('shares one synthesis between identical simultaneous requests', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const base = await start(async (text, lang) => {
      calls.push({ text, lang })
      await gate
      return MP3
    })
    const pending = [1, 2, 3].map(() => fetch(`${base}/?text=Halo&lang=id`).then((r) => r.arrayBuffer()))
    await new Promise((resolve) => setTimeout(resolve, 50))
    release()
    await Promise.all(pending)
    expect(calls).toHaveLength(1)
  })

  it('rejects empty text with 400 and does not call the service', async () => {
    const base = await start(fakeSynth)
    expect((await fetch(`${base}/?text=%20%20`)).status).toBe(400)
    expect((await fetch(`${base}/`)).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('rejects non-GET requests', async () => {
    const base = await start(fakeSynth)
    expect((await fetch(`${base}/?text=Hi`, { method: 'POST' })).status).toBe(405)
  })

  it('answers 502 when the service fails, and does not cache the failure', async () => {
    let fail = true
    const base = await start(async (text, lang) => {
      if (fail) throw new Error('no internet')
      return fakeSynth(text, lang)
    })
    const bad = await fetch(`${base}/?text=Halo&lang=id`)
    expect(bad.status).toBe(502)
    expect(await bad.text()).toContain('no internet')

    fail = false
    expect((await fetch(`${base}/?text=Halo&lang=id`)).status).toBe(200)
  })

  it('treats an empty audio response as a failure and caches nothing', async () => {
    const base = await start(async () => Buffer.alloc(0))
    expect((await fetch(`${base}/?text=Halo`)).status).toBe(502)
    expect(await readdir(dir).catch(() => [])).toHaveLength(0)
  })

  it('still speaks when the cache folder cannot be written', async () => {
    // A folder "inside" a regular file can never be created (ENOTDIR), on any system.
    const file = join(dir, 'plain-file')
    await writeFile(file, 'x')
    server = createServer(
      createTtsHandler({ synth: fakeSynth, cacheDir: join(file, 'cache'), tag: 'v1' }),
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    expect((await fetch(`${base}/?text=Halo`)).status).toBe(200)
  })
})
