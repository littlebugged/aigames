/**
 * 割草手感的"节奏层"：
 *   · 浪涌 SURGE —— 击杀充能；满了之后在敌群够密时自动释放一道以飞船为圆心的清场冲击波
 *     （三环接力 + 清掉近处的敌方弹幕 + 之后把全图的经验石吸回来）。
 *   · 群杀播报 MULTI —— 0.6 秒内击杀数"突增"时给一次 ×N 的演出；只看突增，所以日常割草不刷屏。
 *
 * 与渲染完全解耦：这里只改 World 的状态、发 GameEvent，演出由 renderer / audio / HUD 各自消费。
 */
import { MULTI, SURGE } from '../data/tuning'
import type { Enemy } from './entities'
import type { World } from './world'

export class Mow {
  // ───────────── 浪涌 ─────────────
  /** 充能 0~1（HUD 读它） */
  charge = 0
  /** 本局已释放的次数 */
  count = 0
  /** 距离下一次可以释放还要多久（秒） */
  gap = 0
  /** 满能量之后已经等了多久（秒） */
  waiting = 0
  /** 释放之后的宝石回收倒计时（秒；< 0 表示没有在等） */
  private vac = -1

  // ───────────── 群杀 ─────────────
  private winStart = -99
  private winN = 0
  private winTier = 0
  /** 近期平均击杀速度（个 / 秒，指数平滑） */
  rate = 0
  private frameKills = 0
  private lastTier = 0
  private lastAt = -99

  /** 当前这一档充能需要的击杀数 */
  need(): number {
    return Math.min(SURGE.needMax, SURGE.need0 + SURGE.needStep * this.count)
  }

  get ready(): boolean {
    return this.charge >= 1
  }

  /** 每一次击杀（不含 Boss 死亡时的全屏清场）都要调用一次 */
  onKill(w: World, e: Enemy): void {
    this.frameKills++
    if (this.charge < 1) this.charge = Math.min(1, this.charge + (e.elite ? SURGE.eliteWeight : 1) / this.need())

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

  update(w: World, dt: number): void {
    // 平均击杀速度（击杀事件发生在本帧的各个环节，这里统一结算）
    const k = 1 - Math.exp(-dt / MULTI.avgTau)
    this.rate += (this.frameKills / Math.max(dt, 1e-3) - this.rate) * k
    this.frameKills = 0

    if (this.gap > 0) this.gap -= dt
    if (this.vac >= 0) {
      this.vac -= dt
      if (this.vac < 0) this.vacuum(w)
    }
    if (w.cfg.demo || w.phase !== 'play' || this.charge < 1 || this.gap > 0) return
    this.waiting += dt
    if (this.dense(w)) this.fire(w)
  }

  /** 是否到了该放的时候：敌群够密 / Boss 在范围内 / 等得够久而且至少还有几只 */
  private dense(w: World): boolean {
    const p = w.player
    const R = SURGE.nearR
    const b = w.boss
    if (b && b.alive && b.intro <= 0 && Math.hypot(b.x - p.x, b.y - p.y) < R + b.r) return true
    const need = this.waiting >= SURGE.patience ? 3 : SURGE.nearCount
    let n = 0
    const E = w.enemies
    for (let i = 0; i < E.length; i++) {
      const e = E[i]
      if (!e.alive || e.spawnT > 0) continue
      const dx = e.x - p.x
      const dy = e.y - p.y
      if (dx * dx + dy * dy < R * R && ++n >= need) return true
    }
    return false
  }

  /** 释放。公开出来是为了测试（也方便以后加"手动释放"）。 */
  fire(w: World): void {
    const p = w.player
    const dmg = (SURGE.base + SURGE.perLevel * p.level) * p.st.dmg
    for (let i = 0; i < SURGE.ringMul.length; i++) {
      const r = w.addRing()
      r.x = p.x
      r.y = p.y
      r.r = 36
      r.maxR = SURGE.radius * SURGE.ringScale[i]
      r.speed = SURGE.speed * (1 - i * 0.05)
      r.dmg = dmg * SURGE.ringMul[i]
      r.knock = SURGE.knock * (i === 0 ? 1 : 0.5)
      r.color = i === 1 ? '#ffffff' : i === 2 ? '#3df2ff' : '#a9f6ff'
      r.delay = SURGE.ringDelay[i]
      r.wide = i === 0 ? 1.7 : 1.3
      r.quiet = true
    }
    w.addBlast(p.x, p.y, 190, '#bffaff', 0.5)
    // 清掉近处的敌方弹幕（等同于一次小型"炸弹"，让释放瞬间是安全的）
    const R2 = SURGE.radius * SURGE.radius
    for (const b of w.ebullets) {
      if (!b.alive) continue
      const dx = b.x - p.x
      const dy = b.y - p.y
      if (dx * dx + dy * dy < R2) b.alive = false
    }
    p.invuln = Math.max(p.invuln, SURGE.invuln)
    this.count++
    this.charge = 0
    this.gap = SURGE.minGap
    this.waiting = 0
    this.vac = SURGE.vacuumAfter
    w.stats.surges++
    w.emit({ t: 'surge', x: p.x, y: p.y, r: SURGE.radius, n: this.count })
  }

  /** 释放之后：整张地图上的经验石都飞回来（击杀掉的那一大片，不用再追着捡） */
  private vacuum(w: World): void {
    for (const g of w.gems) if (g.alive) g.mag = true
  }
}
