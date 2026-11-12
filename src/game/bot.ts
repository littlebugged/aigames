import { WEAPONS } from '../data/weapons'
import { TAU } from '../engine/math'
import { RNG } from '../engine/rng'
import type { InputState } from './entities'
import type { Offer } from './offers'
import type { World } from './world'

const DIRS = 16
const CX: number[] = []
const CY: number[] = []
for (let i = 0; i < DIRS; i++) {
  CX.push(Math.cos((i / DIRS) * TAU))
  CY.push(Math.sin((i / DIRS) * TAU))
}

/** 相对运动下 [0,T] 内的最近距离：(rx,ry) 为目标相对玩家的位置，(vx,vy) 为相对速度。 */
function closest(rx: number, ry: number, vx: number, vy: number, T: number): number {
  const v2 = vx * vx + vy * vy
  let t = 0
  if (v2 > 1e-6) {
    t = -(rx * vx + ry * vy) / v2
    if (t < 0) t = 0
    else if (t > T) t = T
  }
  const x = rx + vx * t
  const y = ry + vy * t
  return Math.sqrt(x * x + y * y)
}

/** 被动选择优先级（机器人用） */
const PASSIVE_PRIORITY = [
  'power',
  'haste',
  'hull',
  'area',
  'magnet',
  'accel',
  'multi',
  'armor',
  'learning',
  'regen',
  'luck',
  'thruster',
]

/**
 * 自动驾驶机器人。两个用途：
 *  1. 主界面背景的演示对局（看起来像有人在玩）
 *  2. Node 里整局整局地自动跑，验证稳定性并辅助调平衡
 * 它不作弊：只读世界当前状态，和玩家一样看不到未来。
 */
export class Bot {
  private rng: RNG
  private think = 0
  private dx = 0
  private dy = -1
  private lastHp = -1

  constructor(
    seed = 1,
    public skill = 1,
    /** 随机乱选升级卡的概率（模拟新手） */
    public sloppy = 0,
  ) {
    this.rng = new RNG(seed)
  }

  /** 填写本帧输入 */
  drive(w: World, dt: number, out: InputState): void {
    const p = w.player
    out.dash = false
    this.think -= dt
    if (this.lastHp < 0) this.lastHp = p.hp

    if (this.think <= 0) {
      this.think = 0.08 / Math.max(0.5, this.skill)
      this.decide(w)
    }
    out.mx = this.dx
    out.my = this.dy

    // 受伤或被围住时冲刺脱离
    const hurt = p.hp < this.lastHp - 0.5
    this.lastHp = p.hp
    if (p.dashCd <= 0 && p.dashT <= 0) {
      if (hurt || this.crowded(w, 52) >= 4) out.dash = true
      // 敌方冲击环：在它扫到身上前一瞬间冲刺穿过（无敌帧）
      const window = 18 + 40 * Math.min(1, this.skill)
      for (const rg of w.rings) {
        if (!rg.hostile || rg.hitPlayer) continue
        const gap = Math.hypot(p.x - rg.x, p.y - rg.y) - rg.r
        if (gap > -4 && gap < window) out.dash = true
      }
    }
  }

  private crowded(w: World, r: number): number {
    const p = w.player
    const out = w.tmpW
    out.length = 0
    w.grid.query(p.x, p.y, r, out)
    return out.length
  }

  private decide(w: World): void {
    const p = w.player
    const reach = p.st.speed * 0.5
    const near = w.tmpW
    near.length = 0
    w.grid.query(p.x, p.y, 330, near)

    // 想去的目标：晶体价值/距离最优；宝箱和需要的治疗优先
    let gx = 0
    let gy = 0
    let gScore = 0
    let gDist = 1
    for (let i = 0; i < w.gems.length; i++) {
      const g = w.gems[i]
      const d = Math.hypot(g.x - p.x, g.y - p.y)
      if (d > 700) continue
      const sc = (1 + g.tier * 0.8) / (d + 80)
      if (sc > gScore) {
        gScore = sc
        gx = g.x
        gy = g.y
        gDist = d
      }
    }
    for (let i = 0; i < w.pickups.length; i++) {
      const k = w.pickups[i]
      if (k.kind === 'bomb') continue
      const d = Math.hypot(k.x - p.x, k.y - p.y)
      const val = k.kind === 'chest' ? 6 : k.kind === 'heal' ? (p.hp < p.maxHp * 0.7 ? 6 : 0.5) : 2
      const sc = val / (d + 80)
      if (sc > gScore) {
        gScore = sc
        gx = k.x
        gy = k.y
        gDist = d
      }
    }
    const hasGoal = gScore > 0
    const toGoal = hasGoal ? Math.atan2(gy - p.y, gx - p.x) : 0
    // 血少时更保守
    const greed = p.hp > p.maxHp * 0.5 ? 2.6 : 1.2

    let bestScore = -1e9
    let bi = 0
    const cur = Math.atan2(this.dy, this.dx)
    for (let i = 0; i < DIRS; i++) {
      const px = p.x + CX[i] * reach
      const py = p.y + CY[i] * reach
      let s = 0

      // 小怪：沿候选方向走 0.6s 内，会不会和它的轨迹擦上
      const pvx = CX[i] * p.st.speed
      const pvy = CY[i] * p.st.speed
      for (let k = 0; k < near.length; k++) {
        const e = near[k]
        const ex = e.x - p.x
        const ey = e.y - p.y
        const dEdge = closest(ex, ey, e.vx - pvx, e.vy - pvy, 0.6) - e.r - p.r
        if (dEdge < 8) s -= 2.4 + e.dmg * 0.08
        else if (dEdge < 60) s -= (1 - dEdge / 60) * (0.9 + e.dmg * 0.04)
        if (e.def.ai === 'bomber' && e.state === 1 && dEdge < 100) s -= 4
        if (e.def.ai === 'charger' && e.state === 1) {
          // 躲开冲锋线
          const lx = e.ay
          const ly = -e.ax
          const side = Math.abs((px - e.x) * lx + (py - e.y) * ly)
          const along = (px - e.x) * e.ax + (py - e.y) * e.ay
          if (along > 0 && along < 480 && side < 50) s -= 3
        }
      }
      for (let k = 0; k < w.ebullets.length; k++) {
        const bl = w.ebullets[k]
        const bx = bl.x - p.x
        const by = bl.y - p.y
        if (bx * bx + by * by > 520 * 520) continue
        const d = closest(bx, by, bl.vx - pvx, bl.vy - pvy, 0.9) - bl.r - p.r
        if (d < 36) s -= (1 - Math.max(0, d) / 36) * 6
      }
      const boss = w.boss
      if (boss && boss.alive) {
        const bd = Math.hypot(boss.x - px, boss.y - py) - boss.r - p.r
        if (bd < 140) s -= (1 - Math.max(0, bd) / 140) * 4
        for (const o of boss.orbs) {
          const od = Math.hypot(o.x - px, o.y - py) - o.r - p.r
          if (od < 60) s -= (1 - Math.max(0, od) / 60) * 5
        }
        // 与 Boss 保持中距离（引力型 Boss 要拉开）
        const ideal = 330
        s -= Math.abs(Math.hypot(boss.x - px, boss.y - py) - ideal) * 0.0025
      }
      for (const tl of w.teles) {
        if (tl.kind === 'circle') {
          if (Math.hypot(tl.x - px, tl.y - py) < tl.r + 36) s -= 6
        } else {
          const lx = tl.x2 - tl.x
          const ly = tl.y2 - tl.y
          const len = Math.hypot(lx, ly) || 1
          const dist = Math.abs((px - tl.x) * ly - (py - tl.y) * lx) / len
          if (dist < tl.r + 44) s -= 5
        }
      }
      for (const bm of w.beams) {
        if (!bm.hostile) continue
        const dist = Math.abs((px - bm.ox) * Math.sin(bm.ang) - (py - bm.oy) * Math.cos(bm.ang))
        if (dist < bm.width / 2 + 40) s -= 6
      }
      for (const rg of w.rings) {
        if (!rg.hostile) continue
        const d = Math.abs(Math.hypot(px - rg.x, py - rg.y) - rg.r)
        if (d < 40) s -= 3
      }

      if (hasGoal) {
        const dd = Math.abs(((toGoal - (i / DIRS) * TAU + Math.PI * 3) % TAU) - Math.PI)
        const closeBonus = gDist < 160 ? 1.3 : 1
        s += (1 - dd / Math.PI) * greed * closeBonus
      }
      const dd2 = Math.abs(((cur - (i / DIRS) * TAU + Math.PI * 3) % TAU) - Math.PI)
      s += (1 - dd2 / Math.PI) * 0.3
      s += this.rng.next() * 0.05

      if (s > bestScore) {
        bestScore = s
        bi = i
      }
    }
    this.dx = CX[bi]
    this.dy = CY[bi]
  }

  /**
   * 选升级卡：进化 > 进化配对被动 > 聚焦已高级的武器 > 前 4 把新武器 > 其它。
   * 这样机器人会像有经验的玩家一样"练专精"，也能把进化流程真正测到。
   */
  pick(w: World): number {
    const offers = w.offers
    let best = 0
    let bestScore = -1
    if (this.sloppy > 0 && this.rng.next() < this.sloppy) return this.rng.int(0, offers.length)
    for (let i = 0; i < offers.length; i++) {
      const s = this.score(w, offers[i]) + this.rng.next() * 0.5
      if (s > bestScore) {
        bestScore = s
        best = i
      }
    }
    return best
  }

  private score(w: World, o: Offer): number {
    const p = w.player
    switch (o.kind) {
      case 'weapon': {
        if (o.evolve) return 100
        if (o.isNew) return p.weapons.length < 4 ? 8 : 3
        // 越高级越值得继续练
        return 5 + o.to * 0.7
      }
      case 'passive': {
        // 有武器 ≥5 级时，它的进化配对被动最重要
        for (const wi of p.weapons) {
          if (!wi.evolved && wi.level >= 5 && WEAPONS[wi.id].evolvesWith === o.id && o.isNew) return 30
        }
        return 4.5 - PASSIVE_PRIORITY.indexOf(o.id) * 0.2
      }
      case 'heal':
        return p.hp / p.maxHp < 0.5 ? 7 : 1
      default:
        return 0.5
    }
  }
}
