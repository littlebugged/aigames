import { RAIL_SCAR_RATIO, SIPHON_REGEN_BOOST, SIPHON_SPLASH_RATIO } from '../data/weapons'
import { TAU, angleTo, clamp } from '../engine/math'
import { newPt, type Boss, type Enemy, type Target, type WeaponInst } from './entities'
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
      case 'chakram':
        updateChakram(w, wi, dt)
        break
      case 'rail':
        updateRail(w, wi, dt)
        break
      case 'howitzer':
        updateHowitzer(w, wi, dt)
        break
      case 'siphon':
        updateSiphon(w, wi, dt)
        break
    }
  }
}

/** 复用 wi.pts 里的对象，避免每帧分配 */
function ensurePts(wi: WeaponInst, n: number): void {
  const pts = wi.pts
  while (pts.length < n) pts.push(newPt())
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
  w.emit({ t: 'shot', w: 'pulse', x: p.x, y: p.y, a: base, evo: wi.evolved })
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
  w.emit({ t: 'shot', w: 'arc', x: p.x, y: p.y, a: angleTo(p.x, p.y, first.x, first.y), evo: wi.evolved })
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
  w.emit({ t: 'shot', w: 'missile', x: p.x, y: p.y, a: base, evo: wi.evolved })
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
  w.emit({ t: 'shot', w: 'laser', x: p.x, y: p.y, a: base, evo: wi.evolved })
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
  w.emit({ t: 'shot', w: 'mine', x: p.x, y: p.y, a: 0, evo: wi.evolved })
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
  w.emit({ t: 'shot', w: 'nova', x: p.x, y: p.y, a: 0, evo: wi.evolved })
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

// ───────────────────────── 回旋飞轮 ─────────────────────────

/** 同时在外的飞轮上限（极限攻速下也不会无限堆积） */
const CHAKRAM_MAX_LIVE = 14

function updateChakram(w: World, wi: WeaponInst, dt: number): void {
  const p = w.player
  const s = wi.s
  const pts = wi.pts

  // 1) 掷出：朝最近的目标扇形甩出 count 枚
  wi.timer -= dt
  if (wi.timer <= 0) {
    const n = Math.max(1, Math.round(s.count))
    // 只在"够得着"时才出手：Boss 优先，但它离得太远就别白扔了，先清近处的小怪
    const t = pts.length + n <= CHAKRAM_MAX_LIVE ? w.nearestTarget(p.x, p.y, s.range + 40) : undefined
    if (!t) {
      wi.timer = 0.1
    } else {
      const base = angleTo(p.x, p.y, t.x, t.y)
      // 打 Boss 时并成一束（间距≈Boss 半径的 0.6），保证每一枚都打得中；打杂兵时展开成宽扇面
      const fan = t.isBoss ? Math.atan2(t.r * 0.6, Math.hypot(t.x - p.x, t.y - p.y) || 1) : wi.evolved ? 0.4 : 0.46
      const flip = w.rng.next() < 0.5 ? 1 : -1
      for (let i = 0; i < n; i++) {
        // 第一枚正对目标，其余依次交替排在两侧：0, +1, -1, +2, -2 …（偶数枚也不会错过最近的敌人）
        const k = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2)
        const a = base + k * fan * flip
        const pt = newPt()
        pt.x = p.x
        pt.y = p.y
        pt.a = w.rng.angle()
        pt.r = s.area
        pt.vx = Math.cos(a)
        pt.vy = Math.sin(a)
        pts.push(pt)
      }
      w.emit({ t: 'shot', w: 'chakram', x: p.x, y: p.y, a: base, evo: wi.evolved })
      wi.timer = s.cooldown
    }
  }

  // 2) 飞行 + 命中。倒序遍历，飞回机身的就地换尾删除。
  const out = w.tmpW
  const boss = w.boss
  const spin = wi.evolved ? 20 : 15
  for (let i = pts.length - 1; i >= 0; i--) {
    const pt = pts[i]
    pt.a += spin * dt
    pt.r = s.area
    let home = false
    if (pt.ph === 0) {
      // 去程：越接近尽头越慢，像回旋镖那样"减速—掉头"
      const rem = Math.max(0, 1 - pt.d / s.range)
      const step = s.speed * (0.32 + 0.68 * Math.sqrt(rem)) * dt
      pt.x += pt.vx * step
      pt.y += pt.vy * step
      pt.d += step
      if (pt.d >= s.range) {
        pt.ph = 1
        pt.d = 0
        pt.hit.length = 0 // 回程重新算：每个敌人去程砍一次、回程再砍一次
        if (wi.evolved && s.blast > 0) {
          const r = w.addRing()
          r.x = pt.x
          r.y = pt.y
          r.r = 8
          r.maxR = s.blast
          r.speed = 460
          r.dmg = s.damage * 0.8
          r.knock = 110
          r.color = '#ffd2f6'
        }
      }
    } else {
      // 回程：朝机身越飞越快，所以一定会回来
      pt.d += dt
      const dx = p.x - pt.x
      const dy = p.y - pt.y
      const dist = Math.hypot(dx, dy) || 1
      const step = Math.min(s.speed * 2.1, s.speed * 0.5 + pt.d * s.speed * 3.2) * dt
      if (dist <= step + 16) {
        home = true
      } else {
        pt.x += (dx / dist) * step
        pt.y += (dy / dist) * step
      }
    }

    // 命中：每枚飞轮每个阶段（去程 / 回程）对每个敌人只结算一次，枚数多了就是实打实的多次命中
    out.length = 0
    w.grid.query(pt.x, pt.y, pt.r, out)
    for (let j = 0; j < out.length; j++) {
      const e = out[j]
      if (!e.alive || e.spawnT > 0 || pt.hit.includes(e.id)) continue
      pt.hit.push(e.id)
      const dx = e.x - pt.x
      const dy = e.y - pt.y
      const d = Math.hypot(dx, dy) || 1
      w.damageEnemy(e, s.damage, (dx / d) * s.knock, (dy / d) * s.knock)
    }
    if (boss && boss.alive && !pt.hit.includes(-2) && Math.hypot(boss.x - pt.x, boss.y - pt.y) < boss.r + pt.r) {
      pt.hit.push(-2)
      w.damageBoss(boss, s.damage)
    }

    if (home) {
      pts[i] = pts[pts.length - 1]
      pts.pop()
    }
  }
}

// ───────────────────────── 磁轨炮 ─────────────────────────

/** 取射程内血量最厚的 k 个目标；Boss 在射程内时永远排第一。 */
function heaviest(w: World, x: number, y: number, range: number, k: number): Target[] {
  const res: Target[] = []
  const b = w.boss
  if (b && b.alive && b.intro <= 0 && Math.hypot(b.x - x, b.y - y) - b.r < range) res.push(b)
  const room = k - res.length
  if (room <= 0) return res
  const out = w.tmpW
  out.length = 0
  w.grid.query(x, y, range, out)
  const best: Enemy[] = []
  for (let i = 0; i < out.length; i++) {
    const e = out[i]
    if (!e.alive || e.spawnT > 0) continue
    if (best.length < room) {
      best.push(e)
      best.sort((a, c) => c.hp - a.hp)
    } else if (e.hp > best[best.length - 1].hp) {
      best[best.length - 1] = e
      best.sort((a, c) => c.hp - a.hp)
    }
  }
  for (const e of best) res.push(e)
  return res
}

/** 主炮光轨的可见时长（秒）。伤害在出膛的第一帧就结算完了，这段只是余辉。 */
const RAIL_FLASH = 0.32

function updateRail(w: World, wi: WeaponInst, dt: number): void {
  wi.timer -= dt
  if (wi.timer > 0) return
  const p = w.player
  const s = wi.s
  const n = Math.max(1, Math.round(s.count))
  // 只打屏幕里看得见的目标，光轨本身依然射满全程
  const picks = heaviest(w, p.x, p.y, Math.min(s.range, w.viewR * 1.1), n)
  if (picks.length === 0) {
    wi.timer = 0.12
    return
  }
  for (let i = 0; i < n; i++) {
    const t = picks[i % picks.length]
    let ang = angleTo(p.x, p.y, t.x, t.y)
    // 目标比光轨少时，多出来的光轨叠在同一个目标身上：在它体内左右错开一点，
    // 看上去是几道并排的轨，又保证每一道都打得中。
    const lap = Math.floor(i / picks.length)
    if (lap > 0) {
      const off = (lap % 2 === 1 ? 1 : -1) * Math.ceil(lap / 2) * Math.min(t.r * 0.5, 14)
      ang += Math.atan2(off, Math.hypot(t.x - p.x, t.y - p.y) || 1)
    }
    fireRail(w, wi, ang)
  }
  wi.timer = s.cooldown
}

function fireRail(w: World, wi: WeaponInst, ang: number): void {
  const p = w.player
  const s = wi.s
  const ox = p.x + Math.cos(ang) * 14
  const oy = p.y + Math.sin(ang) * 14

  // 主炮：瞬发一跳，贯穿全程
  const b = w.addBeam()
  b.fixed = true
  b.punch = true
  b.style = 'rail'
  b.ox = ox
  b.oy = oy
  b.ang = ang
  b.len = s.range
  b.width = s.area
  b.life = b.maxLife = RAIL_FLASH
  b.tick = 99
  b.dmg = s.damage
  b.color = wi.evolved ? '#ff8aa0' : '#ff4d6d'
  b.slot = wi.slot

  // 进化：光轨在原地留下一道持续灼烧的等离子痕
  if (wi.evolved) {
    const sc = w.addBeam()
    sc.fixed = true
    sc.style = 'scar'
    sc.ox = ox
    sc.oy = oy
    sc.ang = ang
    sc.len = s.range
    sc.width = s.area * 0.5
    sc.life = sc.maxLife = s.duration
    sc.tick = s.tick
    sc.dmg = s.damage * RAIL_SCAR_RATIO
    sc.color = '#ffb3c1'
    sc.slot = wi.slot
  }
  w.emit({ t: 'shot', w: 'rail', x: ox, y: oy, a: ang, evo: wi.evolved })
}

// ───────────────────────── 榴弹炮 ─────────────────────────

/** 同一轮齐射里相邻两发炮弹的间隔（秒）：错开发射，听起来是"咚、咚、咚"而不是一声 */
const HOWITZER_GAP = 0.16
const HOWITZER_GAP_EVO = 0.1
/** 选靶时最多抽查多少个候选（人潮里 300 个敌人不必全算一遍） */
const HOWITZER_SAMPLES = 24
/** 炮弹的飞行时间下限 / 上限（秒） */
const SHELL_MIN_T = 0.5
const SHELL_MAX_T = 1.25

interface Aim {
  target: Target
  ox: number
  oy: number
}

const candBuf: Enemy[] = []
const candScore: number[] = []
const candCx: number[] = []
const candCy: number[] = []
const neiBuf: Enemy[] = []

/**
 * 选一个落点。
 *  · Boss 在射程内：只打 Boss（和别的武器一样，Boss 一旦进入射程就是第一优先），多发炮弹绕着它的中心错开；
 *  · 否则：抽查若干敌人，谁身边 blast 半径内的敌人最多（血厚的、精英略加分）谁当锚点，
 *    落点再向人群的重心挪过去；已经有炮弹在飞往的那一团会被避开，所以一轮齐射会分头砸向不同的人堆。
 * 没有可打的目标时返回 null。
 */
function howitzerAim(w: World, wi: WeaponInst): Aim | null {
  const p = w.player
  const s = wi.s
  const range = Math.min(s.range, w.viewR * 0.95)
  wi.angle += 2.39996 // 黄金角：同一个 Boss 上的连续几发，偏移方向依次错开

  const boss = w.boss
  if (boss && boss.alive && boss.intro <= 0 && Math.hypot(boss.x - p.x, boss.y - p.y) - boss.r < range) {
    const d = boss.r * 0.45
    return { target: boss, ox: Math.cos(wi.angle) * d, oy: Math.sin(wi.angle) * d }
  }

  const all = w.tmpW
  all.length = 0
  w.grid.query(p.x, p.y, range, all)
  candBuf.length = 0
  for (let i = 0; i < all.length; i++) if (all[i].alive && all[i].spawnT <= 0) candBuf.push(all[i])
  if (candBuf.length === 0) return null
  // 候选太多时随机抽 HOWITZER_SAMPLES 个（局部洗牌）
  const n = Math.min(candBuf.length, HOWITZER_SAMPLES)
  for (let i = 0; i < n; i++) {
    const j = i + w.rng.int(0, candBuf.length - i)
    const tmp = candBuf[i]
    candBuf[i] = candBuf[j]
    candBuf[j] = tmp
  }

  const R = s.blast
  let best = -1
  let bestScore = -1
  let bestUncovered = -1
  let bestUncoveredScore = -1
  for (let i = 0; i < n; i++) {
    const e = candBuf[i]
    neiBuf.length = 0
    w.grid.query(e.x, e.y, R, neiBuf)
    let cnt = 0
    let sx = 0
    let sy = 0
    for (let k = 0; k < neiBuf.length; k++) {
      const m = neiBuf[k]
      if (!m.alive || m.spawnT > 0) continue
      cnt++
      sx += m.x
      sy += m.y
    }
    const score = cnt + e.hp * 0.002 + (e.elite ? 0.8 : 0)
    candScore[i] = score
    candCx[i] = cnt > 0 ? sx / cnt : e.x
    candCy[i] = cnt > 0 ? sy / cnt : e.y
    if (score > bestScore) {
      bestScore = score
      best = i
    }
    // 已经有炮弹飞向这一团了就别再叠一发
    let covered = false
    for (const sh of w.shells) {
      if (sh.alive && Math.hypot(sh.x - candCx[i], sh.y - candCy[i]) < R * 1.1) {
        covered = true
        break
      }
    }
    if (!covered && score > bestUncoveredScore) {
      bestUncoveredScore = score
      bestUncovered = i
    }
  }
  const pick = bestUncovered >= 0 ? bestUncovered : best
  const e = candBuf[pick]
  // 落点向人群重心靠拢（最多偏出 0.6 个爆炸半径）；全被盖住时再随机晃一点，免得叠成一个点
  let ox = (candCx[pick] - e.x) * 0.85
  let oy = (candCy[pick] - e.y) * 0.85
  if (bestUncovered < 0) {
    const a = w.rng.angle()
    const d = w.rng.range(0.1, 0.5) * R
    ox += Math.cos(a) * d
    oy += Math.sin(a) * d
  }
  const len = Math.hypot(ox, oy)
  const cap = R * 0.6
  if (len > cap) {
    ox *= cap / len
    oy *= cap / len
  }
  return { target: e, ox, oy }
}

function updateHowitzer(w: World, wi: WeaponInst, dt: number): void {
  wi.timer -= dt
  if (wi.timer > 0) return
  const p = w.player
  const s = wi.s
  const aim = howitzerAim(w, wi)
  if (!aim) {
    // 没有目标：不起新的一轮；一轮打到一半目标没了，就把剩下的炮弹留到下次
    wi.timer = 0.15
    return
  }
  if (wi.pending <= 0) wi.pending = Math.max(1, Math.round(s.count))

  const t = aim.target
  const tx = t.x + aim.ox
  const ty = t.y + aim.oy
  const dist = Math.hypot(tx - p.x, ty - p.y)
  const sh = w.addShell()
  sh.x0 = p.x + Math.cos(p.face) * 10
  sh.y0 = p.y + Math.sin(p.face) * 10
  sh.x = tx
  sh.y = ty
  sh.T = clamp(dist / s.speed, SHELL_MIN_T, SHELL_MAX_T)
  sh.dmg = s.damage
  sh.blast = s.blast
  sh.knock = s.knock
  sh.cluster = wi.evolved ? Math.round(s.chain) : 0
  sh.color = wi.evolved ? '#e6ff9a' : '#b8f03a'
  sh.evolved = wi.evolved
  sh.target = t
  sh.targetId = t.isBoss ? -2 : (t as Enemy).id
  sh.ox = aim.ox
  sh.oy = aim.oy
  w.emit({ t: 'shot', w: 'howitzer', x: p.x, y: p.y, a: angleTo(p.x, p.y, tx, ty), evo: wi.evolved })

  wi.pending--
  wi.timer = wi.pending > 0 ? (wi.evolved ? HOWITZER_GAP_EVO : HOWITZER_GAP) : s.cooldown
}

// ───────────────────────── 虹吸索 ─────────────────────────

/** 补索的间隔（秒）：每隔这么久才找一次新的目标，断开之后不会"秒接" */
const SIPHON_ACQUIRE = 0.12
/** 目标跑出射程多远才断开（射程的倍数）：给一点滞回，边缘的敌人不会一会儿连上一会儿断开 */
const SIPHON_HOLD = 1.18

const tetheredBy = (pts: WeaponInst['pts'], e: Enemy): boolean => {
  for (let i = 0; i < pts.length; i++) if (pts[i].tgt === e && pts[i].tgtId === e.id) return true
  return false
}

function updateSiphon(w: World, wi: WeaponInst, dt: number): void {
  const p = w.player
  const s = wi.s
  const pts = wi.pts
  const want = Math.max(1, Math.round(s.count))
  const hold = s.range * SIPHON_HOLD

  // 1) 维护：目标没了 / 跑远了就断开（倒序遍历，就地换尾删除）
  for (let i = pts.length - 1; i >= 0; i--) {
    const pt = pts[i]
    const t = pt.tgt
    const ok =
      t !== null &&
      t.alive &&
      (t.isBoss ? (t as Boss).intro <= 0 : (t as Enemy).id === pt.tgtId && (t as Enemy).spawnT <= 0) &&
      Math.hypot(t.x - p.x, t.y - p.y) - t.r <= hold
    if (!ok) {
      pts[i] = pts[pts.length - 1]
      pts.pop()
    }
  }

  // 2) 补索：Boss 优先（最多占一半的索，剩下的留给小怪），其余扣最近的、还没被扣住的敌人
  wi.timer -= dt
  if (pts.length < want && wi.timer <= 0) {
    wi.timer = SIPHON_ACQUIRE
    let linked = 0
    let toward = 0
    const boss = w.boss
    const bossCap = Math.max(1, Math.ceil(want / 2))
    while (pts.length < want) {
      let t: Target | undefined
      if (boss && boss.alive && boss.intro <= 0 && Math.hypot(boss.x - p.x, boss.y - p.y) - boss.r < s.range) {
        let held = 0
        for (let i = 0; i < pts.length; i++) if (pts[i].tgt === boss) held++
        if (held < bossCap) t = boss
      }
      if (!t) t = w.grid.nearest(p.x, p.y, s.range, (e) => e.alive && e.spawnT <= 0 && !tetheredBy(pts, e))
      if (!t) break
      const pt = newPt()
      pt.tgt = t
      pt.tgtId = t.isBoss ? -2 : (t as Enemy).id
      pt.x = t.x
      pt.y = t.y
      pt.r = t.r
      pt.cd = w.rng.range(0.02, s.tick) // 各根索的"跳"错开，伤害数字不会同时蹦出来
      pt.a = w.rng.angle() // 绘制用的相位
      pts.push(pt)
      toward = angleTo(p.x, p.y, t.x, t.y)
      linked++
    }
    if (linked > 0) w.emit({ t: 'shot', w: 'siphon', x: p.x, y: p.y, a: toward, evo: wi.evolved })
  }

  // 3) 汲取：每一跳打一下，回一口血
  const boost = 1 + p.st.regen * SIPHON_REGEN_BOOST
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]
    const t = pt.tgt as Target
    pt.x = t.x
    pt.y = t.y
    pt.r = t.r
    pt.d += dt
    pt.cd -= dt
    if (pt.cd > 0) continue
    pt.cd = pt.cd < -s.tick ? s.tick : pt.cd + s.tick
    const hp0 = t.hp
    w.damageTarget(t, s.damage, 0, 0)
    const dealt = hp0 - Math.max(0, t.hp)
    if (dealt > 0 && p.hp > 0 && p.hp < p.maxHp) {
      const add = Math.min(s.heal * boost, p.maxHp - p.hp)
      p.hp += add
      wi.pending += add
    }
    // 进化：电击会溅到目标周围的其他敌人身上（不再回血，免得人潮里回血失控）
    if (wi.evolved && s.blast > 0) {
      const out = w.tmpW
      out.length = 0
      w.grid.query(t.x, t.y, s.blast, out)
      let arced = false
      for (let k = 0; k < out.length; k++) {
        const e = out[k]
        if (e === t || !e.alive || e.spawnT > 0) continue
        w.damageEnemy(e, s.damage * SIPHON_SPLASH_RATIO, 0, 0)
        // 每一跳只画一道电弧（给第一个被溅到的），不然七根索一起跳会糊成一片
        if (!arced) {
          w.addBolt([t.x, t.y, e.x, e.y], '#e0c4ff', 0.12)
          arced = true
        }
      }
      const b = w.boss
      if (b && b.alive && b !== t && Math.hypot(b.x - t.x, b.y - t.y) < s.blast + b.r) w.damageBoss(b, s.damage * SIPHON_SPLASH_RATIO)
    }
  }

  // 4) 回血汇总：攒够 1 点才冒一个"+N"，最快每 0.6 秒一次
  wi.angle -= dt
  if (wi.angle <= 0 && wi.pending >= 1) {
    const n = Math.floor(wi.pending)
    wi.pending -= n
    wi.angle = 0.6
    w.emit({ t: 'heal', x: p.x, y: p.y, n })
  }
}
