/**
 * 无头整局模拟：让机器人在 Node 里把游戏从头打到尾。
 * 用途：1) 查崩溃/NaN/数值爆炸  2) 看难度曲线与耗时
 *
 *   npx tsx scripts/sim.ts                       # 默认：先锋号 / 霓虹原野 / 10 分钟
 *   npx tsx scripts/sim.ts --all                 # 所有飞船 × 所有星区
 *   npx tsx scripts/sim.ts --ship reaper --sector void --threat 2 --seed 7 -v
 */
import { META_IDS, SECTOR_IDS, SHIP_IDS, type SectorId, type ShipId } from '../src/data/ids'
import { METAS } from '../src/data/meta'
import { SECTORS } from '../src/data/sectors'
import { TUNE } from '../src/data/tuning'
import { Bot } from '../src/game/bot'
import type { InputState } from '../src/game/entities'
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

  while (w.phase !== 'won' && w.phase !== 'lost' && w.time < o.seconds) {
    if (w.phase === 'levelup') {
      w.choose(bot.pick(w))
      continue
    }
    bot.drive(w, dt, input)
    w.update(dt, input)
    ticks++

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
        `  t=${String(Math.floor(w.time)).padStart(3)}s  lv=${String(p.level).padStart(2)}  hp=${Math.round(p.hp)}/${Math.round(p.maxHp)}` +
          `  kills=${w.stats.kills}  enemies=${w.enemies.length}  gems=${w.gems.length}  proj=${w.pbullets.length}` +
          `  weapons=${p.weapons.map((x) => `${x.id}${x.evolved ? '★' : x.level}`).join(',')}`,
      )
    }
  }
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
    bossHpLeft: w.boss ? Math.round((w.boss.hp / w.boss.maxHp) * 100) : w.stats.bossKilled ? 0 : -1,
    msPerTick: ms / Math.max(1, ticks),
    maxEnemies,
    minHpRatio: minHp,
    dmgTaken: w.stats.damageTaken,
    killedBy: w.stats.killedBy,
    hurtBy: w.stats.hurtBy,
    bossT: w.stats.bossKilled ? Math.max(0, w.time - w.sector.length - 3.2) : -1,
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
 *   --tune hp=1.3,quad=2,spawn=1.2,dmg=1.2,xp=1.3,xpc=1.5,edmg=1.5,espeed=1.1,flank=0.4
 * hp/quad/spawn/dmg 作用于所有星区；xp 同乘经验曲线三项，xpc 额外乘二次项；
 * edmg/espeed 为敌人伤害/速度整体倍率；flank 为前路刷怪概率（绝对值）。
 */
function applyTune(spec: string): void {
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
    s.spawn.base *= k('spawn')
    s.spawn.perMin *= k('spawn')
    s.spawn.accel *= k('spawn')
  }
  TUNE.enemyDmg *= k('edmg')
  TUNE.enemySpeed *= k('espeed')
  if (kv.flank !== undefined) TUNE.flank = kv.flank
  XP_CURVE.a *= k('xp')
  XP_CURVE.b *= k('xp')
  XP_CURVE.c *= k('xp') * k('xpc')
}

function fmt(r: SimResult): string {
  const mm = `${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')}`
  return (
    `${r.ship.padEnd(9)} ${r.sector.padEnd(9)} ${r.phase.padEnd(6)} time=${mm}  lv=${String(r.level).padStart(2)}` +
    `  kills=${String(r.kills).padStart(5)}  evo=${r.evolves}  boss=${r.bossHpLeft}%  peak=${String(r.maxEnemies).padStart(3)}` +
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
    `  dmgTaken=${avg((r) => r.dmgTaken).toFixed(0).padStart(5)}  bossT=${bossTimes(rs)}  n=${n}`
  )
}

const isMain = process.argv[1]?.endsWith('sim.ts')
if (isMain) {
  const { opts, all, seeds } = parseArgs()
  const ti = process.argv.indexOf('--tune')
  if (ti >= 0) applyTune(process.argv[ti + 1] ?? '')
  const ships = all ? SHIP_IDS : [opts.ship]
  const sectors = all ? SECTOR_IDS : [opts.sector]
  if (seeds <= 1 && !all) {
    console.log(fmt(runSim(opts)))
  } else {
    const grand: SimResult[] = []
    for (const sector of sectors) {
      for (const ship of ships) {
        const rs: SimResult[] = []
        for (let s = 0; s < seeds; s++) rs.push(runSim({ ...opts, ship, sector, seed: opts.seed + s }))
        grand.push(...rs)
        console.log(summarize(`${ship}/${sector}/T${opts.threat}`, rs))
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
