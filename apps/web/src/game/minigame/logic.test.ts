import { describe, expect, it } from 'vitest'
import { MINI, createGame, enemyX, enemyY, startGame, stepGame } from './logic'

const play = (seed = 7) => startGame(createGame(seed))

describe('setup', () => {
  it('starts on the intro screen with a full formation', () => {
    const s = createGame()
    expect(s.phase).toBe('intro')
    expect(s.enemies).toHaveLength(MINI.cols * MINI.rows)
    expect(s.enemies.every((e) => e.alive)).toBe(true)
    expect(s.lives).toBe(MINI.lives)
  })

  it('startGame resets a finished run', () => {
    const s = createGame()
    s.phase = 'over'
    s.score = 999
    s.lives = 0
    s.wave = 4
    s.bullets = [{ x: 0.5, y: 0.5, vy: 0, enemy: true }]
    startGame(s)
    expect(s).toMatchObject({ phase: 'playing', score: 0, lives: MINI.lives, wave: 1 })
    expect(s.bullets).toHaveLength(0)
    expect(s.enemies).toHaveLength(MINI.cols * MINI.rows)
  })

  it('does nothing while on the intro screen', () => {
    const s = createGame()
    const before = s.shipX
    stepGame(s, 0.5, { move: 1 })
    expect(s.shipX).toBe(before)
    expect(s.bullets).toHaveLength(0)
  })
})

describe('ship', () => {
  it('moves with the keyboard and stops at the walls', () => {
    const s = play()
    stepGame(s, 0.1, { move: 1 })
    expect(s.shipX).toBeGreaterThan(0.5)
    for (let i = 0; i < 60; i++) stepGame(s, 0.05, { move: 1 })
    expect(s.shipX).toBe(MINI.shipMaxX)
    for (let i = 0; i < 60; i++) stepGame(s, 0.05, { move: -1 })
    expect(s.shipX).toBe(MINI.shipMinX)
  })

  it('follows a pointer when one is given, ignoring the keyboard', () => {
    const s = play()
    stepGame(s, 0.05, { move: 1, pointerX: 0.2 })
    expect(s.shipX).toBe(0.2)
    stepGame(s, 0.05, { move: 1, pointerX: 9 })
    expect(s.shipX).toBe(MINI.shipMaxX)
  })

  it('clamps a huge frame so a background tab cannot teleport anything', () => {
    const s = play()
    s.shipX = 0.5
    stepGame(s, 5, { move: 1 })
    expect(s.shipX).toBeCloseTo(0.5 + MINI.shipSpeed * 0.05, 6)
  })
})

describe('shooting', () => {
  it('auto-fires on a fixed cadence', () => {
    const s = play()
    stepGame(s, 0.01, { move: 0 })
    expect(s.bullets.filter((b) => !b.enemy)).toHaveLength(1)
    for (let i = 0; i < 24; i++) stepGame(s, 0.01, { move: 0 }) // 0.24 s
    expect(s.bullets.filter((b) => !b.enemy).length).toBe(2)
  })

  it('kills an enemy, scores, and leaves a particle burst', () => {
    const s = play()
    const target = s.enemies[0]
    s.bullets = [{ x: enemyX(s, target), y: enemyY(s, target), vy: 0, enemy: false }]
    const before = s.score
    stepGame(s, 0.01, { move: 0 })
    expect(target.alive).toBe(false)
    expect(s.score).toBe(before + 10 + s.wave * 2)
    expect(s.particles.length).toBeGreaterThan(0)
  })

  it('advances the wave and rebuilds the formation when the field is clear', () => {
    const s = play()
    for (const e of s.enemies) e.alive = false
    s.bullets = []
    stepGame(s, 0.01, { move: 0 })
    expect(s.wave).toBe(2)
    expect(s.score).toBe(50)
    expect(s.enemies).toHaveLength(MINI.cols * MINI.rows)
    expect(s.enemies.every((e) => e.alive)).toBe(true)
  })
})

describe('damage', () => {
  it('an enemy bullet costs a life and grants a moment of invulnerability', () => {
    const s = play()
    s.invuln = 0
    s.bullets = [{ x: s.shipX, y: MINI.shipY, vy: 0, enemy: true }]
    stepGame(s, 0.01, { move: 0 })
    expect(s.lives).toBe(MINI.lives - 1)
    expect(s.invuln).toBeGreaterThan(0)

    // A second bullet during invulnerability is ignored.
    s.bullets = [{ x: s.shipX, y: MINI.shipY, vy: 0, enemy: true }]
    stepGame(s, 0.01, { move: 0 })
    expect(s.lives).toBe(MINI.lives - 1)
  })

  it('ends the run when the last life is gone', () => {
    const s = play()
    s.lives = 1
    s.invuln = 0
    s.bullets = [{ x: s.shipX, y: MINI.shipY, vy: 0, enemy: true }]
    stepGame(s, 0.01, { move: 0 })
    expect(s.phase).toBe('over')
  })

  it('ends the run when the formation reaches the bottom', () => {
    const s = play()
    s.blockY = MINI.loseY
    stepGame(s, 0.01, { move: 0 })
    expect(s.phase).toBe('over')
  })
})

describe('determinism', () => {
  it('the same seed and inputs give the same run', () => {
    const run = () => {
      const s = play(1234)
      for (let i = 0; i < 400; i++) stepGame(s, 1 / 60, { move: i % 120 < 60 ? 1 : -1 })
      return { score: s.score, lives: s.lives, wave: s.wave, bullets: s.bullets.length }
    }
    expect(run()).toEqual(run())
  })
})
