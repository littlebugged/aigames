/**
 * 武器靶场：逐把武器、逐个等级地测"割草能力"与"单体输出"，用来校准武器表。
 *
 *   npx tsx scripts/bench.ts                 # 全部武器的 L1 / L4 / L8 / 进化
 *   npx tsx scripts/bench.ts pulse orbit     # 只测指定武器
 *   npx tsx scripts/bench.ts --levels 1,8    # 只测指定等级（e 表示进化）
 *
 * 场景（飞船原地不动、无敌、不刷怪）：
 *   crowd —— 150 只杂兵（无人机 + 蜂群各半）围成一圈（半径 520）同时压上来，记录第 4 / 8 / 14 秒时的击杀数；
 *   heavy —— 一只 1500 血的重甲兵从 260 像素外走来，记录被打死的耗时（秒，> 30 记为 30+）。
 * 注意：这是"站桩"数据，真实对局里还有走位、被动加成和多把武器叠加，只用来比较武器之间的相对强弱。
 */
import { WEAPON_IDS, WEAPON_MAX_LEVEL, type EnemyId, type WeaponId } from '../src/data/ids'
import { WeaponInst, type InputState } from '../src/game/entities'
import { World } from '../src/game/world'

const input: InputState = { mx: 0, my: 0, dash: false }
const DT = 1 / 60

function arena(id: WeaponId, level: number, evolved: boolean): { w: World; wi: WeaponInst } {
  const w = new World({ seed: 11, ship: 'vanguard', sector: 'fields', threat: 0, meta: {} })
  ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
  w.addPickup = () => {} // 不要让掉落的炸弹 / 回血干扰测量
  const p = w.player
  p.xpNext = 1e12
  p.invuln = 1e9
  p.hp = p.maxHp = 1e9
  p.weapons.length = 0
  const wi = new WeaponInst(id, 0)
  wi.level = level
  wi.evolved = evolved
  p.weapons.push(wi)
  w.recalc()
  return { w, wi }
}

function crowd(id: WeaponId, level: number, evolved: boolean): number[] {
  const { w } = arena(id, level, evolved)
  const p = w.player
  const N = 150
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const kind: EnemyId = i % 2 === 0 ? 'drone' : 'swarmer'
    w.spawnEnemy(kind, p.x + Math.cos(a) * 520, p.y + Math.sin(a) * 520, { spawnT: 0 })
  }
  const marks = [4, 8, 14]
  const out: number[] = []
  let t = 0
  while (t < 14.001) {
    w.update(DT, input)
    t += DT
    if (marks.length && t >= marks[0]) {
      out.push(w.stats.kills)
      marks.shift()
    }
  }
  while (out.length < 3) out.push(w.stats.kills)
  return out
}

function heavy(id: WeaponId, level: number, evolved: boolean): number {
  const { w } = arena(id, level, evolved)
  const p = w.player
  const e = w.spawnEnemy('brute', p.x + 260, p.y, { spawnT: 0 })
  e.maxHp = e.hp = 1500
  let t = 0
  while (e.alive && t < 30) {
    w.update(DT, input)
    t += DT
  }
  return e.alive ? 30 : t
}

const args = process.argv.slice(2)
const li = args.indexOf('--levels')
const levelSpec = li >= 0 ? (args[li + 1] ?? '') : '1,4,8,e'
const ids = args.filter((a, i) => !a.startsWith('--') && i !== (li >= 0 ? li + 1 : -1)) as WeaponId[]
const list = ids.length ? ids : [...WEAPON_IDS]
const levels = levelSpec.split(',')

console.log('武器       等级   crowd(150): 4s / 8s / 14s     heavy(1500HP)')
for (const id of list) {
  for (const l of levels) {
    const evolved = l === 'e'
    const lv = evolved ? WEAPON_MAX_LEVEL : Math.min(WEAPON_MAX_LEVEL, Number(l))
    const c = crowd(id, lv, evolved)
    const h = heavy(id, lv, evolved)
    console.log(`${id.padEnd(10)} ${(evolved ? 'evo' : `L${lv}`).padEnd(5)}  ${c.map((v) => String(v).padStart(4)).join(' / ')}              ${h >= 30 ? '30+' : h.toFixed(1)}s`)
  }
}
