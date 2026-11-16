/**
 * 无头整局模拟：让机器人在 Node 里把游戏从头打到尾。
 * 用途：1) 查崩溃/NaN/数值爆炸  2) 看难度曲线与耗时  3) 割草 / Boss 的"耐打程度"（--ttk）
 *
 *   npx tsx scripts/sim.ts                       # 默认：先锋号 / 霓虹原野 / 11 分钟
 *   npx tsx scripts/sim.ts --all                 # 所有飞船 × 所有星区
 *   npx tsx scripts/sim.ts --ship reaper --sector void --threat 2 --seed 7 -v
 *   npx tsx scripts/sim.ts --sector fields --seeds 4 --seconds 900 --ttk
 */
import { META_IDS, SECTOR_IDS, SHIP_IDS, type SectorId, type ShipId } from '../src/data/ids'
import { METAS } from '../src/data/meta'
import { SECTORS } from '../src/data/sectors'
import { TUNE, WELL } from '../src/data/tuning'
import { WAVE } from '../src/data/waves'
import { Bot } from '../src/game/bot'
import type { Boss, Enemy, InputState } from '../src/game/entities'
import { XP_CURVE, type MetaRanks } from '../src/game/stats'
import { World, type Phase } from '../src/game/world'

interface Opts {
  ship: ShipId
  sector: SectorId
  threat: number
  seed: number
  seconds: number
  skill: number
  sloppy: number
  meta: MetaRanks
  verbose: boolean
}

interface Ttk {
  n: number
  sum: number
  max: number
}

export interface SimResult {
  ship: ShipId
  sector: SectorId
  phase: Phase
  time: number
  level: number
  kills: number
  evolves: number
  weapons: string
  bossHpLeft: number
  msPerTick: number
  maxEnemies: number
  minHpRatio: number
  dmgTaken: number
  killedBy: string
  hurtBy: Record<string, number>
  /** Boss 战时长（击杀时刻 - Boss 出场），未击杀为 -1 */
  bossT: number
  /** 通过的波数 / 击败的小 Boss 数 / 0.6 秒窗口内的最高击杀数 */
  waves: number
  minis: number
  bestMulti: number
  /** 每一波结束时的等级（下标 0 = 第 1 波结束） */
  waveLv: number[]
  /** 每一波刷出的特殊兵种 / 精英的总血量（下标 0 = 第 1 波） */
  specHp: number[]
  /** 特殊兵种 / 精英 的击杀耗时（出场 → 死亡，秒） */
  ttk: Record<string, Ttk>
  /** 小 Boss / Boss 的战斗时长（出场 → 死亡，秒）；键：`mini:overseer`、`boss:overseer` */
  fights: Record<string, Ttk>
}

export function runSim(o: Opts): SimResult {
  const w = new World({ seed: o.seed, ship: o.ship, sector: o.sector, threat: o.threat, meta: o.meta })
  const bot = new Bot(o.seed, o.skill, o.sloppy)
  const input: InputState = { mx: 0, my: 0, dash: false }
  const dt = 1 / 60
  let nextLog = 0
  let ticks = 0
  let maxEnemies = 0
  let minHp = 1
  const t0 = performance.now()

  // ── 仪器：特殊兵种 / 精英的击杀耗时，小 Boss / Boss 的战斗时长，每波结束时的等级 ──
  /**
   * 特殊兵种 / 精英的"交战时长"：从首次受伤起，累计它出现在 520 像素内（武器射程）的时间。
   * 不算被机器人甩在身后赶路的时间——机器人一直在跑，真人会停下来处理重甲。
   */
  const birth = new Map<number, number>()
  const ttk: Record<string, Ttk> = {}
  const rec = (book: Record<string, Ttk>, key: string, v: number): void => {
    const r = (book[key] ??= { n: 0, sum: 0, max: 0 })
    r.n++
    r.sum += v
    if (v > r.max) r.max = v
  }
  const specHp: number[] = new Array<number>(14).fill(0)
  const spawn0 = w.spawnEnemy.bind(w)
  w.spawnEnemy = (...args: Parameters<World['spawnEnemy']>): Enemy => {
    const e = spawn0(...args)
    if (e.def.tier !== 'fodder' || e.elite) {
      birth.set(e.id, -1)
      const k = Math.max(0, w.director.wave - 1)
      specHp[k] = (specHp[k] ?? 0) + e.maxHp
    }
    return e
  }
  const kill0 = w.killEnemy.bind(w)
  w.killEnemy = (e: Enemy): void => {
    if (e.alive && birth.has(e.id)) {
      const t1 = birth.get(e.id) ?? -1
      rec(ttk, `${e.def.id}${e.elite ? '*' : ''}`, Math.max(0, t1))
      birth.delete(e.id)
    }
    kill0(e)
  }
  const fights: Record<string, Ttk> = {}
  let curBoss: Boss | null = null
  let curBossT0 = 0
  const waveLv: number[] = []
  let lastWave = 0

  while (w.phase !== 'won' && w.phase !== 'lost' && w.time < o.seconds) {
    if (w.phase === 'levelup') {
      w.choose(bot.pick(w))
      continue
    }
    bot.drive(w, dt, input)
    w.update(dt, input)
    ticks++

    if (ticks % 4 === 0) {
      const pp = w.player
      for (const e of w.enemies) {
        const v = birth.get(e.id)
        if (v === undefined || !e.alive) continue
        if (v < 0) {
          if (e.hp < e.maxHp) birth.set(e.id, 0)
        } else if (Math.hypot(e.x - pp.x, e.y - pp.y) < 520) birth.set(e.id, v + 4 * dt)
      }
    }
    if (w.director.wave !== lastWave) {
      if (lastWave > 0) waveLv[lastWave - 1] = w.player.level
      lastWave = w.director.wave
    }
    if (w.boss !== curBoss) {
      if (curBoss && curBoss.hp <= 0) rec(fights, `${curBoss.mini ? 'mini' : 'boss'}:${curBoss.id}`, w.time - curBossT0)
      curBoss = w.boss
      curBossT0 = w.time
    }

    const p = w.player
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.hp)) {
      throw new Error(`player NaN at t=${w.time.toFixed(1)}`)
    }
    if (w.enemies.length > maxEnemies) maxEnemies = w.enemies.length
    const ratio = p.hp / p.maxHp
    if (ratio < minHp) minHp = ratio
    if (ticks % 120 === 0) {
      for (const e of w.enemies) {
        if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.hp)) {
          throw new Error(`enemy NaN (${e.def.id}) at t=${w.time.toFixed(1)}`)
        }
      }
    }
    if (o.verbose && w.time >= nextLog) {
      nextLog += 30
      console.log(
        `  t=${String(Math.floor(w.time)).padStart(3)}s  wave=${String(w.director.wave).padStart(2)}  lv=${String(p.level).padStart(2)}  hp=${Math.round(p.hp)}/${Math.round(p.maxHp)}` +
          `  kills=${w.stats.kills}  enemies=${w.enemies.length}  gems=${w.gems.length}  proj=${w.pbullets.length}` +
          `  weapons=${p.weapons.map((x) => `${x.id}${x.evolved ? '★' : x.level}`).join(',')}`,
      )
    }
  }
  if (curBoss && curBoss.hp <= 0) rec(fights, `${curBoss.mini ? 'mini' : 'boss'}:${curBoss.id}`, w.time - curBossT0)
  const ms = performance.now() - t0
  const p = w.player
  return {
    ship: o.ship,
    sector: o.sector,
    phase: w.phase,
    time: w.time,
    level: p.level,
    kills: w.stats.kills,
    evolves: w.stats.evolves,
    weapons: p.weapons.map((x) => `${x.id}${x.evolved ? '★' : x.level}`).join(','),
    bossHpLeft: w.boss && w.boss.mini === 0 ? Math.round((w.boss.hp / w.boss.maxHp) * 100) : w.stats.bossKilled ? 0 : -1,
    msPerTick: ms / Math.max(1, ticks),
    maxEnemies,
    minHpRatio: minHp,
    dmgTaken: w.stats.damageTaken,
    killedBy: w.stats.killedBy,
    hurtBy: w.stats.hurtBy,
    bossT: w.stats.bossKilled ? (fights[`boss:${w.sector.boss}`]?.max ?? -1) : -1,
    waves: w.stats.waves,
    minis: w.stats.minis,
    bestMulti: w.stats.bestMulti,
    waveLv,
    specHp,
    ttk,
    fights,
  }
}

function parseArgs(): { opts: Opts; all: boolean; seeds: number } {
  const a = process.argv.slice(2)
  const get = (k: string, d: string): string => {
    const i = a.indexOf(k)
    return i >= 0 && a[i + 1] ? a[i + 1] : d
  }
  return {
    all: a.includes('--all'),
    seeds: Number(get('--seeds', '1')),
    opts: {
      ship: get('--ship', 'vanguard') as ShipId,
      sector: get('--sector', 'fields') as SectorId,
      threat: Number(get('--threat', '0')),
      seed: Number(get('--seed', '1')),
      seconds: Number(get('--seconds', '660')),
      skill: Number(get('--skill', '1')),
      sloppy: Number(get('--sloppy', '0')),
      meta: Object.fromEntries(META_IDS.map((id) => [id, Math.min(METAS[id].max, Number(get('--meta', '0')))])),
      verbose: a.includes('-v'),
    },
  }
}

/**
 * 平衡旋钮（只改内存，不动数据文件），用于参数扫描：
 *   --tune hp=1.3,quad=2,dmg=1.2,wu=30,wg=1.15,dens=1.2,xp=1.3,xpc=1.5,edmg=1.5,espeed=1.1,flank=0.4,grow=0.25,eliteHp=5,boss=3,mini1=0.2,mini2=0.3
 *   xa/xb/xc/xd 直接设定经验曲线系数；xdens 设定经验的密度校正指数
 *   wu / wg：每波的单位量起点 / 逐波增长；dens：所有星区的杂兵数量倍率；bscale：Boss 在场时波次脉冲的缩放；adds：Boss 战补兵间隔
 *   hp/quad/dmg 作用于所有星区；xp 同乘经验曲线三项，xpc 额外乘二次项；
 *   edmg/espeed 为敌人伤害/速度整体倍率；flank 为前路刷怪概率（绝对值）；grow / eliteHp / boss / mini1 / mini2 为 TUNE 里对应项的绝对值。
 */
export function applyTune(spec: string): void {
  const kv: Record<string, number> = {}
  for (const part of spec.split(',').filter(Boolean)) {
    const [k, v] = part.split('=')
    kv[k] = Number(v)
  }
  const k = (n: string): number => kv[n] ?? 1
  for (const id of SECTOR_IDS) {
    const s = SECTORS[id]
    s.hpPerMin *= k('hp')
    s.hpQuad *= k('quad')
    s.dmgPerMin *= k('dmg')
    s.density *= k('dens')
  }
  TUNE.enemyDmg *= k('edmg')
  TUNE.enemySpeed *= k('espeed')
  if (kv.flank !== undefined) TUNE.flank = kv.flank
  if (kv.grow !== undefined) TUNE.hpGrow = kv.grow
  if (kv.eliteHp !== undefined) TUNE.eliteHp = kv.eliteHp
  if (kv.boss !== undefined) TUNE.bossHp = kv.boss
  if (kv.mini1 !== undefined) TUNE.miniHp[0] = kv.mini1
  if (kv.mini2 !== undefined) TUNE.miniHp[1] = kv.mini2
  if (kv.xdens !== undefined) TUNE.xpByDensity = kv.xdens
  if (kv.wu !== undefined) WAVE.unitBase = kv.wu
  if (kv.wg !== undefined) WAVE.unitGrowth = kv.wg
  if (kv.bscale !== undefined) WAVE.bossScale = kv.bscale
  if (kv.adds !== undefined) WAVE.addsEvery = kv.adds
  if (kv.rush !== undefined) WAVE.rush = kv.rush
  if (kv.wellpull !== undefined) (WELL as { pull: number }).pull = kv.wellpull
  XP_CURVE.a *= k('xp')
  XP_CURVE.b *= k('xp')
  XP_CURVE.c *= k('xp') * k('xpc')
  XP_CURVE.d *= k('xp') * k('xpd')
  // 曲线系数的绝对值（做曲线形状实验用）
  if (kv.xa !== undefined) XP_CURVE.a = kv.xa
  if (kv.xb !== undefined) XP_CURVE.b = kv.xb
  if (kv.xc !== undefined) XP_CURVE.c = kv.xc
  if (kv.xd !== undefined) XP_CURVE.d = kv.xd
}

function fmt(r: SimResult): string {
  const mm = `${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')}`
  return (
    `${r.ship.padEnd(9)} ${r.sector.padEnd(9)} ${r.phase.padEnd(6)} time=${mm}  lv=${String(r.level).padStart(2)}` +
    `  kills=${String(r.kills).padStart(5)}  evo=${r.evolves}  boss=${r.bossHpLeft}%  peak=${String(r.maxEnemies).padStart(3)}  waves=${r.waves} minis=${r.minis} multi=${r.bestMulti}` +
    `  ${r.msPerTick.toFixed(3)}ms/tick  [${r.weapons}]`
  )
}

/** Boss 战时长：中位数 / 最慢（秒） */
function bossTimes(rs: SimResult[]): string {
  const t = rs.filter((r) => r.bossT >= 0).map((r) => r.bossT).sort((a, b) => a - b)
  if (t.length === 0) return '  -  '
  return `${Math.round(t[Math.floor(t.length / 2)])}/${Math.round(t[t.length - 1])}s`.padStart(9)
}

/** 多种子汇总：胜率 / 平均存活 / 平均等级 / 最低血量 */
function summarize(label: string, rs: SimResult[]): string {
  const n = rs.length
  const wins = rs.filter((r) => r.phase === 'won' || r.bossHpLeft === 0).length
  const pre = rs.filter((r) => r.phase === 'lost' && r.time < 600).length
  const avg = (f: (r: SimResult) => number): number => rs.reduce((a, r) => a + f(r), 0) / n
  const mm = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
  return (
    `${label.padEnd(22)} win=${String(Math.round((wins / n) * 100)).padStart(3)}% preBossDie=${String(Math.round((pre / n) * 100)).padStart(3)}%  survive=${mm(avg((r) => r.time))}` +
    `  lv=${avg((r) => r.level).toFixed(0).padStart(2)}  kills=${avg((r) => r.kills).toFixed(0).padStart(5)}` +
    `  evo=${avg((r) => r.evolves).toFixed(1)}  minHp=${(avg((r) => r.minHpRatio) * 100).toFixed(0).padStart(3)}%` +
    `  dmgTaken=${avg((r) => r.dmgTaken).toFixed(0).padStart(5)}  waves=${avg((r) => r.waves).toFixed(0).padStart(2)} multi=${avg((r) => r.bestMulti).toFixed(0).padStart(3)}  bossT=${bossTimes(rs)}  n=${n}`
  )
}

/** 汇总每一波结束时的平均等级、特殊兵种 / 精英 / 小 Boss / Boss 的耗时 */
function ttkReport(rs: SimResult[]): string[] {
  const out: string[] = []
  const nW = Math.max(0, ...rs.map((r) => r.waveLv.length))
  const lv: string[] = []
  let prev = 1
  for (let i = 0; i < nW; i++) {
    const xs = rs.map((r) => r.waveLv[i]).filter((v): v is number => v !== undefined)
    if (xs.length === 0) break
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    lv.push(`${m.toFixed(0)}(+${(m - prev).toFixed(1)})`)
    prev = m
  }
  out.push(`  波末等级   ${lv.join(' ')}`)
  const sh: string[] = []
  for (let i = 0; i < 12; i++) {
    const xs = rs.map((r) => r.specHp[i] ?? 0)
    sh.push(`${(xs.reduce((a, b) => a + b, 0) / rs.length / 1000).toFixed(1)}k`)
  }
  out.push(`  特殊总血量 ${sh.join(' ')}`)
  const merge = (pick: (r: SimResult) => Record<string, Ttk>): Record<string, Ttk> => {
    const all: Record<string, Ttk> = {}
    for (const r of rs) {
      for (const [key, v] of Object.entries(pick(r))) {
        const a = (all[key] ??= { n: 0, sum: 0, max: 0 })
        a.n += v.n
        a.sum += v.sum
        a.max = Math.max(a.max, v.max)
      }
    }
    return all
  }
  const line = (book: Record<string, Ttk>): string =>
    Object.entries(book)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => `${key} ${(v.sum / v.n).toFixed(1)}s(≤${v.max.toFixed(0)}, n=${v.n})`)
      .join('   ')
  out.push(`  特殊/精英  ${line(merge((r) => r.ttk))}`)
  out.push(`  小Boss/Boss ${line(merge((r) => r.fights))}`)
  return out
}

const isMain = process.argv[1]?.endsWith('sim.ts')
if (isMain) {
  const { opts, all, seeds } = parseArgs()
  const ti = process.argv.indexOf('--tune')
  if (ti >= 0) applyTune(process.argv[ti + 1] ?? '')
  const ships = all ? SHIP_IDS : [opts.ship]
  const sectors = all ? SECTOR_IDS : [opts.sector]
  const wantTtk = process.argv.includes('--ttk')
  if (seeds <= 1 && !all) {
    const r = runSim(opts)
    console.log(fmt(r))
    if (wantTtk) for (const l of ttkReport([r])) console.log(l)
  } else {
    const grand: SimResult[] = []
    for (const sector of sectors) {
      for (const ship of ships) {
        const rs: SimResult[] = []
        for (let s = 0; s < seeds; s++) rs.push(runSim({ ...opts, ship, sector, seed: opts.seed + s }))
        grand.push(...rs)
        console.log(summarize(`${ship}/${sector}/T${opts.threat}`, rs))
        if (wantTtk) for (const l of ttkReport(rs)) console.log(l)
      }
    }
    console.log('─'.repeat(100))
    console.log(summarize('ALL', grand))
    if (process.argv.includes('--causes')) {
      const dead = grand.filter((r) => r.killedBy)
      const byKill: Record<string, number> = {}
      const dmg: Record<string, number> = {}
      for (const r of dead) byKill[r.killedBy] = (byKill[r.killedBy] ?? 0) + 1
      for (const r of grand) for (const [k, v] of Object.entries(r.hurtBy)) dmg[k] = (dmg[k] ?? 0) + v / grand.length
      const top = (o: Record<string, number>): string =>
        Object.entries(o)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}:${Math.round(v)}`)
          .join('  ')
      const hist: Record<string, number> = {}
      for (const r of dead) {
        const m = Math.min(11, Math.floor(r.time / 60))
        hist[`${m}m`] = (hist[`${m}m`] ?? 0) + 1
      }
      console.log('死亡时刻  ', Object.entries(hist).map(([k, v]) => `${k}:${v}`).join('  '))
      console.log('死因分布  ', top(byKill))
      console.log('伤害来源  ', top(dmg))
    }
  }
}
