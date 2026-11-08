import { Application, Container, Graphics } from 'pixi.js'
import { MINI, createGame, enemyX, enemyY, startGame, stepGame, type GameState, type Phase } from './logic'

export type Snapshot = { phase: Phase; score: number; lives: number; wave: number }

const C = {
  deep: 0x070a18,
  navy: 0x1b2348,
  navyLight: 0x3d4a86,
  gold: 0xbba553,
  goldLight: 0xf0dfa0,
  grey: 0xe8e8e8,
  hot: 0xe0507f,
  hotLight: 0xffa8c4,
}

/**
 * The minigame's Pixi view: the orb gem is the ship, angular shards are the invaders.
 * All rules live in `logic.ts`; this class only maps normalised coordinates to pixels,
 * feeds input, and draws.
 */
export class ShooterScene {
  private app = new Application()
  private world = new Container()
  private bg = new Graphics()
  private stars = new Graphics()
  private actors = new Graphics()
  private state: GameState = createGame()
  private rect = { x0: 0, y0: 0, w: 1, h: 1 }
  private keys = new Set<'left' | 'right'>()
  private pointerX: number | undefined
  private last: Snapshot | null = null
  private canvas: HTMLCanvasElement | null = null
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.onExit()
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      this.keys.add('left')
      e.preventDefault()
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      this.keys.add('right')
      e.preventDefault()
    } else if ((e.key === 'Enter' || e.key === ' ') && this.state.phase !== 'playing') {
      e.preventDefault()
      this.start()
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.delete('left')
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.delete('right')
  }

  private onPointer = (e: PointerEvent) => {
    if (!this.canvas) return
    if (e.type === 'pointerleave') {
      this.pointerX = undefined
      return
    }
    const box = this.canvas.getBoundingClientRect()
    this.pointerX = Math.max(0, Math.min(1, (e.clientX - box.left - this.rect.x0) / this.rect.w))
  }

  constructor(
    private onSnapshot: (s: Snapshot) => void,
    private onExit: () => void,
  ) {}

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    })
    const canvas = this.app.canvas
    canvas.style.display = 'block'
    canvas.style.touchAction = 'none'
    host.appendChild(canvas)
    this.canvas = canvas

    this.app.stage.addChild(this.bg, this.world)
    this.world.addChild(this.stars, this.actors)

    canvas.addEventListener('pointermove', this.onPointer)
    canvas.addEventListener('pointerdown', this.onPointer)
    canvas.addEventListener('pointerleave', this.onPointer)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)

    this.app.renderer.on('resize', () => this.layout())
    this.layout()
    this.app.ticker.add((tk) => this.update(tk.deltaMS / 1000))
    this.push()
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    if (this.canvas) {
      this.canvas.removeEventListener('pointermove', this.onPointer)
      this.canvas.removeEventListener('pointerdown', this.onPointer)
      this.canvas.removeEventListener('pointerleave', this.onPointer)
    }
    this.app.destroy({ removeView: true }, { children: true })
  }

  start() {
    startGame(this.state)
    this.push()
  }

  private layout() {
    const { width, height } = this.app.screen
    const side = Math.max(14, width * 0.035)
    const top = Math.max(56, height * 0.08)
    const bottom = Math.max(18, height * 0.03)
    this.rect = { x0: side, y0: top, w: Math.max(1, width - side * 2), h: Math.max(1, height - top - bottom) }
    this.drawBackground()
  }

  private px(nx: number) {
    return this.rect.x0 + nx * this.rect.w
  }

  private py(ny: number) {
    return this.rect.y0 + ny * this.rect.h
  }

  private update(dt: number) {
    const move: -1 | 0 | 1 = this.keys.has('right') ? 1 : this.keys.has('left') ? -1 : 0
    stepGame(this.state, dt, { move, pointerX: this.pointerX })
    this.draw()
    this.push()
  }

  private push() {
    const { phase, score, lives, wave } = this.state
    const last = this.last
    if (last && last.phase === phase && last.score === score && last.lives === lives && last.wave === wave) return
    this.last = { phase, score, lives, wave }
    this.onSnapshot(this.last)
  }

  private draw() {
    const s = this.state
    const amp = this.reduceMotion ? 0 : s.shake * 9
    this.world.position.set(Math.sin(s.t * 90) * amp, Math.cos(s.t * 77) * amp)

    this.drawStars()

    const g = this.actors.clear()
    for (const e of s.enemies) {
      if (e.alive) this.drawEnemy(g, enemyX(s, e), enemyY(s, e), e.id)
    }
    for (const b of s.bullets) this.drawBullet(g, b)
    for (const p of s.particles) this.drawParticle(g, p)
    if (s.phase !== 'over') this.drawShip(g, s.shipX, MINI.shipY, s.invuln > 0, s.t)
  }

  private drawBackground() {
    const { width, height } = this.app.screen
    const g = this.bg.clear()
    g.rect(0, 0, width, height).fill(C.deep)

    const cx = width / 2
    const cy = height * 0.45
    const maxR = Math.hypot(width, height) * 0.7
    for (let i = 0; i < 14; i++) {
      const u = 1 - i / 14
      g.circle(cx, cy, maxR * u).fill({ color: C.navy, alpha: 0.1 })
    }

    // Faint grid plus 45-degree traces: same shape language as the orb skin.
    const step = 84
    for (let x = 0; x <= width; x += step) {
      g.moveTo(x, 0).lineTo(x, height).stroke({ width: 1, color: C.gold, alpha: 0.03 })
    }
    for (let y = 0; y <= height; y += step) {
      g.moveTo(0, y).lineTo(width, y).stroke({ width: 1, color: C.gold, alpha: 0.03 })
    }
    for (let i = 0; i < 6; i++) {
      const ox = ((i * 211) % Math.max(1, width - 200)) + 30
      const oy = ((i * 137) % Math.max(1, height - 200)) + 40
      g.moveTo(ox, oy)
        .lineTo(ox + 64, oy)
        .lineTo(ox + 94, oy + 30)
        .stroke({ width: 1.2, color: C.gold, alpha: 0.09 })
      g.circle(ox, oy, 2.4).fill({ color: C.gold, alpha: 0.16 })
    }

    // The line the formation must not cross.
    const y = this.py(MINI.loseY)
    for (let x = this.rect.x0; x < this.rect.x0 + this.rect.w; x += 26) {
      g.moveTo(x, y).lineTo(Math.min(x + 12, this.rect.x0 + this.rect.w), y)
        .stroke({ width: 2, color: C.hot, alpha: 0.28 })
    }
  }

  private drawStars() {
    const g = this.stars.clear()
    const t = this.state.t
    for (let i = 0; i < 44; i++) {
      const nx = (i * 0.6180339887) % 1
      const speed = 0.008 + (i % 5) * 0.005
      const ny = ((i * 0.371 + t * speed) % 1 + 1) % 1
      const a = 0.1 + (i % 4) * 0.05
      g.circle(this.px(nx), this.py(ny), 1 + (i % 3) * 0.5).fill({ color: C.grey, alpha: a })
    }
  }

  private drawShip(g: Graphics, nx: number, ny: number, invuln: boolean, t: number) {
    const u = Math.min(this.rect.w, this.rect.h) * 0.052
    const x = this.px(nx)
    const y = this.py(ny)
    const a = invuln ? 0.35 + 0.35 * Math.sin(t * 26) : 1

    // A small version of the orb: faceted gem, gold rim, two slash eyes.
    const body = [
      0, -1.15, 0.78, -0.55, 1, 0.1, 0, 1.05, -1, 0.1, -0.78, -0.55,
    ].map((v, i) => (i % 2 === 0 ? x + v * u : y + v * u))
    g.poly(body, true).fill({ color: C.navy, alpha: 0.98 * a })
    g.poly(body, true).stroke({ width: 2, color: C.gold, alpha: a })
    g.poly([x - 0.9 * u, y - 0.1 * u, x + 0.9 * u, y - 0.1 * u, x, y + 0.9 * u], true)
      .fill({ color: C.navyLight, alpha: 0.5 * a })

    for (const side of [-1, 1]) {
      const ex = x + side * 0.4 * u
      const ey = y - 0.28 * u
      g.poly(
        [ex - 0.22 * u, ey + 0.1 * u, ex + 0.22 * u, ey - 0.06 * u, ex + 0.22 * u, ey + 0.14 * u, ex - 0.22 * u, ey + 0.3 * u],
        true,
      ).fill({ color: C.goldLight, alpha: a })
    }

    // Engine glow under the gem.
    g.circle(x, y + 1.15 * u, 0.5 * u).fill({ color: C.gold, alpha: 0.35 * a })
  }

  private drawEnemy(g: Graphics, nx: number, ny: number, id: number) {
    const u = Math.min(this.rect.w, this.rect.h) * 0.038
    const x = this.px(nx)
    const y = this.py(ny)
    const shard = [-0.95, -0.35, 0.15, -0.95, 0.95, 0.35, -0.15, 0.95].map((v, i) =>
      i % 2 === 0 ? x + v * u : y + v * u,
    )
    g.poly(shard, true).fill({ color: C.navy, alpha: 0.96 })
    g.poly(shard, true).stroke({ width: 1.4, color: C.grey, alpha: 0.55 })
    g.circle(x, y, 0.26 * u + (id % 3) * 0.4).fill({ color: C.hot, alpha: 0.95 })
    g.circle(x, y, 0.55 * u).fill({ color: C.hot, alpha: 0.16 })
  }

  private drawBullet(g: Graphics, b: { x: number; y: number; enemy: boolean }) {
    const x = this.px(b.x)
    const y = this.py(b.y)
    if (b.enemy) {
      g.poly([x, y - 7, x + 4, y, x, y + 7, x - 4, y], true).fill({ color: C.hotLight, alpha: 0.95 })
      g.circle(x, y, 7).fill({ color: C.hot, alpha: 0.2 })
    } else {
      g.roundRect(x - 1.8, y - 9, 3.6, 18, 1.8).fill({ color: C.goldLight, alpha: 0.95 })
      g.roundRect(x - 4, y - 11, 8, 22, 4).fill({ color: C.gold, alpha: 0.18 })
    }
  }

  private drawParticle(g: Graphics, p: { x: number; y: number; life: number; max: number }) {
    const k = p.life / p.max
    g.circle(this.px(p.x), this.py(p.y), 3 * k).fill({ color: C.goldLight, alpha: k })
  }
}
