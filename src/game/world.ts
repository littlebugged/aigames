import { ENEMIES } from '../data/enemies'
import type { EnemyId, SectorId, ShipId, WeaponId } from '../data/ids'
import { SECTORS, THREAT_LEVELS, type SectorDef } from '../data/sectors'
import { SHIPS } from '../data/ships'
import { TUNE } from '../data/tuning'
import { SpatialHash } from '../engine/grid'
import { angleTo, clamp, clamp01, segmentClosestT, turnToward } from '../engine/math'
import { Pool, compact } from '../engine/pool'
import { RNG } from '../engine/rng'
import { Director } from './director'
import { runTelegraph, updateBoss } from './bosses'
import { updateEnemies } from './enemies'
import {
  Beam,
  Blast,
  Bolt,
  Boss,
  Enemy,
  EnemyBullet,
  Gem,
  Mine,
  Pickup,
  Player,
  Projectile,
  Ring,
  Telegraph,
  WeaponInst,
  type InputState,
  type Target,
} from './entities'
import type { EventSink, GameEvent, PickupKind } from './events'
import { applyOffer, buildOffers, offerKey, type Offer } from './offers'
import { computePerks, computeStats, resolveWeaponStats, xpForLevel, type MetaRanks } from './stats'
import { updateWeapons } from './weapons'

export type Phase = 'play' | 'levelup' | 'won' | 'lost'

export interface RunConfig {
  seed: number
  ship: ShipId
  sector: SectorId
  threat: number
  meta: MetaRanks
  /** 主界面背景演示：不会结束、敌人少 */
  demo?: boolean
  /** 击败 Boss 后继续无尽模式 */
  endless?: boolean
}

export interface RunStats {
  kills: number
  time: number
  level: number
  evolves: number
  dashes: number
  noHitBest: number
  damageTaken: number
  bossKilled: boolean
  maxWeapons: number
  /** 通关（击败 Boss） */
  cleared: boolean
  /** 击坠玩家的来源（敌人 id / Boss id / bullet / beam / ring / blast） */
  killedBy: string
  /** 各来源累计造成的伤害（平衡遥测用） */
  hurtBy: Record<string, number>
}

export interface HitOpts {
  noCrit?: boolean
  stun?: number
  slow?: number
}

const GEM_CAP = 260

/**
 * 被吸附的经验石 / 道具怎么飞向玩家。
 * 以前是"朝玩家加速 + 限速"：一旦带上切向速度，就会在 v²/a ≈ 230px 的半径上稳定地绕着飞机转圈，
 * 玩家一直在动（手机摇杆）时尤其明显，几十颗石头能绕好几秒收不走。
 * 现在改成"速度转向"：目标速度 = 朝玩家的速度（随吸附时间加速）+ 玩家自己的速度。
 * 切向分量会在几十毫秒内被拉直，所以不会绕圈；叠加玩家速度，所以冲刺 / 加速时也追得上。
 */
const PULL_STEER = 14
const GEM_PULL_BASE = 320
const GEM_PULL_ACCEL = 2400
const GEM_PULL_MAX = 900
const PICK_PULL_BASE = 300
const PICK_PULL_ACCEL = 1800
const PICK_PULL_MAX = 800

const tierOf = (v: number): number => (v < 4 ? 0 : v < 12 ? 1 : v < 40 ? 2 : 3)

export class World {
  readonly cfg: RunConfig
  readonly rng: RNG
  readonly sector: SectorDef
  readonly threat: (typeof THREAT_LEVELS)[number]

  phase: Phase = 'play'
  time = 0
  tick = 0
  nextId = 0
  player = new Player()
  boss: Boss | null = null

  enemies: Enemy[] = []
  ebullets: EnemyBullet[] = []
  pbullets: Projectile[] = []
  gems: Gem[] = []
  pickups: Pickup[] = []
  beams: Beam[] = []
  rings: Ring[] = []
  mines: Mine[] = []
  blasts: Blast[] = []
  bolts: Bolt[] = []
  teles: Telegraph[] = []
  delayed: { t: number; x: number; y: number; r: number; dmg: number; color: string }[] = []

  readonly grid = new SpatialHash<Enemy>(96, 46)
  readonly director: Director
  stats: RunStats

  /** 视口半宽/半高（世界单位），由渲染层根据屏幕尺寸告知 */
  viewHalfW = 640
  viewHalfH = 360
  sink: EventSink | null = null

  // 升级流程
  queue: ('level' | 'chest')[] = []
  offers: Offer[] = []
  offerSource: 'level' | 'chest' = 'level'
  rerolls = 0
  banishes = 0
  revives = 0
  banished = new Set<string>()
  bonusCores = 0
  /** Boss 被击败后的收尾倒计时（<0 表示未触发） */
  winT = -1
  ringSerial = 0
  readonly maxEnemies: number

  /**
   * 网格查询用的临时数组，避免每次分配。
   * 注意：explode() 会在别的循环遍历期间被调用，所以它必须用自己独立的数组（tmpExp），
   * 否则会把外层正在遍历的结果覆盖掉。
   */
  readonly tmp: Enemy[] = []
  readonly tmpExp: Enemy[] = []
  /** 给武器模块用的第三个临时数组 */
  readonly tmpW: Enemy[] = []

  private enemyPool = new Pool(() => new Enemy())
  private projPool = new Pool(() => new Projectile())
  private ebPool = new Pool(() => new EnemyBullet())
  private gemPool = new Pool(() => new Gem())
  private pickPool = new Pool(() => new Pickup())
  private beamPool = new Pool(() => new Beam())
  private ringPool = new Pool(() => new Ring())
  private minePool = new Pool(() => new Mine())
  private blastPool = new Pool(() => new Blast())
  private boltPool = new Pool(() => new Bolt())
  private telePool = new Pool(() => new Telegraph())

  constructor(cfg: RunConfig) {
    this.cfg = cfg
    this.rng = new RNG(cfg.seed)
    this.sector = SECTORS[cfg.sector]
    this.threat = THREAT_LEVELS[clamp(Math.floor(cfg.threat), 0, THREAT_LEVELS.length - 1)]
    this.maxEnemies = cfg.demo ? 70 : 320
    this.director = new Director()

    const perks = computePerks(cfg.meta)
    this.rerolls = perks.rerolls
    this.banishes = perks.banishes
    this.revives = perks.revives

    const p = this.player
    p.st = computeStats(cfg.ship, cfg.meta, p.passives)
    p.maxHp = p.st.maxHp
    p.hp = p.maxHp
    p.xpNext = xpForLevel(1)
    p.weapons.push(new WeaponInst(SHIPS[cfg.ship].startWeapon, 0))
    this.recalc()

    this.stats = {
      kills: 0,
      time: 0,
      level: 1,
      evolves: 0,
      dashes: 0,
      noHitBest: 0,
      damageTaken: 0,
      bossKilled: false,
      maxWeapons: 1,
      cleared: false,
      killedBy: '',
      hurtBy: {},
    }
  }

  get viewR(): number {
    return Math.hypot(this.viewHalfW, this.viewHalfH)
  }

  emit(e: GameEvent): void {
    if (this.sink) this.sink(e)
  }

  /** 重新计算玩家与武器的衍生数值（升级/拾取道具后调用） */
  recalc(): void {
    const p = this.player
    const oldMax = p.maxHp
    p.st = computeStats(this.cfg.ship, this.cfg.meta, p.passives)
    p.maxHp = p.st.maxHp
    if (p.maxHp > oldMax) p.hp += p.maxHp - oldMax
    p.hp = Math.min(p.hp, p.maxHp)
    for (const wi of p.weapons) wi.s = resolveWeaponStats(wi.id, wi.level, wi.evolved, p.st)
  }

  // ───────────────────────── 主循环 ─────────────────────────

  update(dt: number, input: InputState): void {
    if (this.phase === 'won' || this.phase === 'lost' || this.phase === 'levelup') return
    this.time += dt
    this.tick++
    this.stats.time = this.time

    this.updatePlayer(dt, input)
    this.director.update(this, dt)
    updateEnemies(this, dt)
    this.rebuildGrid()
    updateBoss(this, dt)
    updateWeapons(this, dt)
    this.updateProjectiles(dt)
    this.updateEnemyBullets(dt)
    this.updateEffects(dt)
    this.updatePickups(dt)
    this.cleanup()

    if (this.winT >= 0) {
      this.winT -= dt
      if (this.winT < 0 && !this.cfg.endless) this.finish(true)
    }
    if (this.queue.length > 0 && this.phase === 'play') this.openOffers()
  }

  private rebuildGrid(): void {
    const g = this.grid
    g.clear()
    const E = this.enemies
    for (let i = 0; i < E.length; i++) if (E[i].alive) g.insert(E[i])
  }

  // ───────────────────────── 玩家 ─────────────────────────

  private updatePlayer(dt: number, input: InputState): void {
    const p = this.player
    const st = p.st
    if (st.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + st.regen * dt)
    if (p.invuln > 0) p.invuln -= dt
    if (p.hurtFlash > 0) p.hurtFlash -= dt
    p.noHit += dt
    if (p.noHit > this.stats.noHitBest) this.stats.noHitBest = p.noHit
    if (p.dashCd > 0) p.dashCd -= dt

    let mx = input.mx
    let my = input.my
    const m = Math.hypot(mx, my)
    if (m > 1) {
      mx /= m
      my /= m
    }

    if (input.dash && p.dashCd <= 0 && p.dashT <= 0 && this.phase === 'play') {
      if (m > 0.1) {
        p.dashDx = mx / m
        p.dashDy = my / m
      } else {
        p.dashDx = Math.cos(p.face)
        p.dashDy = Math.sin(p.face)
      }
      p.dashT = 0.17
      p.dashCd = st.dashCd
      p.invuln = Math.max(p.invuln, 0.3)
      this.stats.dashes++
      this.emit({ t: 'dash', x: p.x, y: p.y, a: Math.atan2(p.dashDy, p.dashDx) })
    }

    if (p.dashT > 0) {
      p.dashT -= dt
      p.vx = p.dashDx * 700
      p.vy = p.dashDy * 700
    } else {
      const k = 1 - Math.exp(-16 * dt)
      p.vx += (mx * st.speed - p.vx) * k
      p.vy += (my * st.speed - p.vy) * k
    }
    p.x += p.vx * dt
    p.y += p.vy * dt
    if (m > 0.1) p.face = turnToward(p.face, Math.atan2(my, mx), 16 * dt)
  }

  /** 玩家受伤。返回是否真的受到了伤害（无敌/冲刺中返回 false）。 */
  hurtPlayer(raw: number, sx: number, sy: number, src: string): boolean {
    const p = this.player
    if (p.invuln > 0 || p.dashT > 0 || this.phase !== 'play') return false
    const dmg = Math.max(raw * p.st.minTaken, raw - p.st.armor)
    p.hp -= dmg
    p.invuln = 0.5
    p.hurtFlash = 0.3
    p.noHit = 0
    p.hitAng = angleTo(p.x, p.y, sx, sy)
    this.stats.damageTaken += dmg
    this.stats.hurtBy[src] = (this.stats.hurtBy[src] ?? 0) + dmg
    if (p.hp <= 0) this.stats.killedBy = src
    this.emit({ t: 'hurt', x: p.x, y: p.y, dmg })
    if (p.hp <= 0) this.onPlayerDown()
    return true
  }

  private onPlayerDown(): void {
    const p = this.player
    if (this.cfg.demo || this.revives > 0) {
      if (!this.cfg.demo) this.revives--
      p.hp = this.cfg.demo ? p.maxHp : p.maxHp * 0.5
      p.invuln = 2.5
      this.explode(p.x, p.y, 260, 120, '#ff4d8d', 420)
      this.ebullets.forEach((b) => (b.alive = false))
      this.emit({ t: 'revive', x: p.x, y: p.y })
      return
    }
    p.hp = 0
    this.finish(false)
  }

  private finish(won: boolean): void {
    if (this.phase === 'won' || this.phase === 'lost') return
    this.phase = won ? 'won' : 'lost'
    this.stats.cleared = won
    this.stats.level = this.player.level
    this.emit({ t: 'end', won })
  }

  /** 玩家主动放弃本局 */
  abandon(): void {
    this.finish(false)
  }

  // ───────────────────────── 升级流程 ─────────────────────────

  addXp(v: number): void {
    const p = this.player
    p.xp += v * p.st.xp
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext
      p.level++
      p.xpNext = xpForLevel(p.level)
      this.stats.level = p.level
      this.queue.push('level')
      this.emit({ t: 'levelup', level: p.level })
    }
  }

  private openOffers(): void {
    this.offers = buildOffers(this)
    this.offerSource = this.queue[0]
    this.phase = 'levelup'
  }

  choose(i: number): void {
    if (this.phase !== 'levelup') return
    const o = this.offers[i]
    if (!o) return
    applyOffer(this, o)
    this.queue.shift()
    if (this.queue.length > 0) this.openOffers()
    else {
      this.offers = []
      this.phase = 'play'
    }
  }

  reroll(): boolean {
    if (this.phase !== 'levelup' || this.rerolls <= 0) return false
    this.rerolls--
    this.offers = buildOffers(this)
    return true
  }

  banish(i: number): boolean {
    if (this.phase !== 'levelup' || this.banishes <= 0) return false
    const o = this.offers[i]
    if (!o || o.kind === 'heal' || o.kind === 'cores') return false
    this.banishes--
    this.banished.add(offerKey(o))
    this.offers = buildOffers(this)
    return true
  }

  // ───────────────────────── 生成 ─────────────────────────

  spawnEnemy(
    id: EnemyId,
    x: number,
    y: number,
    o: { elite?: boolean; spawnT?: number; hpMul?: number } = {},
  ): Enemy {
    const def = ENEMIES[id]
    const e = this.enemyPool.get()
    const m = this.time / 60
    const sc = this.sector
    const hpMul = (1 + sc.hpPerMin * m + sc.hpQuad * m * m) * this.threat.hp * (o.hpMul ?? 1)
    e.def = def
    e.alive = true
    e.id = ++this.nextId
    e.x = x
    e.y = y
    e.vx = e.vy = e.kx = e.ky = 0
    e.elite = !!o.elite
    e.maxHp = e.hp = def.hp * hpMul * (e.elite ? 7 : 1)
    e.r = def.radius * (e.elite ? 1.45 : 1)
    e.speed = def.speed * TUNE.enemySpeed * Math.min(1.45, (1 + 0.012 * m) * this.threat.speed) * (e.elite ? 0.92 : 1)
    e.dmg = def.dmg * TUNE.enemyDmg * (1 + sc.dmgPerMin * m) * (e.elite ? 1.3 : 1)
    e.xp = def.xp * (e.elite ? 8 : 1)
    e.flash = 0
    e.age = 0
    e.spawnT = o.spawnT ?? 0.35
    e.contactCd = 0
    e.angle = this.rng.angle()
    e.state = 0
    e.timer = this.rng.range(0.4, 2)
    e.ax = e.ay = e.aux = 0
    e.slow = e.stun = e.shielded = 0
    e.hitAt.fill(0)
    e.lastRing = 0
    e.qs = 0
    this.enemies.push(e)
    return e
  }

  /** 屏幕外一圈随机点 */
  edgePoint(extra = 0): { x: number; y: number } {
    const p = this.player
    let a = this.rng.angle()
    // 一部分怪刷在玩家前进方向上，让"一直直线跑"不再安全
    if (TUNE.flank > 0 && p.vx * p.vx + p.vy * p.vy > 40 * 40 && this.rng.next() < TUNE.flank) {
      a = Math.atan2(p.vy, p.vx) + this.rng.range(-TUNE.flankSpread, TUNE.flankSpread)
    }
    const d = this.viewR + 50 + this.rng.range(0, 70) + extra
    return { x: this.player.x + Math.cos(a) * d, y: this.player.y + Math.sin(a) * d }
  }

  spawnProjectile(
    x: number,
    y: number,
    ang: number,
    speed: number,
    o: {
      damage: number
      r: number
      pierce: number
      life: number
      kind: Projectile['kind']
      color: string
      weapon: WeaponId
      slot: number
      knock?: number
      homing?: number
      blast?: number
      cluster?: number
      stun?: number
    },
  ): Projectile {
    const b = this.projPool.get()
    b.alive = true
    b.x = b.px = x
    b.y = b.py = y
    b.vx = Math.cos(ang) * speed
    b.vy = Math.sin(ang) * speed
    b.r = o.r
    b.damage = o.damage
    b.pierce = o.pierce
    b.life = o.life
    b.kind = o.kind
    b.color = o.color
    b.weapon = o.weapon
    b.slot = o.slot
    b.knock = o.knock ?? 0
    b.homing = o.homing ?? 0
    b.blast = o.blast ?? 0
    b.cluster = o.cluster ?? 0
    b.stun = o.stun ?? 0
    b.target = null
    b.targetId = -1
    b.retarget = 0
    b.hit.length = 0
    this.pbullets.push(b)
    return b
  }

  spawnEnemyBullet(
    x: number,
    y: number,
    ang: number,
    speed: number,
    dmg: number,
    o: { r?: number; life?: number; color?: string; accel?: number; kind?: 'orb' | 'needle' } = {},
  ): void {
    const b = this.ebPool.get()
    b.alive = true
    b.x = x
    b.y = y
    b.vx = Math.cos(ang) * speed
    b.vy = Math.sin(ang) * speed
    b.r = o.r ?? 6
    b.dmg = dmg
    b.life = o.life ?? 6
    b.color = o.color ?? '#ff3ea5'
    b.accel = o.accel ?? 0
    b.kind = o.kind ?? 'orb'
    this.ebullets.push(b)
  }

  addGem(x: number, y: number, value: number): void {
    if (value <= 0) return
    if (this.gems.length >= GEM_CAP) {
      const g = this.gems[this.rng.int(0, this.gems.length)]
      g.value += value
      g.tier = tierOf(g.value)
      return
    }
    const g = this.gemPool.get()
    g.alive = true
    g.x = x
    g.y = y
    const a = this.rng.angle()
    const s = this.rng.range(20, 90)
    g.vx = Math.cos(a) * s
    g.vy = Math.sin(a) * s
    g.value = value
    g.tier = tierOf(value)
    g.mag = false
    g.magT = 0
    g.age = 0
    this.gems.push(g)
  }

  addPickup(kind: PickupKind, x: number, y: number, value = 0): void {
    const k = this.pickPool.get()
    k.alive = true
    k.kind = kind
    k.x = x
    k.y = y
    k.vx = k.vy = 0
    k.age = 0
    k.value = value
    k.mag = false
    k.magT = 0
    this.pickups.push(k)
  }

  addBeam(): Beam {
    const b = this.beamPool.get()
    b.alive = true
    b.spin = 0
    b.hostile = false
    b.warn = 0
    b.fixed = false
    b.punch = false
    b.tickT = 0
    b.slot = 0
    this.beams.push(b)
    return b
  }

  addRing(): Ring {
    const r = this.ringPool.get()
    r.alive = true
    r.hostile = false
    r.slow = 0
    r.delay = 0
    r.hitPlayer = false
    r.serial = ++this.ringSerial
    this.rings.push(r)
    return r
  }

  addMine(): Mine {
    const m = this.minePool.get()
    m.alive = true
    m.age = 0
    m.pull = 0
    m.pulling = 0
    this.mines.push(m)
    return m
  }

  addBlast(x: number, y: number, r: number, color: string, life = 0.32): void {
    const b = this.blastPool.get()
    b.alive = true
    b.x = x
    b.y = y
    b.r = r
    b.color = color
    b.life = b.maxLife = life
    this.blasts.push(b)
  }

  addBolt(pts: number[], color: string, life = 0.2): void {
    const b = this.boltPool.get()
    b.alive = true
    b.pts = pts
    b.color = color
    b.life = b.maxLife = life
    this.bolts.push(b)
  }

  addTele(
    kind: 'circle' | 'line',
    x: number,
    y: number,
    t: number,
    action: string,
    o: { x2?: number; y2?: number; r?: number; color?: string; a?: number; b?: number } = {},
  ): Telegraph {
    const tl = this.telePool.get()
    tl.alive = true
    tl.kind = kind
    tl.x = x
    tl.y = y
    tl.x2 = o.x2 ?? x
    tl.y2 = o.y2 ?? y
    tl.r = o.r ?? 60
    tl.t = tl.maxT = t
    tl.color = o.color ?? '#ff3ea5'
    tl.action = action
    tl.a = o.a ?? 0
    tl.b = o.b ?? 0
    this.teles.push(tl)
    return tl
  }

  // ───────────────────────── 伤害与击杀 ─────────────────────────

  damageTarget(t: Target, dmg: number, kx = 0, ky = 0, o?: HitOpts): boolean {
    return t.isBoss ? this.damageBoss(t as Boss, dmg, o) : this.damageEnemy(t as Enemy, dmg, kx, ky, o)
  }

  damageEnemy(e: Enemy, dmg: number, kx = 0, ky = 0, o?: HitOpts): boolean {
    if (!e.alive || e.spawnT > 0) return false
    const st = this.player.st
    let d = dmg
    const crit = !o?.noCrit && st.crit > 0 && this.rng.next() < st.crit
    if (crit) d *= st.critMul
    if (e.shielded > 0) d *= 0.55
    e.hp -= d
    e.flash = 0.09
    if (kx !== 0 || ky !== 0) {
      const res = 1 - e.def.knockResist
      e.kx += kx * res
      e.ky += ky * res
    }
    if (o) {
      if (o.stun && o.stun > e.stun) e.stun = o.stun
      if (o.slow && o.slow > e.slow) e.slow = o.slow
    }
    this.emit({ t: 'hit', x: e.x, y: e.y, dmg: d, crit, color: e.def.color, boss: false })
    if (e.hp <= 0) {
      this.killEnemy(e)
      return true
    }
    return false
  }

  damageBoss(b: Boss, dmg: number, o?: HitOpts): boolean {
    if (!b.alive || b.intro > 0) return false
    const st = this.player.st
    let d = dmg
    const crit = !o?.noCrit && st.crit > 0 && this.rng.next() < st.crit
    if (crit) d *= st.critMul
    b.hp -= d
    b.flash = 0.08
    this.emit({ t: 'hit', x: b.x, y: b.y, dmg: d, crit, color: '#ffffff', boss: true })
    if (b.hp <= 0) {
      this.killBoss(b)
      return true
    }
    return false
  }

  killEnemy(e: Enemy): void {
    if (!e.alive) return
    e.alive = false
    this.stats.kills++
    const def = e.def
    this.emit({ t: 'kill', x: e.x, y: e.y, r: e.r, color: def.color, elite: e.elite, big: e.r >= 18 })
    this.addGem(e.x, e.y, e.xp)

    if (def.ai === 'splitter') {
      for (let i = 0; i < 3; i++) {
        const a = this.rng.angle()
        const s = this.spawnEnemy('shard', e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 10, {
          spawnT: 0,
          hpMul: 1,
        })
        s.kx = Math.cos(a) * 180
        s.ky = Math.sin(a) * 180
      }
    }

    const luck = this.player.st.luck
    const p = this.player
    if (e.elite) {
      this.addPickup('chest', e.x, e.y)
      this.addPickup('cache', e.x + 18, e.y + 6, Math.round(20 + this.time / 12))
      if (this.rng.chance(0.5)) this.addPickup('heal', e.x - 18, e.y + 6)
    } else if (!this.cfg.demo) {
      const lowHp = p.hp < p.maxHp * 0.4
      const r = this.rng.next()
      if (r < 0.011 + luck * 0.02 + (lowHp ? 0.012 : 0)) this.addPickup('heal', e.x, e.y)
      else if (r < 0.016 + luck * 0.025 + (lowHp ? 0.012 : 0)) this.addPickup('magnet', e.x, e.y)
      else if (r < 0.0185 + luck * 0.027 + (lowHp ? 0.012 : 0)) this.addPickup('bomb', e.x, e.y)
    }
  }

  killBoss(b: Boss): void {
    b.alive = false
    this.stats.bossKilled = true
    this.emit({ t: 'boss', id: b.id, what: 'dead' })
    this.addBlast(b.x, b.y, 220, '#ffffff', 0.7)
    // 清场：所有小怪化为经验
    for (const e of this.enemies) {
      if (!e.alive) continue
      e.alive = false
      this.stats.kills++
      this.emit({ t: 'kill', x: e.x, y: e.y, r: e.r, color: e.def.color, elite: false, big: false })
      this.addGem(e.x, e.y, e.xp)
    }
    for (const bl of this.ebullets) bl.alive = false
    this.beams.forEach((bm) => {
      if (bm.hostile) bm.alive = false
    })
    this.rings.forEach((r) => {
      if (r.hostile) r.alive = false
    })
    this.teles.forEach((t) => (t.alive = false))
    this.addPickup('chest', b.x - 24, b.y)
    this.addPickup('chest', b.x + 24, b.y)
    this.addPickup('cache', b.x, b.y + 26, Math.round(120 + this.time / 6))
    this.stats.cleared = true
    this.winT = 3.2
    this.boss = null
  }

  /**
   * 范围爆炸：对敌人和 Boss 造成伤害，并向外击退。
   * skip：不伤害该目标（用于等离子弹命中时避免对同一目标重复结算）。
   */
  explode(x: number, y: number, r: number, dmg: number, color: string, knock = 0, skip?: Target): void {
    this.addBlast(x, y, r, color)
    this.emit({ t: 'blast', x, y, r, color })
    const out = this.tmpExp
    out.length = 0
    this.grid.query(x, y, r, out)
    for (let i = 0; i < out.length; i++) {
      const e = out[i]
      if (!e.alive || e === skip) continue
      const dx = e.x - x
      const dy = e.y - y
      const d = Math.hypot(dx, dy) || 1
      const fall = 1 - clamp01(d / (r + e.r)) * 0.4
      this.damageEnemy(e, dmg * fall, (dx / d) * knock, (dy / d) * knock)
    }
    const b = this.boss
    if (b && b.alive && b !== skip && Math.hypot(b.x - x, b.y - y) < r + b.r) {
      this.damageBoss(b, dmg)
    }
  }

  /**
   * 最近的可攻击目标。Boss 一旦进入射程就是第一优先——
   * 否则它身边永远围着小怪，自动瞄准会全打在杂兵身上，Boss 战就变成了拖时间。
   */
  nearestTarget(x: number, y: number, range: number, filter?: (e: Enemy) => boolean): Target | undefined {
    const b = this.boss
    if (b && b.alive && b.intro <= 0 && Math.hypot(b.x - x, b.y - y) - b.r < range) return b
    return this.grid.nearest(x, y, range, (en) => en.alive && en.spawnT <= 0 && (!filter || filter(en)))
  }

  /** 屏幕炸弹：对视野内所有敌人造成大量伤害并清除敌方弹幕 */
  bombAll(): void {
    const p = this.player
    this.explode(p.x, p.y, this.viewR * 0.95, 260 + this.time * 0.8, '#ffffff', 300)
    for (const b of this.ebullets) b.alive = false
  }

  // ───────────────────────── 弹体 ─────────────────────────

  private updateProjectiles(dt: number): void {
    const P = this.pbullets
    const out = this.tmp
    for (let i = 0; i < P.length; i++) {
      const b = P[i]
      if (!b.alive) continue
      b.px = b.x
      b.py = b.y
      b.life -= dt

      if (b.homing > 0) {
        b.retarget -= dt
        if (b.retarget <= 0) {
          b.retarget = 0.15
          const found = this.nearestTarget(b.x, b.y, 460)
          b.target = found ?? null
          b.targetId = found ? (found.isBoss ? -2 : (found as Enemy).id) : -1
        }
        const tgt = b.target
        if (tgt && tgt.alive && (tgt.isBoss || (tgt as Enemy).id === b.targetId)) {
          const sp = Math.hypot(b.vx, b.vy)
          const ang = turnToward(Math.atan2(b.vy, b.vx), angleTo(b.x, b.y, tgt.x, tgt.y), b.homing * dt)
          b.vx = Math.cos(ang) * sp
          b.vy = Math.sin(ang) * sp
        }
      }

      b.x += b.vx * dt
      b.y += b.vy * dt

      let dead = b.life <= 0
      if (!dead) {
        const sx = b.x - b.px
        const sy = b.y - b.py
        const segLen = Math.hypot(sx, sy)
        out.length = 0
        this.grid.query((b.x + b.px) / 2, (b.y + b.py) / 2, segLen / 2 + b.r, out)
        for (let j = 0; j < out.length && !dead; j++) {
          const e = out[j]
          if (!e.alive || e.spawnT > 0 || b.hit.includes(e.id)) continue
          const t = segmentClosestT(b.px, b.py, b.x, b.y, e.x, e.y)
          const cx = b.px + sx * t
          const cy = b.py + sy * t
          const rr = b.r + e.r
          const dx = e.x - cx
          const dy = e.y - cy
          if (dx * dx + dy * dy > rr * rr) continue
          dead = this.projectileHit(b, e, cx, cy)
        }
        const boss = this.boss
        if (!dead && boss && boss.alive && boss.intro <= 0) {
          const t = segmentClosestT(b.px, b.py, b.x, b.y, boss.x, boss.y)
          const cx = b.px + sx * t
          const cy = b.py + sy * t
          const rr = b.r + boss.r
          if ((boss.x - cx) ** 2 + (boss.y - cy) ** 2 <= rr * rr && !b.hit.includes(-2)) {
            dead = this.projectileHit(b, boss, cx, cy)
          }
        }
      }

      if (dead) {
        if (b.life <= 0 && b.blast > 0) this.projectileBlast(b, b.x, b.y)
        b.alive = false
      }
    }
  }

  /** 命中处理，返回弹体是否应当消失 */
  private projectileHit(b: Projectile, t: Target, cx: number, cy: number): boolean {
    b.hit.push(t.isBoss ? -2 : (t as Enemy).id)
    if (b.blast > 0 && b.kind !== 'plasma') {
      this.projectileBlast(b, cx, cy)
      return true
    }
    const a = Math.atan2(b.vy, b.vx)
    this.damageTarget(t, b.damage, Math.cos(a) * b.knock, Math.sin(a) * b.knock, { stun: b.stun })
    if (b.kind === 'plasma' && b.blast > 0) {
      this.explode(cx, cy, b.blast, b.damage * 0.5, b.color, 40, t)
    }
    b.pierce--
    return b.pierce < 0
  }

  private projectileBlast(b: Projectile, x: number, y: number): void {
    this.explode(x, y, b.blast, b.damage, b.color, 90)
    for (let i = 0; i < b.cluster; i++) {
      const a = this.rng.angle()
      const d = this.rng.range(b.blast * 0.35, b.blast * 1.1)
      this.delayed.push({
        t: this.rng.range(0.1, 0.45),
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        r: b.blast * 0.55,
        dmg: b.damage * 0.4,
        color: b.color,
      })
    }
  }

  private updateEnemyBullets(dt: number): void {
    const B = this.ebullets
    const p = this.player
    const lim = this.viewR * 2.2
    for (let i = 0; i < B.length; i++) {
      const b = B[i]
      if (!b.alive) continue
      b.life -= dt
      if (b.accel !== 0) {
        const sp = Math.hypot(b.vx, b.vy) || 1
        const ns = Math.max(20, sp + b.accel * dt)
        b.vx *= ns / sp
        b.vy *= ns / sp
      }
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (b.life <= 0 || Math.abs(b.x - p.x) > lim || Math.abs(b.y - p.y) > lim) {
        b.alive = false
        continue
      }
      const rr = b.r + p.r
      const dx = p.x - b.x
      const dy = p.y - b.y
      if (dx * dx + dy * dy <= rr * rr) {
        if (this.hurtPlayer(b.dmg, b.x, b.y, 'bullet')) b.alive = false
      }
    }
  }

  // ───────────────────────── 持续效果 ─────────────────────────

  private updateEffects(dt: number): void {
    const p = this.player
    const out = this.tmp

    // 光束
    for (const bm of this.beams) {
      if (!bm.alive) continue
      if (!bm.fixed && !bm.hostile) {
        bm.ox = p.x
        bm.oy = p.y
      }
      bm.ang += bm.spin * dt
      if (bm.warn > 0) {
        bm.warn -= dt
        continue
      }
      bm.life -= dt
      if (bm.life <= 0) {
        bm.alive = false
        continue
      }
      bm.tickT -= dt
      if (bm.tickT > 0) continue
      bm.tickT += bm.tick
      const ex = bm.ox + Math.cos(bm.ang) * bm.len
      const ey = bm.oy + Math.sin(bm.ang) * bm.len
      if (bm.hostile) {
        const d2 = distSeg2(bm.ox, bm.oy, ex, ey, p.x, p.y)
        const rr = bm.width / 2 + p.r
        if (d2 <= rr * rr) this.hurtPlayer(bm.dmg, bm.ox, bm.oy, 'beam')
        continue
      }
      out.length = 0
      this.grid.query((bm.ox + ex) / 2, (bm.oy + ey) / 2, bm.len / 2 + 10, out)
      for (let i = 0; i < out.length; i++) {
        const e = out[i]
        if (!e.alive || e.spawnT > 0) continue
        const rr = bm.width / 2 + e.r
        if (distSeg2(bm.ox, bm.oy, ex, ey, e.x, e.y) <= rr * rr) this.damageEnemy(e, bm.dmg, 0, 0)
      }
      const boss = this.boss
      if (boss && boss.alive) {
        const rr = bm.width / 2 + boss.r
        if (distSeg2(bm.ox, bm.oy, ex, ey, boss.x, boss.y) <= rr * rr) this.damageBoss(boss, bm.dmg)
      }
    }

    // 冲击环
    for (const rg of this.rings) {
      if (!rg.alive) continue
      if (rg.delay > 0) {
        rg.delay -= dt
        continue
      }
      const r0 = rg.r
      rg.r += rg.speed * dt
      if (rg.r >= rg.maxR) {
        rg.alive = false
        continue
      }
      if (rg.hostile) {
        if (!rg.hitPlayer) {
          const d = Math.hypot(p.x - rg.x, p.y - rg.y)
          if (d >= r0 - p.r - 4 && d <= rg.r + p.r + 4) {
            if (this.hurtPlayer(rg.dmg, rg.x, rg.y, 'ring')) rg.hitPlayer = true
          }
        }
        continue
      }
      out.length = 0
      this.grid.query(rg.x, rg.y, rg.r + 20, out)
      for (let i = 0; i < out.length; i++) {
        const e = out[i]
        if (!e.alive || e.lastRing === rg.serial) continue
        const d = Math.hypot(e.x - rg.x, e.y - rg.y)
        if (d + e.r < r0 - 8 || d - e.r > rg.r + 4) continue
        e.lastRing = rg.serial
        const nx = (e.x - rg.x) / (d || 1)
        const ny = (e.y - rg.y) / (d || 1)
        this.damageEnemy(e, rg.dmg, nx * rg.knock, ny * rg.knock, { slow: rg.slow })
      }
      const boss = this.boss
      if (boss && boss.alive && boss.lastRing !== rg.serial) {
        const d = Math.hypot(boss.x - rg.x, boss.y - rg.y)
        if (d - boss.r <= rg.r + 4 && d + boss.r >= r0 - 8) {
          boss.lastRing = rg.serial
          this.damageBoss(boss, rg.dmg)
        }
      }
    }

    // 地雷
    for (const m of this.mines) {
      if (!m.alive) continue
      m.age += dt
      m.life -= dt
      if (m.pulling > 0) {
        m.pulling -= dt
        out.length = 0
        this.grid.query(m.x, m.y, m.pull, out)
        for (let i = 0; i < out.length; i++) {
          const e = out[i]
          if (!e.alive) continue
          const dx = m.x - e.x
          const dy = m.y - e.y
          const d = Math.hypot(dx, dy) || 1
          const f = 520 * (1 - e.def.knockResist * 0.6)
          e.kx += (dx / d) * f * dt
          e.ky += (dy / d) * f * dt
        }
        if (m.pulling <= 0) {
          this.explode(m.x, m.y, m.blast, m.dmg, '#5dff9e', 160)
          m.alive = false
        }
        continue
      }
      if (m.life <= 0) {
        m.alive = false
        continue
      }
      if (m.age < m.arm) continue
      out.length = 0
      this.grid.query(m.x, m.y, m.trigger, out)
      let trig = false
      for (let i = 0; i < out.length; i++) {
        if (out[i].alive && out[i].spawnT <= 0) {
          trig = true
          break
        }
      }
      const boss = this.boss
      if (!trig && boss && boss.alive && Math.hypot(boss.x - m.x, boss.y - m.y) < m.trigger + boss.r) trig = true
      if (!trig) continue
      if (m.pull > 0) {
        m.pulling = 0.55
      } else {
        this.explode(m.x, m.y, m.blast, m.dmg, '#5dff9e', 160)
        m.alive = false
      }
    }

    // 延迟爆炸（集束导弹的子弹）
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      const d = this.delayed[i]
      d.t -= dt
      if (d.t <= 0) {
        this.explode(d.x, d.y, d.r, d.dmg, d.color, 50)
        this.delayed[i] = this.delayed[this.delayed.length - 1]
        this.delayed.pop()
      }
    }

    // Boss 预警：倒计时结束后结算
    for (let i = 0; i < this.teles.length; i++) {
      const tl = this.teles[i]
      if (!tl.alive) continue
      tl.t -= dt
      if (tl.t <= 0) {
        tl.alive = false
        runTelegraph(this, tl)
      }
    }

    for (const b of this.blasts) {
      b.life -= dt
      if (b.life <= 0) b.alive = false
    }
    for (const b of this.bolts) {
      b.life -= dt
      if (b.life <= 0) b.alive = false
    }
  }

  // ───────────────────────── 拾取物 ─────────────────────────

  private updatePickups(dt: number): void {
    const p = this.player
    const magR = p.st.magnet
    const magR2 = magR * magR
    const steer = 1 - Math.exp(-PULL_STEER * dt)

    for (let i = 0; i < this.gems.length; i++) {
      const g = this.gems[i]
      if (!g.alive) continue
      g.age += dt
      const dx = p.x - g.x
      const dy = p.y - g.y
      const d2 = dx * dx + dy * dy
      if (!g.mag && d2 < magR2) g.mag = true
      if (g.mag) {
        g.magT += dt
        const d = Math.sqrt(d2) || 1
        const pull = Math.min(GEM_PULL_MAX, GEM_PULL_BASE + GEM_PULL_ACCEL * g.magT)
        g.vx += ((dx / d) * pull + p.vx - g.vx) * steer
        g.vy += ((dy / d) * pull + p.vy - g.vy) * steer
        // 相对玩家的速度：用它判断"这一步会不会穿过玩家"，避免高速掠过却没被收走
        const rel = Math.hypot(g.vx - p.vx, g.vy - p.vy)
        if (d < 14 + rel * dt) {
          g.alive = false
          this.addXp(g.value)
          this.emit({ t: 'gem', x: g.x, y: g.y, value: g.value })
          continue
        }
      } else {
        const k = Math.exp(-5 * dt)
        g.vx *= k
        g.vy *= k
      }
      g.x += g.vx * dt
      g.y += g.vy * dt
    }

    for (let i = 0; i < this.pickups.length; i++) {
      const k = this.pickups[i]
      if (!k.alive) continue
      k.age += dt
      const dx = p.x - k.x
      const dy = p.y - k.y
      const d = Math.hypot(dx, dy) || 1
      if (!k.mag && d < magR * 0.55) k.mag = true
      let rel = 0
      if (k.mag) {
        // 进入吸附范围后一路追到手，不会因为玩家跑得比吸力快而悬在身后
        k.magT += dt
        const pull = Math.min(PICK_PULL_MAX, PICK_PULL_BASE + PICK_PULL_ACCEL * k.magT)
        k.vx += ((dx / d) * pull + p.vx - k.vx) * steer
        k.vy += ((dy / d) * pull + p.vy - k.vy) * steer
        rel = Math.hypot(k.vx - p.vx, k.vy - p.vy)
      }
      if (d < p.r + 20 + rel * dt) {
        k.alive = false
        this.collectPickup(k)
        continue
      }
      if (k.mag) {
        k.x += k.vx * dt
        k.y += k.vy * dt
      }
      if (k.age > 60 && k.kind !== 'chest') k.alive = false
    }
  }

  private collectPickup(k: Pickup): void {
    const p = this.player
    this.emit({ t: 'pickup', kind: k.kind, x: k.x, y: k.y })
    switch (k.kind) {
      case 'heal':
        p.hp = Math.min(p.maxHp, p.hp + Math.max(20, p.maxHp * 0.3))
        break
      case 'magnet':
        for (const g of this.gems) g.mag = true
        break
      case 'bomb':
        this.bombAll()
        break
      case 'chest':
        this.queue.push('chest')
        break
      case 'cache':
        this.bonusCores += k.value
        break
    }
  }

  // ───────────────────────── 清理 ─────────────────────────

  private cleanup(): void {
    compact(this.enemies, this.enemyPool)
    compact(this.pbullets, this.projPool)
    compact(this.ebullets, this.ebPool)
    compact(this.gems, this.gemPool)
    compact(this.pickups, this.pickPool)
    compact(this.beams, this.beamPool)
    compact(this.rings, this.ringPool)
    compact(this.mines, this.minePool)
    compact(this.blasts, this.blastPool)
    compact(this.bolts, this.boltPool)
    compact(this.teles, this.telePool)
  }
}

/** 点到线段距离平方（内联版，避免 import 循环与额外调用） */
function distSeg2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const t = segmentClosestT(ax, ay, bx, by, px, py)
  const dx = ax + (bx - ax) * t - px
  const dy = ay + (by - ay) * t - py
  return dx * dx + dy * dy
}
