import { Application, Container, Graphics } from 'pixi.js'
import { voice } from '../audio/voice'
import { clearPetHitTest, setPetHitTest } from './petTarget'
import type { Emotion, ReactionKind } from './rules'
import type { FrameInput } from './sceneContract'

const COLOR = {
  ground: 0xb4e0c8,
  body: 0xd9376e,
  ink: 0x1f2a37,
  mouth: 0x5a1230,
  blush: 0xff8fa8,
}

export type { FrameInput } from './sceneContract'

type Stroke = { width: number; color: number; cap: 'round' }

/** Placeholder pet drawn from basic shapes. Swap the drawing code for sprites later. */
export class PetScene {
  private app = new Application()
  private pet = new Container()
  private arm = new Graphics()
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

  // Instant, model-free reactions. All are driven by the game clock, never by a network call.
  private lastReactionId = 0
  private giggleUntil = 0
  private wiggleUntil = 0
  private yawnUntil = 0
  private waveUntil = 0

  private hitTestFn = (x: number, y: number) => this.hitTest(x, y)
  private onPointerDown = (e: PointerEvent) => {
    if (this.hitTest(e.clientX, e.clientY)) this.onPoke()
  }

  /** `readInput` is called every frame; `onPoke` fires when the canvas is tapped on the pet. */
  constructor(
    private readInput: () => FrameInput,
    private onPoke: () => void,
  ) {}

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host,
      backgroundAlpha: 0, // the page background shows through
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    })
    const canvas = this.app.canvas
    canvas.style.display = 'block'
    canvas.style.touchAction = 'none' // a treat drag must not scroll or zoom the page
    host.appendChild(canvas)

    this.body.ellipse(0, 0, 120, 105).fill(COLOR.body)
    this.pet.addChild(this.arm, this.body, this.face)
    this.app.stage.addChild(this.ground, this.pet)

    canvas.addEventListener('pointerdown', this.onPointerDown)
    setPetHitTest(this.hitTestFn)
    this.app.renderer.on('resize', () => this.layout())
    this.layout()
    this.app.ticker.add((tk) => this.update(tk.deltaMS / 1000))
  }

  destroy() {
    clearPetHitTest(this.hitTestFn)
    this.app.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.app.destroy({ removeView: true }, { children: true })
  }

  /** Is this viewport point inside the pet's ellipse? Also used by the draggable treat. */
  private hitTest(clientX: number, clientY: number): boolean {
    const rect = this.app.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    // app.screen is in CSS pixels even when the renderer has a higher resolution.
    const sx = rect.width / (this.app.screen.width || rect.width)
    const sy = rect.height / (this.app.screen.height || rect.height)
    const x = (clientX - rect.left) / sx
    const y = (clientY - rect.top) / sy
    const dx = (x - this.pet.x) / (120 * this.baseScale)
    const dy = (y - this.pet.y) / (105 * this.baseScale)
    return dx * dx + dy * dy <= 1
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

  private trigger(kind: ReactionKind) {
    if (kind === 'giggle') {
      this.wiggleUntil = this.t + 0.7
      this.giggleUntil = this.t + 0.9
    } else {
      this.yawnUntil = this.t + 1.1
      this.wiggleUntil = 0
      // Only attract mode waves; Sleep just yawns and closes its eyes.
      if (kind === 'call') this.waveUntil = this.t + 2.6
    }
  }

  private update(dt: number) {
    this.t += dt
    const { emotion, talking, sleepy, reaction } = this.readInput()
    if (reaction && reaction.id !== this.lastReactionId) {
      this.lastReactionId = reaction.id
      this.trigger(reaction.kind)
    }

    const wiggling = this.t < this.wiggleUntil
    const waving = this.t < this.waveUntil
    const yawning = this.t < this.yawnUntil
    const giggling = this.t < this.giggleUntil

    const bob = this.reduceMotion ? 0 : Math.sin(this.t * 2.4)
    this.pet.y = this.baseY + bob * 6 * this.baseScale
    const squash = bob * 0.015
    const pop = wiggling ? 1 + 0.06 * (this.wiggleUntil - this.t) / 0.7 : 1
    this.pet.scale.set(this.baseScale * (1 + squash) * pop, this.baseScale * (1 - squash) * pop)

    let rotation = 0
    if (wiggling && !this.reduceMotion) rotation += Math.sin(this.t * 34) * 0.16 * (this.wiggleUntil - this.t) / 0.7
    if (waving && !this.reduceMotion) rotation += Math.sin(this.t * 9) * 0.14
    this.pet.rotation = rotation
    this.drawArm(waving)

    // Real audio level when there is TTS audio, otherwise a simple flap while "talking".
    const target = yawning
      ? 1
      : voice.level > 0.03
        ? voice.level
        : talking
          ? (Math.sin(this.t * 18) * 0.5 + 0.5) * 0.8
          : giggling
            ? 0.4
            : 0
    this.mouthOpen += (target - this.mouthOpen) * 0.35

    if (this.t > this.blinkAt) {
      this.blinkUntil = this.t + 0.12
      this.blinkAt = this.t + 2 + Math.random() * 3
    }
    this.drawFace(emotion, this.t < this.blinkUntil || sleepy || yawning, yawning, giggling)
  }

  private drawArm(waving: boolean) {
    const g = this.arm.clear()
    if (!waving) return
    const angle = 0.2 + Math.sin(this.t * 10) * 0.5
    const x = 100 + Math.cos(angle) * 46
    const y = 18 - Math.sin(angle) * 46
    g.moveTo(100, 18).lineTo(x, y).stroke({ width: 16, color: COLOR.body, cap: 'round' })
    g.circle(x, y, 13).fill(COLOR.body)
  }

  private drawFace(emotion: Emotion, blinking: boolean, yawning: boolean, giggling: boolean) {
    const g = this.face.clear()
    const stroke: Stroke = { width: 5, color: COLOR.ink, cap: 'round' }
    const closed = blinking || emotion === 'sleepy' || yawning
    const lookX = emotion === 'thinking' ? 5 : 0
    const lookY = emotion === 'thinking' ? -5 : 0

    for (const x of [-40, 40]) {
      if (closed) g.moveTo(x - 12, -20).lineTo(x + 12, -20).stroke(stroke)
      else g.circle(x + lookX, -22 + lookY, 11).fill(COLOR.ink)
    }

    if (giggling && !yawning) {
      g.ellipse(-68, 12, 14, 8).fill({ color: COLOR.blush, alpha: 0.55 })
      g.ellipse(68, 12, 14, 8).fill({ color: COLOR.blush, alpha: 0.55 })
    }

    if (yawning) {
      g.ellipse(0, 40, 22, 26).fill(COLOR.mouth)
    } else if (giggling) {
      g.ellipse(0, 36, 25, 13 + this.mouthOpen * 8).fill(COLOR.mouth)
    } else if (this.mouthOpen > 0.06) {
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
