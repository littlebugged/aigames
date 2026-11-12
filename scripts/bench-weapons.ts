/**
 * 武器输出基准：每把武器单独上场，在"稳定人潮"和"Boss 单挑"两种靶场里比有效输出。
 * 调武器平衡时先跑它，再改 src/data/weapons.ts 里的数值表。
 *
 *   npx tsx scripts/bench-weapons.ts                    # 全部武器 × (Lv1 / Lv4 / Lv8 / 进化)
 *   npx tsx scripts/bench-weapons.ts --only chakram,rail --seconds 60 --seeds 3
 *
 * 靶场规则：
 *  - 玩家无敌，机器人照常走位；
 *  - 人潮：场上始终保持 70 只敌人（死了立刻从屏外补），敌人血量固定放大 3 倍；
 *  - Boss：只放一个出场动画已结束的 Boss，打 25 秒；
 *  - "有效伤害"已扣除溢出（打死一只 50 血的敌人，哪怕单发 500 也只算 50）。
 */
import { WEAPON_IDS, WEAPON_MAX_LEVEL, type EnemyId, type WeaponId } from '../src/data/ids'
import { spawnBoss } from '../src/game/bosses'
import { Bot } from '../src/game/bot'
import { WeaponInst, type InputState } from '../src/game/entities'
import { World } from '../src/game/world'

interface Cfg {
  level: number
  evolved: boolean
  label: string
}

const CONFIGS: Cfg[] = [
  { level: 1, evolved: false, label: 'Lv1' },
  { level: 4, evolved: false, label: 'Lv4' },
  { level: WEAPON_MAX_LEVEL, evolved: false, label: 'Lv8' },
  { level: WEAPON_MAX_LEVEL, evolved: true, label: '进化' },
]

const MIX: [EnemyId, number][] = [
  ['drone', 40],
  ['swarmer', 25],
  ['brute', 15],
  ['shooter', 10],
  ['charger', 10],
]
const CROWD = 70
const HP_MUL = 3
const DT = 1 / 60

function pickEnemy(w: World): EnemyId {
  let r = w.rng.range(0, 100)
  for (const [id, wt] of MIX) {
    if (r < wt) return id
    r -= wt
  }
  return 'drone'
}

function arena(id: WeaponId, cfg: Cfg, seed: number): World {
  const w = new World({ seed, ship: 'vanguard', sector: 'fields', threat: 0, meta: {} })
  const p = w.player
  p.xpNext = 1e12
  p.invuln = 1e9
  p.weapons.length = 0
  const wi = new WeaponInst(id, 0)
  wi.level = cfg.level
  wi.evolved = cfg.evolved
  p.weapons.push(wi)
  w.recalc()
  return w
}

/** 给 world 的伤害函数套一层统计：只算打在血条上的有效伤害 */
function instrument(w: World): { enemy: () => number; boss: () => number } {
  let enemy = 0
  let boss = 0
  const de = w.damageEnemy.bind(w)
  const db = w.damageBoss.bind(w)
  w.damageEnemy = (e, dmg, kx, ky, o) => {
    const before = e.hp
    const r = de(e, dmg, kx, ky, o)
    enemy += Math.max(0, before - Math.max(e.hp, 0))
    return r
  }
  w.damageBoss = (b, dmg, o) => {
    const before = b.hp
    const r = db(b, dmg, o)
    boss += Math.max(0, before - Math.max(b.hp, 0))
    return r
  }
  return { enemy: () => enemy, boss: () => boss }
}

function crowd(id: WeaponId, cfg: Cfg, seed: number, seconds: number): { dps: number; kpm: number } {
  const w = arena(id, cfg, seed)
  let alive = 0
  ;(w as unknown as { director: { update: () => void } }).director.update = () => {
    alive = 0
    for (const e of w.enemies) if (e.alive) alive++
    for (let n = 0; alive < CROWD && n < 4; n++, alive++) {
      const pt = w.edgePoint()
      w.spawnEnemy(pickEnemy(w), pt.x, pt.y, { hpMul: HP_MUL })
    }
  }
  const stat = instrument(w)
  const bot = new Bot(seed, 1)
  const input: InputState = { mx: 0, my: 0, dash: false }
  const warm = 8
  let started = false
  let k0 = 0
  let d0 = 0
  while (w.time < warm + seconds) {
    bot.drive(w, DT, input)
    w.update(DT, input)
    if (!started && w.time >= warm) {
      started = true
      k0 = w.stats.kills
      d0 = stat.enemy()
    }
  }
  return { dps: (stat.enemy() - d0) / seconds, kpm: ((w.stats.kills - k0) / seconds) * 60 }
}

function duel(id: WeaponId, cfg: Cfg, seed: number, seconds: number): number {
  const w = arena(id, cfg, seed)
  ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
  spawnBoss(w, 'overseer')
  if (w.boss) w.boss.intro = 0
  const stat = instrument(w)
  const bot = new Bot(seed, 1)
  const input: InputState = { mx: 0, my: 0, dash: false }
  while (w.time < seconds && w.boss?.alive) {
    bot.drive(w, DT, input)
    w.update(DT, input)
  }
  return stat.boss() / seconds
}

function opt(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const only = opt('only', '')
  .split(',')
  .filter(Boolean) as WeaponId[]
const seconds = Number(opt('seconds', '40'))
const seeds = Number(opt('seeds', '2'))
const ids = only.length ? only : [...WEAPON_IDS]

const pad = (s: string | number, n: number): string => String(s).padEnd(n)
console.log(`${pad('武器', 9)}${pad('配置', 6)}${pad('人潮 DPS', 11)}${pad('击杀/分', 10)}${pad('Boss DPS', 10)}`)
for (const id of ids) {
  for (const cfg of CONFIGS) {
    let dps = 0
    let kpm = 0
    let boss = 0
    for (let s = 1; s <= seeds; s++) {
      const c = crowd(id, cfg, s * 17, seconds)
      dps += c.dps / seeds
      kpm += c.kpm / seeds
      boss += duel(id, cfg, s * 29, 25) / seeds
    }
    console.log(`${pad(id, 9)}${pad(cfg.label, 6)}${pad(dps.toFixed(0), 11)}${pad(kpm.toFixed(0), 10)}${pad(boss.toFixed(0), 10)}`)
  }
}
