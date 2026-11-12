import type { BossId } from '../data/ids'
import { TAU, angleTo } from '../engine/math'
import { Boss, type Telegraph } from './entities'
import type { World } from './world'

interface BossSpec {
  r: number
  hp: number
  dmg: number
}

/** Boss 基础数值（血量会再乘威胁等级） */
const SPEC: Record<BossId, BossSpec> = {
  overseer: { r: 58, hp: 12000, dmg: 26 },
  fractal: { r: 48, hp: 16000, dmg: 24 },
  maw: { r: 64, hp: 22000, dmg: 32 },
}

export function spawnBoss(w: World, id: BossId): void {
  const spec = SPEC[id]
  const p = w.player
  const b = new Boss()
  const a = w.rng.angle()
  b.alive = true
  b.id = id
  b.x = p.x + Math.cos(a) * w.viewR * 0.72
  b.y = p.y + Math.sin(a) * w.viewR * 0.72
  b.r = spec.r
  b.dmg = spec.dmg
  b.maxHp = b.hp = spec.hp * w.threat.hp
  b.intro = 2.4
  b.t1 = 2.5
  b.t2 = 3.5
  b.t3 = 6
  b.hitAt.fill(0)
  w.boss = b
  w.emit({ t: 'boss', id, what: 'spawn' })
  w.emit({ t: 'warn', key: `boss.${id}.name`, sev: 2 })
}

export function updateBoss(w: World, dt: number): void {
  const b = w.boss
  if (!b || !b.alive) return
  const p = w.player
  b.age += dt
  if (b.flash > 0) b.flash -= dt
  if (b.contactCd > 0) b.contactCd -= dt

  // 阶段切换：血量跌破 66% / 33%
  const ratio = b.hp / b.maxHp
  const np = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2
  if (np > b.phase && b.intro <= 0) {
    b.phase = np
    b.intro = 1.1
    for (const bl of w.ebullets) bl.alive = false
    w.addBlast(b.x, b.y, b.r * 2.6, '#ffffff', 0.5)
    w.emit({ t: 'boss', id: b.id, what: 'phase' })
    onPhaseChange(w, b)
  }

  if (b.intro > 0) {
    b.intro -= dt
    // 出场/转阶段期间缓慢飘动，不攻击
    const d = Math.hypot(p.x - b.x, p.y - b.y) || 1
    b.x += ((p.x - b.x) / d) * 12 * dt
    b.y += ((p.y - b.y) / d) * 12 * dt
  } else {
    b.t1 -= dt
    b.t2 -= dt
    b.t3 -= dt
    switch (b.id) {
      case 'overseer':
        overseer(w, b, dt)
        break
      case 'fractal':
        fractal(w, b, dt)
        break
      case 'maw':
        maw(w, b, dt)
        break
    }
  }

  // 本体接触伤害
  if (b.contactCd <= 0 && b.intro <= 0) {
    if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + p.r) {
      if (w.hurtPlayer(b.dmg * (b.state === 3 ? 1.5 : 1), b.x, b.y, b.id)) b.contactCd = 0.9
    }
  }
}

function onPhaseChange(w: World, b: Boss): void {
  if (b.id === 'fractal') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU
      w.spawnEnemy('splitter', b.x + Math.cos(a) * (b.r + 30), b.y + Math.sin(a) * (b.r + 30), {
        spawnT: 0.5,
      })
    }
  } else if (b.id === 'maw') {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4
      w.spawnEnemy('wraith', b.x + Math.cos(a) * (b.r + 60), b.y + Math.sin(a) * (b.r + 60), {
        spawnT: 0.5,
      })
    }
  }
  b.t1 = 1.4
  b.t2 = 2.4
  b.t3 = 4
  b.state = 0
}

// ───────────────────────── 通用弹幕工具 ─────────────────────────

function radial(
  w: World,
  x: number,
  y: number,
  n: number,
  start: number,
  speed: number,
  dmg: number,
  color = '#ff3ea5',
  accel = 0,
): void {
  for (let i = 0; i < n; i++) {
    w.spawnEnemyBullet(x, y, start + (i / n) * TAU, speed, dmg, { color, accel, r: 6.5, life: 8 })
  }
}

function aimed(
  w: World,
  b: Boss,
  n: number,
  spread: number,
  speed: number,
  dmg: number,
  color = '#ff6a8a',
): void {
  const a = angleTo(b.x, b.y, w.player.x, w.player.y)
  for (let i = 0; i < n; i++) {
    w.spawnEnemyBullet(b.x, b.y, a + (i - (n - 1) / 2) * spread, speed, dmg, {
      color,
      kind: 'needle',
      r: 5.5,
      life: 7,
    })
  }
}

// ───────────────────────── 监察者 ─────────────────────────

function overseer(w: World, b: Boss, dt: number): void {
  const p = w.player
  const dx = p.x - b.x
  const dy = p.y - b.y
  const d = Math.hypot(dx, dy) || 1
  const spd = [36, 46, 62][b.phase]
  b.ang += dt * (0.5 + 0.35 * b.phase)

  if (b.state === 2) {
    // 冲锋蓄力：停下并锁定方向
    b.stateT -= dt
    if (b.stateT > 0.25) {
      b.tx = dx / d
      b.ty = dy / d
    }
    if (b.stateT <= 0) {
      b.state = 3
      b.stateT = 0.6
    }
  } else if (b.state === 3) {
    b.stateT -= dt
    b.x += b.tx * 520 * dt
    b.y += b.ty * 520 * dt
    if (b.stateT <= 0) {
      b.state = 0
      b.t3 = 5.5
    }
  } else {
    if (d > 290) {
      b.x += (dx / d) * spd * dt
      b.y += (dy / d) * spd * dt
    } else {
      b.x += (-dy / d) * spd * 0.55 * dt
      b.y += (dx / d) * spd * 0.55 * dt
    }
  }

  // 护盾球
  if (b.phase >= 1) {
    if (b.orbs.length === 0) {
      for (let i = 0; i < 4; i++) b.orbs.push({ a: (i / 4) * TAU, x: b.x, y: b.y, r: 13, hp: 1 })
    }
    for (const o of b.orbs) {
      o.a += dt * (1.5 + b.phase * 0.25)
      o.x = b.x + Math.cos(o.a) * (b.r + 66)
      o.y = b.y + Math.sin(o.a) * (b.r + 66)
      if (Math.hypot(p.x - o.x, p.y - o.y) < o.r + p.r) w.hurtPlayer(16, o.x, o.y, b.id)
    }
  }

  if (b.state >= 2) return

  if (b.phase === 0) {
    if (b.t1 <= 0) {
      radial(w, b.x, b.y, 14, b.ang, 175, 12)
      b.t1 = 2.6
    }
    if (b.t3 <= 0) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU
        w.spawnEnemy('drone', b.x + Math.cos(a) * (b.r + 24), b.y + Math.sin(a) * (b.r + 24), { spawnT: 0.4 })
      }
      b.t3 = 7
    }
  } else if (b.phase === 1) {
    if (b.t1 <= 0) {
      radial(w, b.x, b.y, 18, b.ang, 185, 12)
      b.t1 = 2.3
    }
    if (b.t2 <= 0) {
      aimed(w, b, 3, 0.2, 260, 14)
      b.t2 = 3.1
    }
    if (b.t3 <= 0) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.5
        w.spawnEnemy('shooter', b.x + Math.cos(a) * (b.r + 30), b.y + Math.sin(a) * (b.r + 30), {
          spawnT: 0.4,
        })
      }
      b.t3 = 9
    }
  } else {
    // 阶段 3：螺旋弹幕 + 追踪射击 + 冲锋
    b.spin += dt
    const cycle = b.spin % 4.2
    if (cycle < 2.6 && b.t1 <= 0) {
      const a = b.age * 2.6
      w.spawnEnemyBullet(b.x, b.y, a, 165, 12, { color: '#ff3ea5', r: 6.5 })
      w.spawnEnemyBullet(b.x, b.y, a + Math.PI, 165, 12, { color: '#ff3ea5', r: 6.5 })
      b.t1 = 0.1
    }
    if (b.t2 <= 0) {
      aimed(w, b, 5, 0.17, 280, 14)
      b.t2 = 2.6
    }
    if (b.t3 <= 0) {
      b.state = 2
      b.stateT = 0.85
      b.tx = dx / d
      b.ty = dy / d
      w.addTele('line', b.x, b.y, 0.85, '', {
        x2: b.x + b.tx * 520 * 0.6 * 1.4,
        y2: b.y + b.ty * 520 * 0.6 * 1.4,
        r: b.r * 0.9,
        color: '#ff4d6d',
      })
    }
  }
}

// ───────────────────────── 分形核心 ─────────────────────────

function fractal(w: World, b: Boss, dt: number): void {
  const p = w.player
  b.ang += dt * (0.55 + 0.25 * b.phase)
  const orbit = 300 - b.phase * 30
  const tx = p.x + Math.cos(b.ang) * orbit
  const ty = p.y + Math.sin(b.ang) * orbit
  const k = 1 - Math.exp(-1.6 * dt)
  b.x += (tx - b.x) * k
  b.y += (ty - b.y) * k

  if (b.t1 <= 0) {
    const n = 8 + b.phase * 2
    radial(w, b.x, b.y, n, b.ang * 1.7, 190 + b.phase * 12, 11, '#9dff4d')
    b.t1 = 2.4 - b.phase * 0.25
  }

  if (b.phase >= 1 && b.t3 <= 0) {
    // 激光网格：先预警，再落光束
    const axis = w.rng.int(0, 2)
    const lines = b.phase === 1 ? 3 : 4
    for (let i = 0; i < lines; i++) {
      const off = (i - (lines - 1) / 2) * 190 + w.rng.range(-40, 40)
      if (axis === 0) {
        w.addTele('line', p.x - 950, p.y + off, 1.15, 'beam', {
          x2: p.x + 950,
          y2: p.y + off,
          r: 15,
          color: '#9dff4d',
          a: 0,
          b: 30,
        })
      } else {
        w.addTele('line', p.x + off, p.y - 950, 1.15, 'beam', {
          x2: p.x + off,
          y2: p.y + 950,
          r: 15,
          color: '#9dff4d',
          a: Math.PI / 2,
          b: 30,
        })
      }
    }
    b.t3 = 6.2 - b.phase * 0.8
  }

  if (b.phase >= 1 && b.t2 <= 0) {
    aimed(w, b, b.phase === 1 ? 3 : 5, 0.22, 250, 13, '#c8ff66')
    b.t2 = b.phase === 1 ? 3.2 : 2.3
  }
  if (b.phase === 0 && b.t2 <= 0) {
    aimed(w, b, 1, 0, 230, 13, '#c8ff66')
    b.t2 = 1.6
  }
}

// ───────────────────────── 虚空之喉 ─────────────────────────

function maw(w: World, b: Boss, dt: number): void {
  const p = w.player
  const dx = b.x - p.x
  const dy = b.y - p.y
  const d = Math.hypot(dx, dy) || 1
  const spd = [24, 32, 42][b.phase]
  b.x -= (dx / d) * spd * dt
  b.y -= (dy / d) * spd * dt
  b.ang += dt * 0.4

  // 引力：把玩家往中心拽，阶段越高越强；冲刺能挣脱
  if (p.dashT <= 0) {
    const pull = [34, 50, 74][b.phase] * Math.min(1, 700 / Math.max(120, d))
    p.x += (dx / d) * pull * dt
    p.y += (dy / d) * pull * dt
  }

  // 螺旋弹幕
  if (b.t1 <= 0) {
    const arms = [2, 3, 4][b.phase]
    b.spin += 0.23
    for (let i = 0; i < arms; i++) {
      w.spawnEnemyBullet(b.x, b.y, b.spin + (i / arms) * TAU, 150 + b.phase * 12, 12, {
        color: '#c9a0ff',
        r: 6,
        life: 9,
      })
    }
    b.t1 = 0.16
  }

  // 扩散冲击环：需要冲刺穿过
  if (b.t2 <= 0) {
    const r = w.addRing()
    r.hostile = true
    r.x = b.x
    r.y = b.y
    r.r = b.r
    r.maxR = 640
    r.speed = 250
    r.dmg = 22
    r.color = '#c9a0ff'
    b.t2 = [4.4, 3.6, 3.0][b.phase]
  }

  if (b.phase >= 1 && b.t3 <= 0) {
    // 坍缩：玩家脚下预警后爆炸
    const n = b.phase === 1 ? 2 : 3
    for (let i = 0; i < n; i++) {
      const ox = i === 0 ? 0 : w.rng.range(-220, 220)
      const oy = i === 0 ? 0 : w.rng.range(-220, 220)
      w.addTele('circle', p.x + ox + p.vx * 0.4, p.y + oy + p.vy * 0.4, 1.0, 'blast', {
        r: 74,
        color: '#c9a0ff',
        a: 26,
      })
    }
    b.t3 = b.phase === 1 ? 4.2 : 3.2
  }
}

/** 预警结束后的结算（由 world.updateEffects 调用） */
export function runTelegraph(w: World, tl: Telegraph): void {
  if (tl.action === 'beam') {
    const bm = w.addBeam()
    bm.hostile = true
    bm.fixed = true
    bm.ox = tl.x
    bm.oy = tl.y
    bm.ang = tl.a
    bm.len = Math.hypot(tl.x2 - tl.x, tl.y2 - tl.y)
    bm.width = tl.b
    bm.life = bm.maxLife = 0.7
    bm.tick = 0.1
    bm.tickT = 0
    bm.dmg = 18
    bm.color = tl.color
    bm.warn = 0
  } else if (tl.action === 'blast') {
    w.addBlast(tl.x, tl.y, tl.r, tl.color, 0.4)
    w.emit({ t: 'blast', x: tl.x, y: tl.y, r: tl.r, color: tl.color })
    const p = w.player
    if (Math.hypot(p.x - tl.x, p.y - tl.y) < tl.r + p.r) w.hurtPlayer(tl.a || 26, tl.x, tl.y, 'blast')
  }
}
