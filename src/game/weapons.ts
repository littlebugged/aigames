import { TAU, angleTo } from '../engine/math'
import type { Enemy, Target, WeaponInst } from './entities'
import type { World } from './world'

/** 所有武器的每帧更新入口。具体行为按武器 id 分发。 */
export function updateWeapons(w: World, dt: number): void {
  const ws = w.player.weapons
  for (let i = 0; i < ws.length; i++) {
    const wi = ws[i]
    switch (wi.id) {
      case 'pulse':
        updatePulse(w, wi, dt)
        break
      case 'orbit':
        updateOrbit(w, wi, dt)
        break
      case 'arc':
        updateArc(w, wi, dt)
        break
      case 'missile':
        updateMissile(w, wi, dt)
        break
      case 'laser':
        updateLaser(w, wi, dt)
        break
      case 'mine':
        updateMine(w, wi, dt)
        break
      case 'nova':
        updateNova(w, wi, dt)
        break
      case 'drone':
        updateDrone(w, wi, dt)
        break
    }
  }
}

/** 复用 wi.pts 里的对象，避免每帧分配 */
function ensurePts(wi: WeaponInst, n: number): void {
  const pts = wi.pts
  while (pts.length < n) pts.push({ x: 0, y: 0, a: 0, r: 0, cd: 0 })
  pts.length = n
}

const idOf = (t: Target): number => (t.isBoss ? -2 : (t as Enemy).id)

// ───────────────────────── 脉冲炮 ─────────────────────────

function updatePulse(w: World, wi: WeaponInst, dt: number): void {
  wi.timer -= dt
  if (wi.timer > 0) return
  const p = w.player
  const s = wi.s
  const t = w.nearestTarget(p.x, p.y, s.range)
  if (!t) {
    wi.timer = 0.08
    wi.pending = 0
    return
  }
  const second = wi.pending > 0
  const base = angleTo(p.x, p.y, t.x, t.y)
  const total = Math.max(1, Math.round(s.count))
  const n = wi.evolved ? (second ? Math.floor(total / 2) : Math.ceil(total / 2)) : total
  const spread = wi.evolved ? 0.11 : 0.13
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * spread
    w.spawnProjectile(p.x + Math.cos(a) * 12, p.y + Math.sin(a) * 12, a, s.speed, {
      damage: s.damage,
      r: s.area,
      pierce: s.pierce,
      life: s.range / s.speed + 0.15,
      kind: wi.evolved ? 'plasma' : 'bolt',
      color: wi.evolved ? '#8cfffb' : '#3df2ff',
      weapon: 'pulse',
      slot: wi.slot,
      knock: 30,
      blast: wi.evolved ? s.blast : 0,
    })
  }
  w.emit({ t: 'shot', w: 'pulse', x: p.x, y: p.y, a: base })
  if (wi.evolved && !second) {
    wi.pending = 1
    wi.timer = 0.11
  } else {
    wi.pending = 0
    wi.timer = s.cooldown
  }
}

// ───────────────────────── 环绕刃 ─────────────────────────

function updateOrbit(w: World, wi: WeaponInst, dt: number): void {
  const p = w.player
  const s = wi.s
  wi.angle += s.speed * dt
  const outer = Math.max(1, Math.round(s.count))
  const inner = wi.evolved ? Math.round(s.chain) : 0
  ensurePts(wi, outer + inner)
  const pts = wi.pts
  for (let i = 0; i < outer; i++) {
    const a = wi.angle + (i * TAU) / outer
    const pt = pts[i]
    pt.x = p.x + Math.cos(a) * s.range
    pt.y = p.y + Math.sin(a) * s.range
    pt.a = a
    pt.r = s.area
  }
  for (let i = 0; i < inner; i++) {
    const a = -wi.angle * 1.2 + (i * TAU) / inner
    const pt = pts[outer + i]
    pt.x = p.x + Math.cos(a) * s.range * 0.56
    pt.y = p.y + Math.sin(a) * s.range * 0.56
    pt.a = a
    pt.r = s.area * 0.82
  }

  const out = w.tmpW
  const boss = w.boss
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]
    out.length = 0
    w.grid.query(pt.x, pt.y, pt.r, out)
    for (let j = 0; j < out.length; j++) {
      const e = out[j]
      if (!e.alive || e.spawnT > 0 || w.time < e.hitAt[wi.slot]) continue
      e.hitAt[wi.slot] = w.time + s.tick
      const dx = e.x - p.x
      const dy = e.y - p.y
      const d = Math.hypot(dx, dy) || 1
      w.damageEnemy(e, s.damage, (dx / d) * s.knock, (dy / d) * s.knock)
    }
    if (boss && boss.alive && w.time >= boss.hitAt[wi.slot]) {
      if (Math.hypot(boss.x - pt.x, boss.y - pt.y) < boss.r + pt.r) {
        boss.hitAt[wi.slot] = w.time + s.tick * 1.4
        w.damageBoss(boss, s.damage)
      }
    }
  }
}

// ───────────────────────── 电弧链 ─────────────────────────

function updateArc(w: World, wi: WeaponInst, dt: number): void {
  wi.timer -= dt
  if (wi.timer > 0) return
  const p = w.player
  const s = wi.s
  const first = w.nearestTarget(p.x, p.y, s.range)
  if (!first) {
    wi.timer = 0.1
    return
  }
  const n = Math.max(1, Math.round(s.count))
  const starts: Target[] = [first]
  if (n > 1) {
    const out = w.tmpW
    out.length = 0
    w.grid.query(p.x, p.y, s.range, out)
    for (let tries = 0; tries < 10 && starts.length < n && out.length > 0; tries++) {
      const c = out[w.rng.int(0, out.length)]
      if (c.alive && c.spawnT <= 0 && !starts.includes(c)) starts.push(c)
    }
  }
  for (const st of starts) chainLightning(w, wi, st)
  w.emit({ t: 'shot', w: 'arc', x: p.x, y: p.y, a: angleTo(p.x, p.y, first.x, first.y) })
  wi.timer = s.cooldown
}

function chainLightning(w: World, wi: WeaponInst, first: Target): void {
  const p = w.player
  const s = wi.s
  const ids: number[] = []
  const pts: number[] = [p.x, p.y]
  let cur: Target = first
  let dmg = s.damage
  const jumps = Math.round(s.chain)
  for (let j = 0; j <= jumps; j++) {
    pts.push(cur.x, cur.y)
    ids.push(idOf(cur))
    w.damageTarget(cur, dmg, 0, 0, wi.evolved ? { stun: s.duration } : undefined)
    dmg *= 0.92
    const cx = cur.x
    const cy = cur.y
    const next = w.grid.nearest(cx, cy, 160, (e) => e.alive && e.spawnT <= 0 && !ids.includes(e.id))
    if (!next) break
    cur = next
  }
  w.addBolt(pts, wi.evolved ? '#fff7b0' : '#ffe66b', 0.22)
}

// ───────────────────────── 追踪导弹 ─────────────────────────

function updateMissile(w: World, wi: WeaponInst, dt: number): void {
  wi.timer -= dt
  if (wi.timer > 0) return
  const p = w.player
  const s = wi.s
  const t = w.nearestTarget(p.x, p.y, s.range)
  if (!t) {
    wi.timer = 0.12
    return
  }
  const n = Math.max(1, Math.round(s.count))
  const base = angleTo(p.x, p.y, t.x, t.y)
  const fan = wi.evolved ? 0.42 : 0.55
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * fan + w.rng.range(-0.1, 0.1)
    w.spawnProjectile(p.x, p.y, a, s.speed, {
      damage: s.damage,
      r: wi.evolved ? 5 : 6,
      pierce: 0,
      life: s.duration,
      kind: 'missile',
      color: wi.evolved ? '#ffc46b' : '#ff9b3d',
      weapon: 'missile',
      slot: wi.slot,
      homing: wi.evolved ? 5.2 : 3.8,
      blast: s.blast,
      cluster: wi.evolved ? 3 : 0,
    })
  }
  w.emit({ t: 'shot', w: 'missile', x: p.x, y: p.y, a: base })
  wi.timer = s.cooldown
}

// ───────────────────────── 棱镜激光 ─────────────────────────

function updateLaser(w: World, wi: WeaponInst, dt: number): void {
  wi.timer -= dt
  if (wi.timer > 0) return
  const p = w.player
  const s = wi.s
  const t = w.nearestTarget(p.x, p.y, 620)
  if (!t) {
    wi.timer = 0.12
    return
  }
  const base = angleTo(p.x, p.y, t.x, t.y)
  const n = Math.max(1, Math.round(s.count))
  for (let i = 0; i < n; i++) {
    const b = w.addBeam()
    b.ang = wi.evolved ? base + (i * TAU) / n : base + (i - (n - 1) / 2) * 0.34
    b.spin = wi.evolved ? 1.35 : 0
    b.len = s.range
    b.width = s.area
    b.life = b.maxLife = s.duration
    b.tick = s.tick
    b.tickT = 0
    b.dmg = s.damage
    b.color = wi.evolved ? '#ffe8a8' : '#c9a0ff'
    b.slot = wi.slot
    b.ox = p.x
    b.oy = p.y
  }
  w.emit({ t: 'shot', w: 'laser', x: p.x, y: p.y, a: base })
  wi.timer = s.cooldown
}

// ───────────────────────── 磁暴地雷 ─────────────────────────

function updateMine(w: World, wi: WeaponInst, dt: number): void {
  wi.timer -= dt
  if (wi.timer > 0) return
  if (w.mines.length >= 18) {
    wi.timer = 0.4
    return
  }
  const p = w.player
  const s = wi.s
  const n = Math.max(1, Math.round(s.count))
  for (let i = 0; i < n; i++) {
    const m = w.addMine()
    m.x = p.x - p.vx * 0.12 + w.rng.range(-26, 26)
    m.y = p.y - p.vy * 0.12 + w.rng.range(-26, 26)
    m.arm = 0.35
    m.life = s.duration
    m.trigger = s.range
    m.dmg = s.damage
    m.blast = s.blast
    m.pull = wi.evolved ? s.chain : 0
  }
  w.emit({ t: 'shot', w: 'mine', x: p.x, y: p.y, a: 0 })
  wi.timer = s.cooldown
}

// ───────────────────────── 冲击波 ─────────────────────────

function updateNova(w: World, wi: WeaponInst, dt: number): void {
  wi.timer -= dt
  if (wi.timer > 0) return
  const p = w.player
  const s = wi.s
  if (!w.nearestTarget(p.x, p.y, s.area * 1.05)) {
    wi.timer = 0.15
    return
  }
  const rings = Math.max(1, Math.round(s.count))
  for (let i = 0; i < rings; i++) {
    const r = w.addRing()
    r.x = p.x
    r.y = p.y
    r.r = 10
    r.maxR = s.area
    r.speed = s.speed
    r.dmg = s.damage
    r.knock = s.knock
    r.slow = wi.evolved ? s.duration : 0
    r.delay = i * 0.3
    r.color = wi.evolved ? '#ffe0a0' : '#e8fbff'
  }
  w.emit({ t: 'shot', w: 'nova', x: p.x, y: p.y, a: 0 })
  wi.timer = s.cooldown
}

// ───────────────────────── 僚机无人机 ─────────────────────────

function updateDrone(w: World, wi: WeaponInst, dt: number): void {
  const p = w.player
  const s = wi.s
  const n = Math.max(1, Math.round(s.count))
  ensurePts(wi, n)
  wi.angle += 1.7 * dt
  for (let i = 0; i < n; i++) {
    const pt = wi.pts[i]
    const a = wi.angle + (i * TAU) / n
    const rad = 56 + Math.sin(w.time * 2.2 + i * 1.7) * 6
    pt.x = p.x + Math.cos(a) * rad
    pt.y = p.y + Math.sin(a) * rad
    pt.a = a
    pt.r = 6
    pt.cd -= dt
    if (pt.cd > 0) continue
    const t = w.nearestTarget(pt.x, pt.y, s.range)
    if (!t) {
      pt.cd = 0.15
      continue
    }
    const ang = angleTo(pt.x, pt.y, t.x, t.y)
    w.spawnProjectile(pt.x, pt.y, ang, s.speed, {
      damage: s.damage,
      r: s.area,
      pierce: s.pierce,
      life: 0.95,
      kind: 'drone',
      color: '#7dffb0',
      weapon: 'drone',
      slot: wi.slot,
      homing: wi.evolved ? 6 : 0,
      knock: 10,
    })
    pt.cd = s.cooldown * (1 + (i % 3) * 0.08)
  }
}
