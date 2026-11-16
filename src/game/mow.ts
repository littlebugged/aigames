/**
 * 割草手感的"节奏层"：
 *   · 浪涌 SURGE —— 每一波结束前放出的清场冲击波：以飞船为圆心三环接力，扫光场上剩下的杂兵
 *     （特殊兵种、精英和 Boss 不受影响），清掉近处的敌方弹幕。它是一波的句号，之后才弹出本波攒下的升级卡。
 *   · 群杀播报 MULTI —— 0.6 秒内击杀数"突增"时给一次 ×N 的演出；只看突增，所以日常割草不刷屏。
 *
 * 与渲染完全解耦：这里只改 World 的状态、发 GameEvent，演出由 renderer / audio / HUD 各自消费。
 */
import { MULTI, SURGE } from '../data/tuning'
import type { Enemy } from './entities'
import type { World } from './world'

export class Mow {
  // ───────────── 群杀 ─────────────
  private winStart = -99
  private winN = 0
  private winTier = 0
  /** 近期平均击杀速度（个 / 秒，指数平滑） */
  rate = 0
  private frameKills = 0
  private lastTier = 0
  private lastAt = -99

  /** 每一次击杀（不含 Boss 死亡时的全屏清场）都要调用一次 */
  onKill(w: World, _e: Enemy): void {
    this.frameKills++
    const t = w.time
    if (t - this.winStart > MULTI.span) {
      this.winStart = t
      this.winN = 0
      this.winTier = 0
    }
    this.winN++
    if (this.winN > w.stats.bestMulti) w.stats.bestMulti = this.winN
    this.checkMulti(w, t)
  }

  private checkMulti(w: World, t: number): void {
    let tier = 0
    for (let i = 0; i < MULTI.tiers.length; i++) if (this.winN >= MULTI.tiers[i]) tier = i + 1
    if (tier <= this.winTier) return
    // 只看"突增"：窗口内的击杀数要明显高于近期的平均水平
    if (this.winN < this.rate * MULTI.span * MULTI.spike) return
    if (tier <= this.lastTier && t - this.lastAt < MULTI.cooldown) return
    this.winTier = tier
    this.lastTier = tier
    this.lastAt = t
    w.emit({ t: 'multi', n: this.winN, tier })
  }

  update(_w: World, dt: number): void {
    // 平均击杀速度（击杀事件发生在本帧的各个环节，这里统一结算）
    const k = 1 - Math.exp(-dt / MULTI.avgTau)
    this.rate += (this.frameKills / Math.max(dt, 1e-3) - this.rate) * k
    this.frameKills = 0
  }

  /** 浪涌：一波的句号。公开出来是为了测试。 */
  sweep(w: World, wave: number): void {
    const p = w.player
    for (let i = 0; i < SURGE.ringScale.length; i++) {
      const r = w.addRing()
      r.x = p.x
      r.y = p.y
      r.r = 36
      r.maxR = SURGE.radius * SURGE.ringScale[i]
      r.speed = SURGE.speed * (1 - i * 0.05)
      // 只对杂兵生效：伤害给足，保证"扫过就倒"
      r.dmg = 9999
      r.fodder = true
      r.knock = SURGE.knock * (i === 0 ? 1 : 0.5)
      r.color = i === 1 ? '#ffffff' : i === 2 ? '#3df2ff' : '#a9f6ff'
      r.delay = SURGE.ringDelay[i]
      r.wide = i === 0 ? 1.7 : 1.3
      r.quiet = true
    }
    w.addBlast(p.x, p.y, 190, '#bffaff', 0.5)
    // 清掉近处的敌方弹幕（等同于一次小型"炸弹"，让放出的瞬间是安全的）
    const R2 = SURGE.radius * SURGE.radius
    for (const b of w.ebullets) {
      if (!b.alive) continue
      const dx = b.x - p.x
      const dy = b.y - p.y
      if (dx * dx + dy * dy < R2) b.alive = false
    }
    p.invuln = Math.max(p.invuln, SURGE.invuln)
    w.emit({ t: 'surge', x: p.x, y: p.y, r: SURGE.radius, n: wave })
  }
}
