import { voice } from './voice'

// Hook for edge-tts. It expects the laptop to serve GET /__tts?text=... returning audio
// (for example a small Vite dev-server middleware like /__log). That endpoint does not
// exist yet: until it does, the first call finds out, TTS switches itself off, and the pet
// just moves its mouth for a moment instead.
let available = true

/** Speaks `text`. Returns false when there is no TTS endpoint or playback failed. */
export async function speak(text: string): Promise<boolean> {
  if (!available) return false
  try {
    const res = await fetch(`/__tts?text=${encodeURIComponent(text)}`)
    if (!res.ok || !res.headers.get('content-type')?.startsWith('audio/')) {
      available = false
      return false
    }
    await voice.play(await res.arrayBuffer())
    return true
  } catch {
    return false
  }
}
