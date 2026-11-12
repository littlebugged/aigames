import { ENEMIES } from '../data/enemies'
import type { EnemyId } from '../data/ids'
import type { TimedEvent } from '../data/sectors'
import { TAU, clamp01 } from '../engine/math'
import { spawnBoss } from './bosses'
import type { World } from './world'

/**
 * 刷怪导演器：按"预算"放怪，预算随时间增长；
 * 同时在固定时间点触发包围圈、冲锋墙、精英怪，最后在目标时长放出 Boss。
 */
export class Director {
  private budget = 0
  private eventIdx = 0
  private bossSpawned = false

  update(w: World, dt: number): void {
    const sec = w.sector
    const t = w.time
    const demo = !!w.cfg.demo

    if (!demo) {
      if (!this.bossSpawned && t >= sec.length) {
        this.bossSpawned = true
        spawnBoss(w, sec.boss)
      }
      while (this.eventIdx < sec.events.length && sec.events[this.eventIdx].at <= t) {
        this.fire(w, sec.events[this.eventIdx++])
      }
    }

    const m = t / 60
    let rate = (sec.spawn.base + sec.spawn.perMin * m + sec.spawn.accel * m * m) * w.threat.spawn
    if (demo) rate *= 0.5
    rate *= 0.45 + 0.55 * clamp01(t / 90)
    const bossFight = !!(w.boss && w.boss.alive)
    if (bossFight) rate *= 0.22
    // 无尽模式（击败 Boss 之后）持续加压
    if (this.bossSpawned && !(w.boss && w.boss.alive)) rate *= 1 + Math.max(0, t - sec.length) / 120
    if (w.winT >= 0) rate = 0

    this.budget = Math.min(this.budget + rate * dt, 24)
    let guard = 12
    // Boss 战期间场上杂兵保持在可控数量，让战斗焦点留在 Boss 身上
    const cap = bossFight ? 90 : w.maxEnemies
    while (this.budget >= 0.5 && w.enemies.length < cap && guard-- > 0) {
      const id = this.pick(w, t)
      if (!id) break
      const def = ENEMIES[id]
      const pack = id === 'swarmer' ? w.rng.int(3, 6) : id === 'drone' && m > 3 ? w.rng.int(1, 4) : 1
      const cost = def.cost * pack
      if (cost > this.budget + 1.5) break // 太贵就攒一会儿预算再放
      this.budget -= cost
      const c = w.edgePoint()
      for (let i = 0; i < pack; i++) {
        w.spawnEnemy(id, c.x + w.rng.range(-36, 36), c.y + w.rng.range(-36, 36))
      }
    }
  }

  private pick(w: World, t: number): EnemyId | undefined {
    const roster = w.sector.roster
    let total = 0
    for (let i = 0; i < roster.length; i++) {
      const r = roster[i]
      if (t < r.from || (r.to !== undefined && t > r.to)) continue
      total += r.weight * (0.35 + 0.65 * clamp01((t - r.from) / 70))
    }
    if (total <= 0) return undefined
    let x = w.rng.next() * total
    for (let i = 0; i < roster.length; i++) {
      const r = roster[i]
      if (t < r.from || (r.to !== undefined && t > r.to)) continue
      x -= r.weight * (0.35 + 0.65 * clamp01((t - r.from) / 70))
      if (x <= 0) return r.id
    }
    return roster[0].id
  }

  private fire(w: World, ev: TimedEvent): void {
    const p = w.player
    switch (ev.kind) {
      case 'ring': {
        const n = ev.count ?? 16
        const R = w.viewR + 40
        const off = w.rng.angle()
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * TAU
          w.spawnEnemy(ev.enemy ?? 'swarmer', p.x + Math.cos(a) * R, p.y + Math.sin(a) * R, { spawnT: 0.6 })
        }
        w.emit({ t: 'warn', key: 'warn.ring', sev: 1 })
        break
      }
      case 'wall': {
        const n = ev.count ?? 12
        const a = w.rng.angle()
        const R = w.viewR + 50
        const cx = p.x + Math.cos(a) * R
        const cy = p.y + Math.sin(a) * R
        const px = -Math.sin(a)
        const py = Math.cos(a)
        for (let i = 0; i < n; i++) {
          const o = (i - (n - 1) / 2) * 38
          w.spawnEnemy(ev.enemy ?? 'drone', cx + px * o, cy + py * o, { spawnT: 0.5 })
        }
        w.emit({ t: 'warn', key: 'warn.wall', sev: 1 })
        break
      }
      case 'elite': {
        const pt = w.edgePoint()
        w.spawnEnemy(ev.enemy ?? 'brute', pt.x, pt.y, { elite: true, spawnT: 0.8 })
        w.emit({ t: 'warn', key: 'warn.elite', sev: 1 })
        break
      }
      case 'boss-warning':
        w.emit({ t: 'warn', key: 'warn.boss', sev: 2 })
        break
    }
  }
}
