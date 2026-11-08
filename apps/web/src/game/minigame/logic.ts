/**
 * Pure simulation for the orb minigame: a classic formation shooter. No DOM, no Pixi,
 * no wall clock — `stepGame` advances a plain object, and the only randomness is a seeded
 * PRNG stored in the state, so a run is reproducible and testable.
 *
 * Coordinates are normalised: x and y both run 0..1, y increases downward.
 * The renderer maps them onto the play area, so the game is resolution-independent.
 */

export type Phase = 'intro' | 'playing' | 'over'

export type Bullet = { x: number; y: number; vy: number; enemy: boolean; dead?: boolean }
export type Enemy = { id: number; col: number; row: number; alive: boolean }
export type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number }

export type GameState = {
  phase: Phase
  /** Seconds of simulated play; used by the renderer for idle animation. */
  t: number
  score: number
  lives: number
  wave: number
  shipX: number
  /** Formation offset, applied on top of each enemy's home slot. */
  blockX: number
  blockY: number
  dir: 1 | -1
  bullets: Bullet[]
  enemies: Enemy[]
  particles: Particle[]
  fireIn: number
  enemyFireIn: number
  /** Seconds of invulnerability after a hit. */
  invuln: number
  /** 0..1, decays; the renderer turns it into screen shake. */
  shake: number
  seed: number
  nextId: number
}

export type Input = { move: -1 | 0 | 1; pointerX?: number }

export const MINI = {
  cols: 5,
  rows: 3,
  colGap: 0.16,
  rowGap: 0.1,
  blockLeft: 0.1,
  blockTop: 0.1,
  drop: 0.045,
  shipY: 0.87,
  shipMinX: 0.07,
  shipMaxX: 0.93,
  shipSpeed: 0.8,
  fireEvery: 0.24,
  bulletSpeed: 0.95,
  enemyBulletSpeed: 0.32,
  /** Hit radii, in normalised units. */
  hitX: 0.05,
  hitY: 0.045,
  shipHitX: 0.05,
  shipHitY: 0.05,
  /** Any enemy below this line ends the run. */
  loseY: 0.8,
  lives: 3,
  /** Blocks drift at `baseSpeed + wave * speedPerWave`. */
  baseSpeed: 0.055,
  speedPerWave: 0.012,
  enemyFireBase: 1.15,
  enemyFirePerWave: 0.1,
  enemyFireMin: 0.3,
  invulnSec: 1.6,
} as const

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** mulberry32: tiny, deterministic, good enough for enemy fire. */
function rand(s: GameState): number {
  s.seed = (s.seed + 0x6d2b79f5) | 0
  let t = Math.imul(s.seed ^ (s.seed >>> 15), 1 | s.seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const enemyX = (s: GameState, e: Enemy) => MINI.blockLeft + e.col * MINI.colGap + s.blockX
export const enemyY = (s: GameState, e: Enemy) => MINI.blockTop + e.row * MINI.rowGap + s.blockY

function buildWave(s: GameState) {
  s.enemies = []
  for (let row = 0; row < MINI.rows; row++) {
    for (let col = 0; col < MINI.cols; col++) {
      s.enemies.push({ id: s.nextId++, col, row, alive: true })
    }
  }
  s.blockX = 0
  s.blockY = 0
  s.dir = 1
  s.enemyFireIn = Math.max(MINI.enemyFireMin, MINI.enemyFireBase - s.wave * MINI.enemyFirePerWave)
}

export function createGame(seed = 7): GameState {
  const s: GameState = {
    phase: 'intro',
    t: 0,
    score: 0,
    lives: MINI.lives,
    wave: 1,
    shipX: 0.5,
    blockX: 0,
    blockY: 0,
    dir: 1,
    bullets: [],
    enemies: [],
    particles: [],
    fireIn: 0,
    enemyFireIn: 1,
    invuln: 0,
    shake: 0,
    seed,
    nextId: 1,
  }
  buildWave(s)
  return s
}

export function startGame(s: GameState): GameState {
  s.phase = 'playing'
  s.t = 0
  s.score = 0
  s.lives = MINI.lives
  s.wave = 1
  s.shipX = 0.5
  s.bullets = []
  s.particles = []
  s.fireIn = 0
  s.invuln = 1
  s.shake = 0
  buildWave(s)
  return s
}

function burst(s: GameState, x: number, y: number) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4
    const speed = 0.12 + (i % 3) * 0.04
    s.particles.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 0.45,
      max: 0.45,
    })
  }
}

/**
 * Advance the simulation by `dt` seconds. Mutates and returns `s` (cheap at 60 fps); call
 * `createGame()` for a fresh run in tests.
 */
export function stepGame(s: GameState, dt: number, input: Input): GameState {
  const d = Math.min(Math.max(dt, 0), 0.05) // a background tab must not teleport everything
  s.t += d
  if (s.phase !== 'playing') return s

  s.invuln = Math.max(0, s.invuln - d)
  s.shake = Math.max(0, s.shake - d * 2)

  // Ship: pointer drag wins over the keyboard while it is held.
  if (input.pointerX != null) s.shipX = clamp(input.pointerX, MINI.shipMinX, MINI.shipMaxX)
  else s.shipX = clamp(s.shipX + input.move * MINI.shipSpeed * d, MINI.shipMinX, MINI.shipMaxX)

  // Auto-fire: the booth has one hand free, so aiming is the only job.
  s.fireIn -= d
  if (s.fireIn <= 0) {
    s.fireIn = MINI.fireEvery
    s.bullets.push({ x: s.shipX, y: MINI.shipY - 0.05, vy: -MINI.bulletSpeed, enemy: false })
  }

  // Bullets move, then leave the field.
  for (const b of s.bullets) b.y += b.vy * d
  s.bullets = s.bullets.filter((b) => b.y > -0.08 && b.y < 1.08)

  // Formation: drift sideways, drop a step and reverse at the walls.
  const alive = s.enemies.filter((e) => e.alive)
  if (alive.length) {
    s.blockX += s.dir * (MINI.baseSpeed + s.wave * MINI.speedPerWave) * d
    const xs = alive.map((e) => enemyX(s, e))
    const maxX = Math.max(...xs)
    const minX = Math.min(...xs)
    if (maxX > 0.92 && s.dir > 0) {
      s.blockX -= maxX - 0.92
      s.dir = -1
      s.blockY += MINI.drop
    } else if (minX < 0.08 && s.dir < 0) {
      s.blockX += 0.08 - minX
      s.dir = 1
      s.blockY += MINI.drop
    }
    if (alive.some((e) => enemyY(s, e) > MINI.loseY)) {
      s.phase = 'over'
      s.shake = 1
      return s
    }
  }

  // Player bullets vs enemies.
  const kept: Bullet[] = []
  for (const b of s.bullets) {
    if (b.enemy) {
      kept.push(b)
      continue
    }
    let hit = false
    for (const e of s.enemies) {
      if (!e.alive) continue
      if (Math.abs(b.x - enemyX(s, e)) < MINI.hitX && Math.abs(b.y - enemyY(s, e)) < MINI.hitY) {
        e.alive = false
        s.score += 10 + s.wave * 2
        s.shake = Math.max(s.shake, 0.25)
        burst(s, enemyX(s, e), enemyY(s, e))
        hit = true
        break
      }
    }
    if (!hit) kept.push(b)
  }
  s.bullets = kept

  // Enemy bullets vs ship.
  if (s.invuln <= 0) {
    const surviving: Bullet[] = []
    for (const b of s.bullets) {
      const hit =
        b.enemy &&
        Math.abs(b.x - s.shipX) < MINI.shipHitX &&
        Math.abs(b.y - MINI.shipY) < MINI.shipHitY
      if (hit) {
        s.lives -= 1
        s.invuln = MINI.invulnSec
        s.shake = 0.8
        burst(s, b.x, b.y)
        if (s.lives <= 0) {
          s.phase = 'over'
          return s
        }
      } else {
        surviving.push(b)
      }
    }
    s.bullets = surviving
  }

  // Enemies drop a shot now and then, from a random living one.
  s.enemyFireIn -= d
  if (s.enemyFireIn <= 0) {
    const targets = s.enemies.filter((e) => e.alive)
    if (targets.length) {
      const e = targets[Math.floor(rand(s) * targets.length)]
      s.bullets.push({ x: enemyX(s, e), y: enemyY(s, e) + 0.03, vy: MINI.enemyBulletSpeed, enemy: true })
    }
    s.enemyFireIn = Math.max(MINI.enemyFireMin, MINI.enemyFireBase - s.wave * MINI.enemyFirePerWave)
  }

  // Wave cleared: next one is faster and worth a bonus.
  if (s.enemies.length && s.enemies.every((e) => !e.alive)) {
    s.wave += 1
    s.score += 50
    s.bullets = s.bullets.filter((b) => !b.enemy)
    buildWave(s)
  }

  for (const p of s.particles) {
    p.x += p.vx * d
    p.y += p.vy * d
    p.life -= d
  }
  s.particles = s.particles.filter((p) => p.life > 0)

  return s
}
