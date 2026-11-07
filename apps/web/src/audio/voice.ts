/** Plays TTS audio and measures its loudness so the pet's mouth can follow it. */
class VoicePlayer {
  /** 0..1, smoothed. Read by the pet scene every frame. */
  level = 0
  private ctx?: AudioContext
  private analyser?: AnalyserNode
  private buf = new Uint8Array(0)
  private current?: AudioBufferSourceNode

  /** Browsers block audio until the page has had a user gesture. */
  unlock() {
    this.ctx ??= new AudioContext()
    void this.ctx.resume()
  }

  async play(data: ArrayBuffer): Promise<void> {
    this.unlock()
    const ctx = this.ctx!
    const audio = await ctx.decodeAudioData(data)

    if (!this.analyser) {
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.connect(ctx.destination)
      this.buf = new Uint8Array(this.analyser.fftSize)
    }

    // Canned lines can arrive while a model reply is still speaking. Never talk over it.
    try {
      this.current?.stop()
    } catch {
      /* the clip had already ended */
    }
    const src = ctx.createBufferSource()
    src.buffer = audio
    src.connect(this.analyser)
    this.current = src
    await new Promise<void>((resolve) => {
      src.onended = () => {
        if (this.current === src) this.current = undefined
        resolve()
      }
      src.start()
    })
  }

  /** Call once per frame. */
  update() {
    if (!this.analyser) {
      this.level *= 0.8
      return
    }
    this.analyser.getByteTimeDomainData(this.buf)
    let sum = 0
    for (const v of this.buf) {
      const x = (v - 128) / 128
      sum += x * x
    }
    const rms = Math.sqrt(sum / this.buf.length)
    this.level += (Math.min(1, rms * 4) - this.level) * 0.4
  }
}

export const voice = new VoicePlayer()
