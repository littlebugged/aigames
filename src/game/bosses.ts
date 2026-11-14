import type { BossId, EBulletKind } from '../data/ids'
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
  forge: { r: 62, hp: 26000, dmg: 34 },
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
    b.t4 -= dt
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
      case 'forge':
        forge(w, b, dt)
        break
    }
  }

  // 本体接触伤害
  if (b.contactCd <= 0 && b.intro <= 0) {
    if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + p.r) {
      if (w.hurtPlayer(b.dmg * (b.id === 'overseer' && b.state === 3 ? 1.5 : 1), b.x, b.y, b.id)) b.contactCd = 0.9
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
  } else if (b.id === 'forge') {
    // 转阶段会打断熔切；炉门敞开，吐出一圈自爆怪（三阶段再混进冲锋者）
    killJets(b)
    const n = b.phase === 1 ? 4 : 6
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.3
      const id = b.phase === 2 && i % 2 === 1 ? 'charger' : 'bomber'
      w.spawnEnemy(id, b.x + Math.cos(a) * (b.r + 50), b.y + Math.sin(a) * (b.r + 50), { spawnT: 0.5 })
    }
    b.t4 = 3.2
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
  kind: EBulletKind = 'orb',
): void {
  for (let i = 0; i < n; i++) {
    w.spawnEnemyBullet(x, y, start + (i / n) * TAU, speed, dmg, { color, accel, r: 6.5, life: 8, kind })
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
      radial(w, b.x, b.y, 14, b.ang, 175, 12, '#ff3ea5', 0, 'lens')
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
      radial(w, b.x, b.y, 18, b.ang, 185, 12, '#ff3ea5', 0, 'lens')
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
      w.spawnEnemyBullet(b.x, b.y, a, 165, 12, { color: '#ff3ea5', r: 6.5, kind: 'lens' })
      w.spawnEnemyBullet(b.x, b.y, a + Math.PI, 165, 12, { color: '#ff3ea5', r: 6.5, kind: 'lens' })
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
    radial(w, b.x, b.y, n, b.ang * 1.7, 190 + b.phase * 12, 11, '#9dff4d', 0, 'shard')
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
        kind: 'fang',
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

// ───────────────────────── 熔炉巨像 ─────────────────────────

const FORGE_HOT = '#ff7a2e'
/** 震地的范围半径；巨像停步的距离比它再远一圈——站着不动不会被踩，贴脸才会 */
const FORGE_ZONE = 176
const FORGE_HOLD = 236
/** 旋转熔切：射线条数 / 角速度（rad/s）/ 持续时间 / 预警时间（按阶段） */
const FORGE_JETS = [0, 2, 3]
const FORGE_OMEGA = [0, 0.62, 0.8]
const FORGE_SWEEP = [0, 2.8, 3.3]
const FORGE_WARN = 1.05

function killJets(b: Boss): void {
  for (const j of b.jets) j.alive = false
  b.jets.length = 0
}

/**
 * 熔炉巨像：重甲炼炉，行动很慢，但每一招都有清楚的预警。
 *  · 余烬弹幕：一圈慢速的熔渣块（ember），一圈接一圈地转着放；
 *  · 熔渣弹：地面先亮预警圈，熔渣团抛过去落在圈里（第一发预判你的走位）；
 *  · 震地（state 1）：脚下亮起一大圈预警，落地后圈内重伤，再震出一道（三阶段两道）冲击环——站远点、或冲刺穿过；
 *  · 旋转熔切（state 2→3，二阶段起）：原地扎根，先亮细线预警（并朝转动方向缓缓爬），然后 2~3 条射线整圈扫过。
 * 状态：0 自由行动，1 震地蓄力，2 熔切预警，3 熔切扫射。
 */
function forge(w: World, b: Boss, dt: number): void {
  const p = w.player
  const dx = p.x - b.x
  const dy = p.y - b.y
  const d = Math.hypot(dx, dy) || 1
  const ph = b.phase

  if (b.state === 1) {
    // 震地蓄力：原地不动，等预警圈结算（见 runTelegraph 的 'slam'）
    b.stateT -= dt
    if (b.stateT <= 0) {
      b.state = 0
      b.t3 = [7.4, 6.4, 5.4][ph]
      b.t1 = Math.max(b.t1, 0.9)
      b.t2 = Math.max(b.t2, 1.5)
      b.t4 = Math.max(b.t4, 2.2)
    }
    return
  }
  if (b.state >= 2) {
    forgeSweep(w, b, dt)
    return
  }

  // 本体：缓慢压近，到停步距离就站住
  b.ang += dt * 0.22
  if (d > FORGE_HOLD) {
    const spd = [34, 42, 52][ph]
    b.x += (dx / d) * spd * dt
    b.y += (dy / d) * spd * dt
  }

  // 大招优先：熔切 > 震地
  if (ph >= 1 && b.t4 <= 0) {
    startSweep(w, b, dx, dy)
    return
  }
  if (b.t3 <= 0) {
    b.state = 1
    b.stateT = 0.95
    w.addTele('circle', b.x, b.y, 0.95, 'slam', { r: FORGE_ZONE, color: '#ff5a2e', a: 30, b: ph === 2 ? 2 : 1 })
    return
  }

  // 余烬弹幕
  if (b.t1 <= 0) {
    radial(w, b.x, b.y, [10, 14, 16][ph], b.age * 0.9, [150, 160, 170][ph], 13, FORGE_HOT, 0, 'ember')
    b.t1 = [2.5, 2.2, 1.9][ph]
  }

  // 熔渣弹：第一发压在玩家"将要去的地方"，其余散落在周围
  if (b.t2 <= 0) {
    const n = [2, 3, 4][ph]
    for (let i = 0; i < n; i++) {
      const a = w.rng.angle()
      const dist = i === 0 ? 0 : w.rng.range(90, 280)
      const x = p.x + p.vx * 0.5 + Math.cos(a) * dist
      const y = p.y + p.vy * 0.5 + Math.sin(a) * dist
      w.addTele('circle', x, y, 1.15 + i * 0.12, 'blast', { r: 72, color: FORGE_HOT, a: 24, fx: 1, x2: b.x, y2: b.y })
    }
    b.t2 = [3.4, 3.0, 2.7][ph]
  }
}

/** 熔切开始：原地扎根，几条射线先以"预警"状态亮出来（不伤人），并朝即将转动的方向缓缓爬 */
function startSweep(w: World, b: Boss, dx: number, dy: number): void {
  const ph = b.phase
  const n = FORGE_JETS[ph]
  const dir = w.rng.chance(0.5) ? 1 : -1
  b.state = 2
  b.stateT = FORGE_WARN
  // 第一条射线大致对着玩家：逼他立刻挪位
  b.ang = Math.atan2(dy, dx) + w.rng.range(-0.45, 0.45)
  b.spin = dir * FORGE_OMEGA[ph]
  killJets(b)
  for (let i = 0; i < n; i++) {
    const bm = w.addBeam()
    bm.hostile = true
    bm.fixed = true
    bm.ox = b.x
    bm.oy = b.y
    bm.ang = b.ang + (i / n) * TAU
    bm.spin = dir * 0.28
    bm.len = 580
    bm.width = 30
    bm.warn = FORGE_WARN
    // 比扫射时间多留一点：射线由巨像在扫射结束时亲手收掉
    bm.life = bm.maxLife = FORGE_SWEEP[ph] + 0.4
    bm.tick = 0.1
    bm.tickT = 0
    bm.dmg = 20
    bm.color = FORGE_HOT
    bm.style = 'boss'
    b.jets.push(bm)
  }
}

function forgeSweep(w: World, b: Boss, dt: number): void {
  b.stateT -= dt
  if (b.jets.length > 0) b.ang = b.jets[0].ang
  if (b.state === 2) {
    if (b.stateT <= 0) {
      b.state = 3
      b.stateT = FORGE_SWEEP[b.phase]
      for (const j of b.jets) j.spin = b.spin
    }
    return
  }
  if (b.stateT <= 0) {
    killJets(b)
    b.state = 0
    b.t4 = [0, 7.5, 6.2][b.phase]
    // 收招之后不要把攒着的几招一股脑放出来
    b.t1 = Math.max(b.t1, 1.0)
    b.t2 = Math.max(b.t2, 1.8)
    b.t3 = Math.max(b.t3, 2.4)
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
    bm.style = 'boss'
  } else if (tl.action === 'blast') {
    w.addBlast(tl.x, tl.y, tl.r, tl.color, 0.4)
    w.emit({ t: 'blast', x: tl.x, y: tl.y, r: tl.r, color: tl.color })
    // 熔渣团 / 陨火落地会在地上留下焦痕（虚空之喉的坍缩不会）
    if (tl.fx > 0) w.emit({ t: 'scorch', x: tl.x, y: tl.y, r: tl.r })
    const p = w.player
    // 熔渣团算在 Boss 头上，陨火算环境爆炸
    const src = tl.fx === 1 ? (w.boss?.id ?? 'blast') : 'blast'
    if (Math.hypot(p.x - tl.x, p.y - tl.y) < tl.r + p.r) w.hurtPlayer(tl.a || 26, tl.x, tl.y, src)
  } else if (tl.action === 'slam') {
    // 震地：圈内重伤，再从中心震出 1~2 道冲击环（从巨像身边出发，站在圈外的人有时间冲刺）
    w.addBlast(tl.x, tl.y, tl.r, tl.color, 0.5)
    w.emit({ t: 'blast', x: tl.x, y: tl.y, r: tl.r, color: tl.color })
    w.emit({ t: 'scorch', x: tl.x, y: tl.y, r: tl.r * 0.8 })
    const p = w.player
    if (Math.hypot(p.x - tl.x, p.y - tl.y) < tl.r + p.r) w.hurtPlayer(tl.a || 30, tl.x, tl.y, w.boss?.id ?? 'blast')
    const n = tl.b >= 2 ? 2 : 1
    for (let i = 0; i < n; i++) {
      const r = w.addRing()
      r.hostile = true
      r.x = tl.x
      r.y = tl.y
      r.r = 70
      r.maxR = 620
      r.speed = 280
      r.dmg = 22
      r.color = '#ff7a2e'
      r.delay = i * 0.55
    }
  }
}
