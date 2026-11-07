import { Application, Container, Graphics } from 'pixi.js'
import { voice } from '../audio/voice'
import {
  ORB,
  approachPalette,
  blink,
  breath,
  clamp01,
  lerp,
  lissajous,
  mixColor,
  paletteFor,
  paletteToLive,
  polylinePoint,
  reactionPulse,
  ringRadius,
  smoothstep,
  sparkPosition,
  waveformY,
  type LivePalette,
} from './orbMath'
import { clearPetHitTest, setPetHitTest } from './petTarget'
import type { Emotion, ReactionKind } from './rules'
import type { FrameInput, Scene } from './sceneContract'

/** Gem silhouette in units of R. A faceted shield/diamond, not the club emblem. */
const GEM = [-0.72, -0.68, 0.72, -0.68, 1, -0.2, 0, 1, -1, -0.2]
const CENTER = [0, -0.04]
const FACET_SHADE = [0.72, 0.44, 0.08, 0.24, 0.55]

/** Circuit traces: only 0/45/90 degree turns, every one ending in a round node dot. */
const TRACES: number[][] = [
  [-0.66, -0.42, -0.3, -0.42, -0.08, -0.2, 0.36, -0.2],
  [-0.52, -0.56, -0.52, -0.3, -0.3, -0.08, -0.3, 0.22],
  [0.16, -0.56, 0.16, -0.34, 0.4, -0.1, 0.4, 0.14],
  [-0.36, 0.1, -0.1, 0.1, 0.14, 0.34, 0.36, 0.34],
  [-0.62, -0.12, -0.62, 0.02, -0.48, 0.16],
  [0.46, -0.44, 0.64, -0.44, 0.64, -0.26],
  [-0.08, -0.52, 0.1, -0.52, 0.28, -0.34],
]

const REACTION_SECONDS: Record<ReactionKind, number> = {
  giggle: 0.8,
  yawn: 1.7,
  call: 2.5,
}

type Draw = { emotion: Emotion; talking: boolean; sleepy: boolean }

/**
 * The opt-in `?skin=orb` companion. Same contract as `PetScene`, but it draws its own
 * deep-navy background, a faceted gem with an inner circuit, and a gold-on-navy glow.
 * All motion is deterministic (sums of sines, Lissajous curves, eased envelopes).
 */
export class OrbScene implements Scene {
  private app = new Application()
  private pet = new Container()
  private bg = new Graphics()
  private glow = new Graphics()
  private particles = new Graphics()
  private orbit = new Graphics()
  private body = new Graphics()
  private traces = new Graphics()
  private pulses = new Graphics()
  private face = new Graphics()
  private fx = new Graphics()

  private t = 0
  private cx = 0
  private cy = 0
  private w = 0
  private h = 0
  private readonly R = 140
  private baseScale = 1
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private live: LivePalette = paletteToLive(paletteFor('neutral'))

  private lastReactionId = 0
  private reactionKind: ReactionKind | null = null
  private reactionAt = -10
  private bodyKey = ''
  private traceKey = ''

  private canvas: HTMLCanvasElement | null = null
  private hitTestFn = (x: number, y: number) => this.hitTest(x, y)
  private onPointerDown = (e: PointerEvent) => {
    if (this.hitTest(e.clientX, e.clientY)) this.onPoke()
  }

  constructor(
    private readInput: () => FrameInput,
    private onPoke: () => void,
  ) {}

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host,
      backgroundAlpha: 0, // this skin paints its own opaque navy background
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    })
    const canvas = this.app.canvas
    canvas.style.display = 'block'
    canvas.style.touchAction = 'none' // a spark drag must not scroll or zoom the page
    host.appendChild(canvas)
    this.canvas = canvas

    for (const layer of [this.glow, this.particles, this.pulses, this.orbit, this.fx]) {
      layer.blendMode = 'add'
    }
    this.drawHalo()

    this.app.stage.addChild(this.bg, this.particles, this.pet)
    this.pet.addChild(this.glow, this.orbit, this.body, this.traces, this.pulses, this.face, this.fx)

    canvas.addEventListener('pointerdown', this.onPointerDown)
    setPetHitTest(this.hitTestFn)
    this.app.renderer.on('resize', () => this.layout())
    this.layout()
    this.app.ticker.add((tk) => this.update(tk.deltaMS / 1000))
  }

  destroy() {
    clearPetHitTest(this.hitTestFn)
    this.canvas?.removeEventListener('pointerdown', this.onPointerDown)
    this.app.destroy({ removeView: true }, { children: true })
  }

  /** White concentric rings tinted per frame, blurred once for a soft additive halo. */
  private drawHalo() {
    const g = this.glow.clear()
    // Overlapping additive rings: a narrow bright band just outside the rim plus a long
    // faint tail. Cheaper than a blur filter and it keeps the glow reading as light.
    for (let i = 0; i < 14; i++) {
      const u = 1 - i / 14 // 1 at the outside, 0 at the core
      const r = this.R * (0.84 + 2.1 * u)
      const band = Math.exp(-(((u - 0.12) / 0.17) ** 2))
      const tail = Math.exp(-(((u - 0.46) / 0.46) ** 2))
      g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.006 + 0.075 * band + 0.014 * tail })
    }
  }

  private layout() {
    const { width, height } = this.app.screen
    this.w = width
    this.h = height
    this.baseScale = Math.max(0.32, Math.min(width / 720, height / 700))
    this.cx = width / 2
    this.cy = height * 0.44
    this.pet.position.set(this.cx, this.cy)
    this.drawBackground()
  }

  private drawBackground() {
    const g = this.bg.clear()
    g.rect(0, 0, this.w, this.h).fill(ORB.deep)

    // A radial gradient built from overlapping translucent circles: no gradient API needed.
    const maxR = Math.hypot(this.w, this.h) * 0.72
    for (let i = 0; i < 16; i++) {
      const u = 1 - i / 16
      const c = mixColor(ORB.deep, ORB.navy, 0.6 * (1 - u))
      g.circle(this.cx, this.cy, maxR * u).fill({ color: c, alpha: 0.12 })
    }

    // Faint 0/90 circuit grid with round node dots at every other crossing.
    const step = 72
    for (let x = 0; x <= this.w; x += step) {
      g.moveTo(x, 0).lineTo(x, this.h).stroke({ width: 1, color: ORB.gold, alpha: 0.035 })
    }
    for (let y = 0; y <= this.h; y += step) {
      g.moveTo(0, y).lineTo(this.w, y).stroke({ width: 1, color: ORB.gold, alpha: 0.035 })
    }
    for (let x = step; x < this.w; x += step * 2) {
      for (let y = step; y < this.h; y += step * 2) {
        g.circle(x, y, 1.7).fill({ color: ORB.gold, alpha: 0.075 })
      }
    }

    // Long angular traces with 45-degree corners, terminating in round nodes.
    for (let i = 0; i < 9; i++) {
      const ox = ((i * 173) % Math.max(1, this.w - 190)) + 30
      const oy = ((i * 97) % Math.max(1, this.h - 150)) + 30
      const len = 52 + (i % 3) * 34
      const pts = [ox, oy, ox + len, oy, ox + len + 30, oy + 30, ox + len + 30, oy + 66]
      this.stroke(g, pts, ORB.gold, 1.3, 0.11)
      g.circle(ox, oy, 2.6).fill({ color: ORB.gold, alpha: 0.2 })
      g.circle(pts[6], pts[7], 2.6).fill({ color: ORB.gold, alpha: 0.2 })
    }

    // Abstract layered facets in the corners: shape language only, nothing traced from a logo.
    for (const [side, alpha] of [[-1, 0.055], [1, 0.04]] as const) {
      const x = side < 0 ? this.w * 0.12 : this.w * 0.88
      const y = this.h * (side < 0 ? 0.72 : 0.24)
      const s = Math.min(this.w, this.h) * 0.2
      for (let k = 0; k < 3; k++) {
        const d = s * (1 + k * 0.28)
        g.poly([x, y - d, x + d * 0.62, y, x, y + d, x - d * 0.62, y], true)
          .stroke({ width: 1.2, color: ORB.gold, alpha: alpha - k * 0.012 })
      }
    }
  }

  /** Flat [x0,y0,...] polyline to gold hairline. */
  private stroke(g: Graphics, pts: readonly number[], color: number, width: number, alpha: number) {
    if (pts.length < 4) return
    g.moveTo(pts[0], pts[1])
    for (let i = 2; i + 1 < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1])
    g.stroke({ width, color, alpha, cap: 'round', join: 'round' })
  }

  /** A skewed parallelogram ribbon, the same diagonal slash language as the club mark. */
  private ribbon(g: Graphics, x1: number, y1: number, x2: number, y2: number, w: number, sk: number, color: number, alpha: number) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    const nx = (-(-(y2 - y1)) / len) * (w / 2)
    const ny = ((x2 - x1) / len) * (w / 2)
    g.poly(
      [
        x1 + nx + sk, y1 + ny,
        x2 + nx + sk, y2 + ny,
        x2 - nx - sk, y2 - ny,
        x1 - nx - sk, y1 - ny,
      ],
      true,
    ).fill({ color, alpha })
  }

  private hitTest(clientX: number, clientY: number): boolean {
    const rect = this.canvas?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return false
    const sx = rect.width / (this.app.screen.width || rect.width)
    const sy = rect.height / (this.app.screen.height || rect.height)
    const dx = (clientX - rect.left) / sx - this.pet.x
    const dy = (clientY - rect.top) / sy - this.pet.y
    const r = this.R * this.baseScale * 1.05
    return dx * dx + dy * dy <= r * r
  }

  private update(dt: number) {
    this.t += dt
    const frame = this.readInput()
    if (frame.reaction && frame.reaction.id !== this.lastReactionId) {
      this.lastReactionId = frame.reaction.id
      this.reactionKind = frame.reaction.kind
      this.reactionAt = this.t
    }
    const kind = this.reactionKind
    const elapsed = this.t - this.reactionAt
    const env = kind ? reactionPulse(elapsed, REACTION_SECONDS[kind]) : 0
    if (env <= 0 && kind) this.reactionKind = null

    const P = (this.live = approachPalette(this.live, paletteFor(frame.emotion), 1 - Math.exp(-dt * 5)))
    const m = this.reduceMotion ? 0 : 1
    const gold = P.gold
    const goldLight = P.goldLight
    const intensity = clamp01(P.intensity)

    // Breathing + hover (sum of sines), with a short wobble on a giggle.
    const b = breath(this.t, P.breathRate, 1)
    const hover = b * 7 * m
    const scale = (1 + b * 0.018 * m) * (kind === 'yawn' ? 1 - env * 0.05 * m : 1)
    this.pet.position.set(this.cx, this.cy + hover + P.droop * this.R * this.baseScale)
    this.pet.scale.set(this.baseScale * scale)
    this.pet.rotation = kind === 'giggle' ? Math.sin(this.t * 30) * 0.13 * env * m : 0

    let glowA = P.glow * 1.25 * (0.84 + 0.16 * Math.sin(this.t * P.breathRate))
    if (kind === 'giggle') glowA += env * 0.55
    if (kind === 'yawn') glowA *= 1 - env * 0.6
    if (kind === 'call') glowA += env * 0.5
    this.glow.alpha = Math.min(1.2, Math.max(0, glowA))
    this.glow.tint = gold

    this.drawParticles(gold, intensity)
    // Body and traces only depend on the (slowly interpolated) palette, so rebuild them
    // when it actually moves rather than 60 times a second.
    const key = `${gold}|${goldLight}|${P.navy}|${P.navyLight}|${intensity.toFixed(2)}`
    if (key !== this.bodyKey) {
      this.bodyKey = key
      this.drawBody(gold, goldLight, P, intensity)
      this.drawTraces(gold, intensity)
    }
    this.drawPulses(gold, goldLight, P, intensity, m)
    this.drawOrbit(gold, goldLight, P, m)
    this.drawFace(frame, gold, goldLight, intensity, env, kind)
    this.drawFx(gold, goldLight, P, intensity, env, kind, elapsed, m)
  }

  private drawParticles(gold: number, intensity: number) {
    const g = this.particles.clear()
    for (let i = 0; i < 12; i++) {
      const lt = this.t * 0.16 * (this.reduceMotion ? 0 : 1)
      const px = lissajous(lt + i * 0.37, 1, 1.3, i * 0.8, this.w * 0.45, this.h * 0.42).x
      const py = lissajous(lt + i * 0.29, 1.4, 1, i * 1.1, this.w * 0.42, this.h * 0.4).y
      const a = (0.1 + 0.16 * (0.5 + 0.5 * Math.sin(this.t * 0.6 + i))) * intensity
      g.circle(this.cx + px, this.cy + py, 1.2 + (i % 3) * 0.6).fill({ color: gold, alpha: a })
    }
  }

  private drawBody(gold: number, goldLight: number, P: LivePalette, intensity: number) {
    const g = this.body.clear()
    const R = this.R
    const gem = GEM.map((v) => v * R)
    const [ccx, ccy] = [CENTER[0] * R, CENTER[1] * R]

    // Five facets, each a slightly different navy, from an off-centre core.
    for (let i = 0; i < 5; i++) {
      const j = (i + 1) % 5
      const shade = clamp01(FACET_SHADE[i] * P.intensity)
      const c = mixColor(P.navy, P.navyLight, shade)
      g.poly([gem[i * 2], gem[i * 2 + 1], gem[j * 2], gem[j * 2 + 1], ccx, ccy], true)
        .fill({ color: c, alpha: 0.98 })
    }

    // Inner "table" facet: a smaller, brighter gem inside the body.
    const inner = gem.map((v) => ccx + (v - ccx) * 0.44)
    g.poly(inner, true).fill({ color: P.navyLight, alpha: 0.4 })
    this.stroke(g, [...inner, inner[0], inner[1]], gold, 1.4, 0.22 * intensity)

    // Gold rim light: bright across the shoulders, faint down the lower edges.
    g.poly(gem, true).stroke({ width: 2.4, color: gold, alpha: 0.5 * intensity, join: 'round' })
    this.stroke(g, [gem[8], gem[9], gem[0], gem[1], gem[2], gem[3]], goldLight, 3.6, 0.8 * intensity)
    this.stroke(g, [gem[4], gem[5], gem[6], gem[7]], gold, 1.8, 0.3 * intensity)

    // Two diagonal parallelogram slashes, original accents in the club's shape language.
    this.ribbon(g, -0.62 * R, -0.3 * R, -0.34 * R, -0.56 * R, 0.075 * R, 0.035 * R, goldLight, 0.75 * intensity)
    this.ribbon(g, 0.34 * R, 0.04 * R, 0.54 * R, -0.14 * R, 0.06 * R, 0.028 * R, gold, 0.55 * intensity)

    // A small gear-like node ring at the core (six dots on a circle), and a leaf-shaped facet.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      g.circle(ccx + Math.cos(a) * 0.17 * R, ccy + Math.sin(a) * 0.17 * R, 2.2)
        .fill({ color: gold, alpha: 0.5 * intensity })
    }
    g.ellipse(ccx + 0.3 * R, ccy + 0.34 * R, 0.055 * R, 0.11 * R)
      .fill({ color: gold, alpha: 0.16 * intensity })
  }

  private drawTraces(gold: number, intensity: number) {
    const g = this.traces.clear()
    for (const trace of TRACES) {
      const pts = trace.map((v) => v * this.R)
      this.stroke(g, pts, gold, 1.6, 0.24 * intensity)
      for (const at of [0, pts.length - 2]) {
        g.circle(pts[at], pts[at + 1], 2.7).fill({ color: gold, alpha: 0.42 * intensity })
      }
    }
  }

  private drawPulses(gold: number, goldLight: number, P: LivePalette, intensity: number, m: number) {
    const g = this.pulses.clear()
    for (let i = 0; i < TRACES.length; i++) {
      const pts = TRACES[i].map((v) => v * this.R)
      for (let j = 0; j < 2; j++) {
        const phase = (this.t * P.pulseSpeed * m + i * 0.21 + j * 0.5) % 1
        const p = polylinePoint(pts, phase)
        const r = 3.1 + 1.1 * Math.sin(this.t * 4 + i + j)
        g.circle(p.x, p.y, r * 2.1).fill({ color: gold, alpha: 0.14 * intensity })
        g.circle(p.x, p.y, r).fill({ color: goldLight, alpha: 0.85 * intensity })
      }
    }
  }

  private drawOrbit(gold: number, goldLight: number, P: LivePalette, m: number) {
    const g = this.orbit.clear()
    const think = smoothstep(0.45, 0.85, P.energy)
    const alpha = 0.1 + 0.8 * think
    const t = this.t * 0.55 * m
    const pts: number[] = []
    for (let i = 0; i < 10; i++) {
      const delta = (i / 10) * Math.PI * 2
      const base = lissajous(t + delta, 1, 1, Math.PI / 2, 1.42 * this.R, 1.18 * this.R)
      const wobble = lissajous(this.t * 0.9 * m + delta, 2, 3, 0, 0.1 * this.R, 0.1 * this.R)
      const x = base.x + wobble.x
      const y = base.y + wobble.y
      pts.push(x, y)
    }
    this.stroke(g, [...pts, pts[0], pts[1]], gold, 1.1, alpha * 0.32)
    for (let i = 0; i < pts.length; i += 2) {
      g.circle(pts[i], pts[i + 1], 7).fill({ color: gold, alpha: alpha * 0.2 })
      g.circle(pts[i], pts[i + 1], 2.8).fill({ color: goldLight, alpha: alpha * 0.85 })
    }
  }

  private drawFace(frame: Draw, gold: number, goldLight: number, intensity: number, env: number, kind: ReactionKind | null) {
    const g = this.face.clear()
    const R = this.R
    const thin = frame.sleepy || frame.emotion === 'sleepy' || (kind === 'yawn' && env > 0.08)
    const closed = Math.max(blink(this.t, 3.6, 0.032), thin ? 1 : 0)
    const eyeH = lerp(0.155 * R, 0.016 * R, closed)
    // Both eyes are parallel diagonal slashes, as in the club's ribbon language; the
    // emotion rotates the pair and lifts or lowers them.
    const tilt = this.live.eyeTilt
    const lookX = frame.emotion === 'thinking' ? 0.04 * R : 0
    const lookY =
      (frame.emotion === 'thinking' ? -0.035 : frame.emotion === 'happy' ? -0.02 : frame.emotion === 'sad' ? 0.03 : 0) * R
    const rot = -0.2 + tilt * 1.35

    for (const side of [-1, 1]) {
      const cx = side * 0.31 * R + lookX
      const cy = -0.2 * R + lookY
      const sk = 0.075 * R
      const w = 0.23 * R
      const h = eyeH
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      const corners = [
        [-w / 2 + sk, -h / 2], [w / 2 + sk, -h / 2],
        [w / 2 - sk, h / 2], [-w / 2 - sk, h / 2],
      ]
      const flat: number[] = []
      for (const [x, y] of corners) {
        flat.push(cx + x * cos - y * sin, cy + x * sin + y * cos)
      }
      g.poly(flat, true).fill({ color: goldLight, alpha: 0.95 * intensity })
      g.poly(flat, true).stroke({ width: 1.4, color: gold, alpha: 0.9 * intensity })
    }

    // Angular waveform mouth: flat when quiet, voice-driven when speaking.
    const level = voice.level
    const amp = frame.talking
      ? (level > 0.03 ? Math.min(1, level) : (Math.sin(this.t * 18) * 0.5 + 0.5) * 0.5)
      : 0
    const pts: number[] = []
    for (let i = 0; i <= 14; i++) {
      const u = i / 14
      pts.push(lerp(-0.3 * R, 0.3 * R, u), 0.3 * R + waveformY(u, this.t, amp * 0.18 * R))
    }
    this.stroke(g, pts, gold, 3, 0.9 * intensity)
    g.circle(pts[0], pts[1], 3).fill({ color: goldLight, alpha: 0.8 * intensity })
    g.circle(pts[pts.length - 2], pts[pts.length - 1], 3).fill({ color: goldLight, alpha: 0.8 * intensity })
  }

  private drawFx(
    gold: number,
    goldLight: number,
    P: LivePalette,
    intensity: number,
    env: number,
    kind: ReactionKind | null,
    elapsed: number,
    m: number,
  ) {
    const g = this.fx.clear()
    const R = this.R

    // Inner core light, always present, breathing with the gem.
    g.circle(0, 0, 0.5 * R).fill({ color: gold, alpha: 0.045 * intensity })

    // Crisp additive rim rings give the glow a defined edge (the blurred halo alone is foggy).
    const rim = P.glow * (0.85 + 0.15 * Math.sin(this.t * P.breathRate))
    g.circle(0, 0, 1.025 * R).stroke({ width: 3, color: goldLight, alpha: 0.34 * rim * intensity })
    g.circle(0, 0, 1.11 * R).stroke({ width: 1.6, color: gold, alpha: 0.12 * rim * intensity })

    // Happy: sparks drifting outward on eased 45-degree rays, each with a soft head.
    for (let i = 0; i < 8; i++) {
      const progress = (this.t * 0.34 * m + i / 8) % 1
      const p = sparkPosition(i, 8, progress, 1.85 * R)
      const a = P.energy * (1 - progress) * 0.9
      g.circle(p.x, p.y, 5.5).fill({ color: gold, alpha: a * 0.28 })
      g.circle(p.x, p.y, 2.4).fill({ color: goldLight, alpha: a })
    }

    if (kind === 'giggle') {
      g.circle(0, 0, 1.15 * R).fill({ color: gold, alpha: 0.16 * env })
      for (let i = 0; i < 8; i++) {
        const p = sparkPosition(i, 8, clamp01(elapsed / 0.72), 2.05 * R)
        g.circle(p.x, p.y, 4.2 * (1 - env * 0.4)).fill({ color: goldLight, alpha: env })
      }
    } else if (kind === 'yawn') {
      // A slow exhale: soft round mouth glow instead of the waveform.
      g.circle(0, 0.3 * R, (0.07 + 0.07 * env) * R).fill({ color: gold, alpha: 0.4 * env })
      g.circle(0, 0.3 * R, (0.03 + 0.03 * env) * R).fill({ color: goldLight, alpha: 0.5 * env })
    } else if (kind === 'call') {
      // Expanding rings ripple outward; the halo itself swells (see update).
      for (let i = 0; i < 4; i++) {
        const r = ringRadius(elapsed, i, 3.5 * R)
        if (r <= 0) continue
        const a = (1 - clamp01(elapsed / REACTION_SECONDS.call)) * 0.55
        g.circle(0, 0, r).stroke({ width: 3.2, color: gold, alpha: a })
      }
    }
  }
}
