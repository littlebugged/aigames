import { ENEMIES } from '../data/enemies'
import type { EnemyId } from '../data/ids'
import { SURGE, TUNE } from '../data/tuning'
import { FLOW, WAVE, waveUnit, type MiniPlan, type PulseDef, type SquadDef, type WaveDef } from '../data/waves'
import { TAU, clamp } from '../engine/math'
import { spawnBoss } from './bosses'
import type { World } from './world'

/** 逐只刷出的脉冲（人流 / 旋臂）：在 dur 秒里把 total 只均匀放出来 */
interface Job {
  form: 'stream' | 'spiral'
  enemy: EnemyId
  mix?: EnemyId
  total: number
  done: number
  t: number
  dur: number
  a: number
}

/** 伏击预警之后才刷出的脉冲（方向在预警时就定下了） */
interface Delayed {
  t: number
  pd: PulseDef
  scale: number
  a: number
}

/** 脉冲之后几秒出场的特殊兵种小队 */
interface Pending {
  t: number
  sq: SquadDef
}

/** 无尽模式里循环的波（第 5~12 波的脚本），每循环一圈放大一点 */
const ENDLESS_FROM = 4
const ENDLESS_LOOP = 8
const ENDLESS_GROW = 1.07
const ENDLESS_MAX = 2.4

/**
 * 波次导演：一个星区 = N 波 + Boss（见 data/waves.ts）。
 * 每一波按脚本在固定的时间点放出若干「脉冲」（一整群杂兵按阵型同时压上来）和「特殊兵种小队」；
 * 小 Boss 在指定的波登场；波尾前放一道浪涌扫清杂兵，并打开本波攒下的升级卡；最后一波结束放出 Boss。
 * Boss 战里每隔一阵补一波杂兵，让 Boss 战里也有割草。
 */
export class Director {
  /** 当前是第几波（1 起；0 = 尚未开始） */
  wave = 0
  /** 本波已经过去的时间 / 本波总长 / 星区共几波 / 本波主题 */
  waveT = 0
  waveLen = 0
  total = 0
  tag = ''

  private def: WaveDef | null = null
  /** 无尽模式的放大系数（正常 = 1） */
  private scale = 1
  /** 单位量取第几波的规模 */
  private unitWave = 1
  private pulseIdx = 0
  private pulseTimes: number[] = []
  private pending: Pending[] = []
  private jobs: Job[] = []
  private delayed: Delayed[] = []
  private swept = false
  private pickT = -1
  private miniPlan: MiniPlan | null = null
  private bossSpawned = false
  private addsT = 0
  private addsIdx = 0
  private bossWarned = false
  /** 人潮补兵：下次检查的倒计时 / 本波补兵用的杂兵种类 */
  private flowT = 0
  private flowAcc = 0
  private flowKinds: EnemyId[] = ['drone', 'swarmer']

  update(w: World, dt: number): void {
    const sec = w.sector
    const demo = !!w.cfg.demo
    this.total = sec.waves.length
    if (w.winT >= 0) return

    this.tickJobs(w, dt)
    this.tickDelayed(w, dt)
    this.tickPending(w, dt)

    const boss = w.boss && w.boss.alive ? w.boss : null
    if (this.bossSpawned) {
      if (boss && boss.mini === 0) {
        this.tickAdds(w, dt)
        return
      }
      // 正主已倒：只有无尽模式才继续刷怪
      if (!w.cfg.endless) return
    }

    if (this.wave === 0) this.startWave(w, 1)
    this.waveT += dt
    const def = this.def!

    // 脉冲
    while (this.pulseIdx < def.pulses.length && this.waveT >= this.pulseTimes[this.pulseIdx]) {
      this.firePulse(w, def.pulses[this.pulseIdx], this.pulseIdx)
      this.pulseIdx++
    }

    // 人潮补兵：浪涌清场之前一直在补，保证屏幕里永远有一群怪
    if (!this.swept) this.tickFlow(w, dt)

    // 小 Boss：登场时场上必须没有别的 Boss（上一只还没打死就顺延，直到本波结束为止）
    if (this.miniPlan && !demo && this.waveT >= WAVE.miniAt && !boss) {
      spawnBoss(w, this.miniPlan.boss, this.miniPlan.tier)
      this.miniPlan = null
    }

    // Boss 预警：最后一波的最后 10 秒
    if (!this.bossWarned && !demo && !this.bossSpawned && this.wave === this.total && this.waveT >= this.waveLen - 10) {
      this.bossWarned = true
      w.emit({ t: 'warn', key: 'warn.boss', sev: 2 })
    }

    // 浪涌：波尾前扫清杂兵，随后弹出本波攒下的升级卡
    if (!this.swept && this.waveT >= this.waveLen - WAVE.sweepLead) {
      this.swept = true
      w.waveSweep(this.wave)
      this.pickT = SURGE.pickDelay
    }
    if (this.pickT >= 0) {
      this.pickT -= dt
      if (this.pickT < 0) w.openPicks()
    }

    if (this.waveT >= this.waveLen) this.nextWave(w)
  }

  // ───────────────────────── 波的起止 ─────────────────────────

  /** 第 k 波的脚本（超出星区总波数时按无尽模式循环）与放大系数 */
  private script(w: World, k: number): { def: WaveDef; scale: number; unit: number } {
    const waves = w.sector.waves
    if (k <= waves.length) return { def: waves[k - 1], scale: 1, unit: k }
    const e = k - waves.length
    const base = waves[Math.min(waves.length - 1, ENDLESS_FROM + ((e - 1) % ENDLESS_LOOP))]
    return { def: base, scale: Math.min(ENDLESS_MAX, ENDLESS_GROW ** e), unit: waves.length }
  }

  private startWave(w: World, k: number): void {
    const s = this.script(w, k)
    const demo = !!w.cfg.demo
    this.wave = k
    this.waveT = 0
    this.def = s.def
    this.scale = s.scale * (demo ? 0.4 : 1)
    this.unitWave = s.unit
    this.waveLen = s.def.len
    this.tag = s.def.tag
    this.pulseIdx = 0
    this.swept = false
    this.pickT = -1
    // 每一波开场先给一份满额度：画面里立刻就有一批怪压上来，而不是干等第一个脉冲
    this.flowT = 0
    this.flowAcc = FLOW.clump[1] * 2
    this.pending.length = 0
    const kinds = new Set<EnemyId>()
    for (const pd of s.def.pulses) {
      if (pd.enemy && pd.form !== 'strike' && pd.form !== 'well' && pd.w > 0 && ENEMIES[pd.enemy].tier === 'fodder') kinds.add(pd.enemy)
    }
    this.flowKinds = kinds.size > 0 ? [...kinds] : ['drone', 'swarmer']
    const n = s.def.pulses.length
    const first = WAVE.firstAt
    const last = Math.max(first, s.def.len - WAVE.lastGap)
    this.pulseTimes = s.def.pulses.map((_, i) => (n <= 1 ? first : first + ((last - first) * i) / (n - 1)))
    this.miniPlan = !demo && k <= w.sector.waves.length ? (w.sector.minis.find((m) => m.wave === k) ?? null) : null
    w.beginWave(k)
    w.emit({ t: 'wave', n: k, total: this.total, tag: this.tag, mini: !!this.miniPlan })
  }

  private nextWave(w: World): void {
    const next = this.wave + 1
    if (next > this.total && !this.bossSpawned) {
      if (w.cfg.demo) {
        // 主菜单背景演示：不放 Boss，从头再来一遍
        this.startWave(w, 1)
        return
      }
      this.bossSpawned = true
      w.retireMini()
      w.dismissField()
      spawnBoss(w, w.sector.boss)
      this.addsT = 8
      return
    }
    this.startWave(w, next)
  }

  // ───────────────────────── 脉冲 ─────────────────────────

  private firePulse(w: World, pd: PulseDef, idx: number): void {
    const boss = w.boss && w.boss.alive
    const scale = this.scale * (boss ? WAVE.bossScale : 1)
    if (this.def?.squads) {
      for (const sq of this.def.squads) if ((sq.after ?? 1) === idx) this.pending.push({ t: 3, sq })
    }
    if (pd.warn && pd.warn > 0 && (pd.form === 'pincer' || pd.form === 'wall' || pd.form === 'lanes' || pd.form === 'stream')) {
      const a = this.dir(w)
      w.emit({ t: 'ambush', angles: pd.form === 'pincer' ? [a, a + Math.PI] : [a], t0: pd.warn })
      this.delayed.push({ t: pd.warn, pd, scale, a })
      return
    }
    this.spawnPulse(w, pd, scale, this.dir(w))
  }

  /** 这一群从哪个方向压来：有一定概率堵在玩家正在跑的方向上（"一直直线跑"不再安全） */
  private dir(w: World): number {
    const p = w.player
    if (TUNE.flank > 0 && p.vx * p.vx + p.vy * p.vy > 40 * 40 && w.rng.next() < TUNE.flank) {
      return Math.atan2(p.vy, p.vx) + w.rng.range(-TUNE.flankSpread, TUNE.flankSpread)
    }
    return w.rng.angle()
  }

  private count(w: World, pd: PulseDef, scale: number): number {
    const boss = w.boss && w.boss.alive ? w.boss : null
    const capNow = boss ? WAVE.addsCap + (boss.mini ? 100 : 0) : w.maxEnemies
    const raw = waveUnit(this.unitWave) * pd.w * w.sector.density * w.threat.spawn * scale
    const room = capNow - w.enemies.length
    return Math.min(WAVE.maxPulse, Math.round(raw), room)
  }

  // ───────────────────────── 人潮补兵 ─────────────────────────

  /** 玩家周围杂兵的目标数（补兵的稳态线；随波数、星区密度、威胁倍率走，小 Boss 在场时减半） */
  flowTarget(w: World): number {
    const boss = w.boss && w.boss.alive ? w.boss : null
    const raw = waveUnit(this.unitWave) * FLOW.k * w.sector.density * w.threat.spawn * this.scale * (boss ? FLOW.bossScale : 1)
    return Math.min(FLOW.cap, raw)
  }

  /** 画面里和画面边缘外一圈（FLOW.zone 像素以内）还活着的杂兵数 */
  flowHave(w: World): number {
    const p = w.player
    const zx = w.viewHalfW + FLOW.zone
    const zy = w.viewHalfH + FLOW.zone
    let have = 0
    const E = w.enemies
    for (let i = 0; i < E.length; i++) {
      const e = E[i]
      if (!e.alive || e.elite || e.def.tier !== 'fodder') continue
      if (Math.abs(e.x - p.x) < zx && Math.abs(e.y - p.y) < zy) have++
    }
    return have
  }

  private tickFlow(w: World, dt: number): void {
    this.flowT -= dt
    if (this.flowT > 0) return
    this.flowT = FLOW.every
    const boss = w.boss && w.boss.alive ? w.boss : null
    const target = this.flowTarget(w)
    const capNow = boss ? WAVE.addsCap + (boss.mini ? 100 : 0) : w.maxEnemies
    // 补兵额度按速率累积（目标小的时候一次检查凑不够一团，攒几次再放，而不是永远不补）
    let deficit = Math.min(target - this.flowHave(w), capNow - w.enemies.length)
    this.flowAcc = deficit > 0 ? Math.min(this.flowAcc + target * FLOW.rate * FLOW.every, FLOW.clump[1] * 2) : 0
    const p = w.player
    while (deficit >= 3 && this.flowAcc >= 3) {
      const n = Math.min(Math.floor(this.flowAcc), Math.ceil(deficit), w.rng.int(FLOW.clump[0], FLOW.clump[1] + 1))
      this.flowAcc -= n
      deficit -= n
      // 一团一种怪（黄蜂一团、螨虫一团），像一小股潮水从同一个方向涌来
      const id = w.rng.pick(this.flowKinds)
      const a = this.dir(w)
      const d = w.edgeDist(a, 130 + w.rng.range(0, 50))
      const cx = p.x + Math.cos(a) * d
      const cy = p.y + Math.sin(a) * d
      const sigma = 20 + n * 2.5
      for (let i = 0; i < n; i++) {
        const gx = (w.rng.next() + w.rng.next() + w.rng.next() - 1.5) * 2 * sigma
        const gy = (w.rng.next() + w.rng.next() + w.rng.next() - 1.5) * 2 * sigma
        w.spawnEnemy(id, cx + gx, cy + gy, { spawnT: 0.35, rush: true })
      }
    }
  }

  private spawnPulse(w: World, pd: PulseDef, scale: number, a: number): void {
    if (pd.form === 'strike') {
      this.strike(w, pd.n ?? 4)
      return
    }
    if (pd.form === 'well') {
      this.wells(w, pd.n ?? 1)
      return
    }
    const id = pd.enemy ?? 'swarmer'
    const n = this.count(w, pd, scale)
    if (n < 4) return
    const p = w.player
    const mix = pd.mix
    const kind = (i: number): EnemyId => (mix && i % 5 === 4 ? mix : id)
    const put = (i: number, x: number, y: number): void => {
      w.spawnEnemy(kind(i), x, y, { spawnT: 0.35, rush: true })
    }
    // 近似正态：三个均匀数之和
    const gauss = (sigma: number): number => (w.rng.next() + w.rng.next() + w.rng.next() - 1.5) * 2 * sigma

    switch (pd.form) {
      case 'ring': {
        const a0 = w.rng.angle()
        for (let i = 0; i < n; i++) {
          // 圈不是画出来的：每只的角度、半径各自抖一抖，收拢时参差不齐，像一圈潮水而不是一圈钉子
          const ai = a0 + ((i + w.rng.range(-0.45, 0.45)) / n) * TAU
          const r = w.edgeDist(ai, 44 + w.rng.range(0, 90))
          put(i, p.x + Math.cos(ai) * r, p.y + Math.sin(ai) * r)
        }
        break
      }
      case 'wall':
        this.wall(w, n, a, put, 0)
        break
      case 'pincer': {
        const h = Math.ceil(n / 2)
        this.wall(w, h, a, put, 0)
        this.wall(w, n - h, a + Math.PI, put, h)
        break
      }
      case 'burst': {
        const g = clamp(Math.round(n / 24), 3, 9)
        const base = w.rng.angle()
        let i = 0
        for (let j = 0; j < g; j++) {
          const aj = base + (j / g) * TAU + w.rng.range(-0.25, 0.25)
          const d = w.edgeDist(aj, 170 + w.rng.range(0, 40))
          const cx = p.x + Math.cos(aj) * d
          const cy = p.y + Math.sin(aj) * d
          const per = Math.ceil((n - i) / (g - j))
          for (let q = 0; q < per; q++) put(i++, cx + gauss(52), cy + gauss(52))
        }
        break
      }
      case 'lanes': {
        const k = clamp(Math.round(n / 16), 3, 9)
        const D = w.edgeLine(a, 44)
        const cx = p.x + Math.cos(a) * D
        const cy = p.y + Math.sin(a) * D
        const px = -Math.sin(a)
        const py = Math.cos(a)
        let i = 0
        for (let j = 0; j < k; j++) {
          const lat = (j - (k - 1) / 2) * 78 + w.rng.range(-14, 14)
          const per = Math.ceil((n - i) / (k - j))
          for (let q = 0; q < per; q++) {
            const back = q * 22 + w.rng.range(0, 24)
            const jx = w.rng.range(-9, 9)
            put(i++, cx + px * (lat + jx) + Math.cos(a) * back, cy + py * (lat + jx) + Math.sin(a) * back)
          }
        }
        break
      }
      case 'stream':
        this.jobs.push({ form: 'stream', enemy: id, mix, total: n, done: 0, t: 0, dur: clamp(3.5 + n / 38, 4, 9), a })
        break
      case 'spiral':
        this.jobs.push({ form: 'spiral', enemy: id, mix, total: n, done: 0, t: 0, dur: clamp(3 + n / 55, 3.5, 7), a })
        break
    }
  }

  /** 一面墙：垂直于来袭方向排开，太宽就排成几行 */
  private wall(w: World, n: number, a: number, put: (i: number, x: number, y: number) => void, i0: number): void {
    if (n <= 0) return
    const p = w.player
    const rows = Math.max(1, Math.ceil(n / 54))
    const per = Math.ceil(n / rows)
    const D = w.edgeLine(a, 44)
    const cx = p.x + Math.cos(a) * D
    const cy = p.y + Math.sin(a) * D
    const px = -Math.sin(a)
    const py = Math.cos(a)
    let k = 0
    for (let r = 0; r < rows && k < n; r++) {
      for (let j = 0; j < per && k < n; j++, k++) {
        const off = (j - (per - 1) / 2) * 28 + w.rng.range(-9, 9)
        const back = r * 30 + w.rng.range(0, 46)
        put(i0 + k, cx + px * off + Math.cos(a) * back, cy + py * off + Math.sin(a) * back)
      }
    }
  }

  private tickJobs(w: World, dt: number): void {
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const j = this.jobs[i]
      j.t += dt
      const due = Math.min(j.total, Math.floor((j.total * j.t) / j.dur)) - j.done
      const p = w.player
      for (let q = 0; q < due; q++) {
        if (w.enemies.length >= w.maxEnemies) break
        const id = j.mix && (j.done + q) % 5 === 4 ? j.mix : j.enemy
        let x: number
        let y: number
        if (j.form === 'stream') {
          const lat = w.rng.range(-120, 120)
          const back = w.edgeLine(j.a, 44) + w.rng.range(0, 110)
          x = p.x + Math.cos(j.a) * back - Math.sin(j.a) * lat
          y = p.y + Math.sin(j.a) * back + Math.cos(j.a) * lat
        } else {
          const ai = j.a + (j.t / j.dur) * TAU * 0.8
          const d = w.edgeDist(ai, 44 + w.rng.range(0, 60))
          x = p.x + Math.cos(ai) * d
          y = p.y + Math.sin(ai) * d
        }
        w.spawnEnemy(id, x, y, { spawnT: 0.35, rush: true })
      }
      j.done += due
      if (j.done >= j.total) {
        this.jobs[i] = this.jobs[this.jobs.length - 1]
        this.jobs.pop()
      }
    }
  }

  private tickDelayed(w: World, dt: number): void {
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      const d = this.delayed[i]
      d.t -= dt
      if (d.t > 0) continue
      this.delayed[i] = this.delayed[this.delayed.length - 1]
      this.delayed.pop()
      this.spawnPulse(w, d.pd, d.scale, d.a)
    }
  }

  // ───────────────────────── 特殊兵种小队 ─────────────────────────

  private tickPending(w: World, dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const q = this.pending[i]
      q.t -= dt
      if (q.t > 0) continue
      this.pending[i] = this.pending[this.pending.length - 1]
      this.pending.pop()
      this.spawnSquad(w, q.sq)
    }
  }

  private spawnSquad(w: World, sq: SquadDef): void {
    const p = w.player
    const a = this.dir(w)
    const R = w.edgeDist(a, 120)
    const cx = p.x + Math.cos(a) * R
    const cy = p.y + Math.sin(a) * R
    const spread = 36 + sq.n * 7
    for (let i = 0; i < sq.n; i++) {
      if (w.enemies.length >= w.maxEnemies + 20) break
      const ai = w.rng.angle()
      const d = w.rng.range(0, spread)
      w.spawnEnemy(sq.enemy, cx + Math.cos(ai) * d, cy + Math.sin(ai) * d, { elite: !!sq.elite, spawnT: 0.8 })
    }
    if (sq.elite) w.emit({ t: 'warn', key: 'warn.elite', sev: 1 })
  }

  // ───────────────────────── 环境机关 ─────────────────────────

  /** 陨火打击（熔炉星环）：玩家周围亮起一批预警圈，间隔 0.16 秒依次砸落。 */
  strike(w: World, n: number): void {
    const p = w.player
    // 第一发压在玩家"正要去的地方"（逼他换方向），其余散落在四周；预警时间 ≥ 1.25 秒，永远来得及走开
    const dmg = Math.round(20 * (1 + w.sector.dmgPerMin * (w.time / 60)))
    for (let i = 0; i < n; i++) {
      const a = w.rng.angle()
      const d = i === 0 ? 0 : w.rng.range(70, 360)
      const lead = i === 0 ? 0.7 : 0.35
      w.addTele('circle', p.x + p.vx * lead + Math.cos(a) * d, p.y + p.vy * lead + Math.sin(a) * d, 1.25 + i * 0.16, 'blast', {
        r: 64,
        color: '#ff7a2e',
        a: dmg,
        fx: 2,
      })
    }
    w.emit({ t: 'warn', key: 'warn.strike', sev: 1 })
  }

  /** 引力井（虚空星区）：在玩家附近张开，彼此错开 */
  wells(w: World, n: number): void {
    const p = w.player
    const placed: { x: number; y: number }[] = []
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 8; tries++) {
        const a = w.rng.angle()
        const d = w.rng.range(170, 380)
        const x = p.x + Math.cos(a) * d
        const y = p.y + Math.sin(a) * d
        if (placed.some((q) => Math.hypot(q.x - x, q.y - y) < 340) && tries < 7) continue
        placed.push({ x, y })
        w.addWell(x, y)
        break
      }
    }
    w.emit({ t: 'warn', key: 'warn.well', sev: 1 })
  }

  // ───────────────────────── Boss 战 ─────────────────────────

  /** Boss 战里每隔一阵补一波杂兵（轮换阵型） */
  private tickAdds(w: World, dt: number): void {
    const boss = w.boss
    if (!boss || boss.intro > 0) return
    this.addsT -= dt
    if (this.addsT > 0) return
    this.addsT = WAVE.addsEvery
    const adds = w.sector.adds
    if (adds.length === 0 || w.enemies.length > WAVE.addsCap - 30) return
    const pd = adds[this.addsIdx++ % adds.length]
    this.unitWave = WAVE.addsWave
    this.scale = 1
    this.firePulseAdds(w, pd)
  }

  private firePulseAdds(w: World, pd: PulseDef): void {
    if (pd.warn && pd.warn > 0 && (pd.form === 'pincer' || pd.form === 'wall' || pd.form === 'lanes' || pd.form === 'stream')) {
      const a = this.dir(w)
      w.emit({ t: 'ambush', angles: pd.form === 'pincer' ? [a, a + Math.PI] : [a], t0: pd.warn })
      this.delayed.push({ t: pd.warn, pd, scale: 1, a })
      return
    }
    this.spawnPulse(w, pd, 1, this.dir(w))
  }
}
