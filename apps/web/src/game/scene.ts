import { Application, Container, Graphics } from 'pixi.js'
import { voice } from '../audio/voice'
import type { Emotion } from './rules'

const COLOR = {
  ground: 0xb4e0c8,
  body: 0xd9376e,
  ink: 0x1f2a37,
  mouth: 0x5a1230,
}

export type FrameInput = { emotion: Emotion; talking: boolean }

type Stroke = { width: number; color: number; cap: 'round' }

/** Placeholder pet drawn from basic shapes. Swap the drawing code for sprites later. */
export class PetScene {
  private app = new Application()
  private pet = new Container()
  private body = new Graphics()
  private face = new Graphics()
  private ground = new Graphics()

  private mouthOpen = 0
  private t = 0
  private blinkAt = 2
  private blinkUntil = 0
  private baseScale = 1
  private baseY = 0
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** `readInput` is called every frame to get the current expression and talking state. */
  constructor(private readInput: () => FrameInput) {}

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host,
      backgroundAlpha: 0, // the page background shows through
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    })
    this.app.canvas.style.display = 'block'
    host.appendChild(this.app.canvas)

    this.body.ellipse(0, 0, 120, 105).fill(COLOR.body)
    this.pet.addChild(this.body, this.face)
    this.app.stage.addChild(this.ground, this.pet)

    this.app.renderer.on('resize', () => this.layout())
    this.layout()
    this.app.ticker.add((tk) => this.update(tk.deltaMS / 1000))
  }

  destroy() {
    this.app.destroy({ removeView: true }, { children: true })
  }

  private layout() {
    const { width, height } = this.app.screen
    this.baseScale = Math.max(0.3, Math.min(width / 520, height / 600))
    this.baseY = height * 0.5
    this.pet.position.set(width / 2, this.baseY)
    this.ground
      .clear()
      .ellipse(width / 2, this.baseY + 118 * this.baseScale, 150 * this.baseScale, 20 * this.baseScale)
      .fill(COLOR.ground)
  }

  private update(dt: number) {
    this.t += dt
    const { emotion, talking } = this.readInput()

    const bob = this.reduceMotion ? 0 : Math.sin(this.t * 2.4)
    this.pet.y = this.baseY + bob * 6 * this.baseScale
    const squash = bob * 0.015
    this.pet.scale.set(this.baseScale * (1 + squash), this.baseScale * (1 - squash))

    // Real audio level when there is TTS audio, otherwise a simple flap while "talking".
    const target =
      voice.level > 0.03 ? voice.level : talking ? (Math.sin(this.t * 18) * 0.5 + 0.5) * 0.8 : 0
    this.mouthOpen += (target - this.mouthOpen) * 0.35

    if (this.t > this.blinkAt) {
      this.blinkUntil = this.t + 0.12
      this.blinkAt = this.t + 2 + Math.random() * 3
    }
    this.drawFace(emotion, this.t < this.blinkUntil)
  }

  private drawFace(emotion: Emotion, blinking: boolean) {
    const g = this.face.clear()
    const stroke: Stroke = { width: 5, color: COLOR.ink, cap: 'round' }
    const closed = blinking || emotion === 'sleepy'
    const lookX = emotion === 'thinking' ? 5 : 0
    const lookY = emotion === 'thinking' ? -5 : 0

    for (const x of [-40, 40]) {
      if (closed) g.moveTo(x - 12, -20).lineTo(x + 12, -20).stroke(stroke)
      else g.circle(x + lookX, -22 + lookY, 11).fill(COLOR.ink)
    }

    if (this.mouthOpen > 0.06) {
      g.ellipse(0, 38, 20, 5 + this.mouthOpen * 20).fill(COLOR.mouth)
    } else if (emotion === 'sad') {
      this.arc(g, 56, 22, 1.15, 1.85, stroke)
    } else if (emotion === 'sleepy') {
      g.moveTo(-10, 40).lineTo(10, 40).stroke(stroke)
    } else {
      this.arc(g, 22, 22, 0.15, 0.85, stroke)
    }
  }

  private arc(g: Graphics, cy: number, r: number, from: number, to: number, stroke: Stroke) {
    const a0 = from * Math.PI
    g.moveTo(Math.cos(a0) * r, cy + Math.sin(a0) * r)
      .arc(0, cy, r, a0, to * Math.PI)
      .stroke(stroke)
  }
}
