/**
 * 专精整局模拟：让机器人"认准"某一把武器——能拿就拿、拿到就一直升、满级后优先补它的搭档被动。
 * 和 bench-weapons（单件靶场输出）互补：这里看的是"整局里押这把武器，能不能赢"，
 * 用来发现"数值上不差、实战里却是陷阱 / 强得离谱"的武器。
 *
 *   npx tsx scripts/commit-weapons.ts                                   # 全部武器 × 先锋号 / 要塞号 × 数据荒原
 *   npx tsx scripts/commit-weapons.ts --weapons howitzer,siphon --ships vanguard,phantom --sector void --seeds 12
 *   npx tsx scripts/commit-weapons.ts --weapons none                     # 对照组：机器人照常自己选
 *
 * 输出每把武器的：胜率 / 平均存活 / 平均等级 / 平均击杀 / 平均进化数 / 该武器的最终等级分布。
 */
import { WEAPON_IDS, type SectorId, type ShipId, type WeaponId } from '../src/data/ids'
import { WEAPONS } from '../src/data/weapons'
import { Bot } from '../src/game/bot'
import type { InputState } from '../src/game/entities'
import { World } from '../src/game/world'

class CommitBot extends Bot {
  constructor(
    seed: number,
    private readonly favorite: WeaponId | null,
  ) {
    super(seed, 1, 0)
  }

  override pick(w: World): number {
    const fav = this.favorite
    if (fav) {
      const offers = w.offers
      // 进化 > 这把武器的新卡 / 升级 > 满级后它的搭档被动 > 机器人的常规选择
      let idx = offers.findIndex((o) => o.kind === 'weapon' && o.evolve && o.id === fav)
      if (idx >= 0) return idx
      idx = offers.findIndex((o) => o.kind === 'weapon' && o.id === fav)
      if (idx >= 0) return idx
      const wi = w.player.weapons.find((x) => x.id === fav)
      if (wi && !wi.evolved && wi.level >= 5) {
        idx = offers.findIndex((o) => o.kind === 'passive' && o.id === WEAPONS[fav].evolvesWith)
        if (idx >= 0) return idx
      }
    }
    return super.pick(w)
  }
}

interface Result {
  won: boolean
  time: number
  level: number
  kills: number
  evolves: number
  favLevel: number
  favEvolved: boolean
  maxHpRatio: number
}

function run(ship: ShipId, sector: SectorId, seed: number, fav: WeaponId | null): Result {
  const w = new World({ seed, ship, sector, threat: 0, meta: {} })
  const bot = new CommitBot(seed, fav)
  const input: InputState = { mx: 0, my: 0, dash: false }
  const dt = 1 / 60
  let minHp = 1
  while (w.phase !== 'won' && w.phase !== 'lost' && w.time < 660) {
    if (w.phase === 'levelup') {
      w.choose(bot.pick(w))
      continue
    }
    bot.drive(w, dt, input)
    w.update(dt, input)
    minHp = Math.min(minHp, w.player.hp / w.player.maxHp)
  }
  const wi = fav ? w.player.weapons.find((x) => x.id === fav) : undefined
  return {
    won: w.phase === 'won' || w.stats.bossKilled,
    time: w.time,
    level: w.player.level,
    kills: w.stats.kills,
    evolves: w.stats.evolves,
    favLevel: wi ? wi.level : 0,
    favEvolved: wi?.evolved ?? false,
    maxHpRatio: minHp,
  }
}

function opt(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const weapons = opt('weapons', WEAPON_IDS.join(','))
  .split(',')
  .filter(Boolean) as (WeaponId | 'none')[]
const ships = opt('ships', 'vanguard,bulwark').split(',') as ShipId[]
const sectors = opt('sector', 'wasteland').split(',') as SectorId[]
const seeds = Number(opt('seeds', '8'))

const pct = (n: number, d: number): string => `${String(Math.round((n / d) * 100)).padStart(3)}%`
const mmss = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

console.log('武器'.padEnd(10), '胜率   存活    等级  击杀   进化  持有/满级/进化   最低血量')
for (const id of weapons) {
  const fav = id === 'none' ? null : id
  const rs: Result[] = []
  for (const sector of sectors) for (const ship of ships) for (let s = 0; s < seeds; s++) rs.push(run(ship, sector, 100 + s, fav))
  const n = rs.length
  const avg = (f: (r: Result) => number): number => rs.reduce((a, r) => a + f(r), 0) / n
  const owned = rs.filter((r) => r.favLevel > 0).length
  const maxed = rs.filter((r) => r.favLevel >= 8 || r.favEvolved).length
  const evo = rs.filter((r) => r.favEvolved).length
  console.log(
    id.padEnd(10),
    pct(rs.filter((r) => r.won).length, n),
    ' ',
    mmss(avg((r) => r.time)).padStart(5),
    ' ',
    avg((r) => r.level).toFixed(0).padStart(3),
    ' ',
    avg((r) => r.kills).toFixed(0).padStart(5),
    ' ',
    avg((r) => r.evolves).toFixed(1),
    '  ',
    `${pct(owned, n)}/${pct(maxed, n)}/${pct(evo, n)}`,
    '      ',
    `${(avg((r) => r.maxHpRatio) * 100).toFixed(0)}%`,
  )
}
