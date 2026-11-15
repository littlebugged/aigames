import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENEMIES } from '../src/data/enemies'
import { MULTI, SURGE, TUNE } from '../src/data/tuning'
import { spawnBoss } from '../src/game/bosses'
import type { Enemy, InputState } from '../src/game/entities'
import type { GameEvent } from '../src/game/events'
import { World } from '../src/game/world'

const input: InputState = { mx: 0, my: 0, dash: false }
const DT = 1 / 60

interface Arena {
  w: World
  events: GameEvent[]
}

/** 靶场：不自然刷怪、没有武器（只有浪涌在杀），升级不会打断。 */
function arena(demo = false): Arena {
  const w = new World({ seed: 11, ship: 'vanguard', sector: 'fields', threat: 0, meta: {}, demo })
  ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
  const p = w.player
  p.xpNext = 1e12
  p.weapons.length = 0
  w.recalc()
  const events: GameEvent[] = []
  w.sink = (e) => events.push(e)
  return { w, events }
}

/** 在玩家周围 radius 处均匀放 n 只钉死的杂兵 */
function crowd(w: World, n: number, radius = 260, id: 'drone' | 'swarmer' = 'drone'): Enemy[] {
  const p = w.player
  const out: Enemy[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const e = w.spawnEnemy(id, p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius, { spawnT: 0, hpMul: 1 })
    e.speed = 0
    out.push(e)
  }
  return out
}

function run(w: World, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) w.update(DT, input)
}

const count = (events: GameEvent[], t: GameEvent['t']): number => events.filter((e) => e.t === t).length

// ───────────────────────── 浪涌：充能 ─────────────────────────

test('浪涌充能：杂兵每只 1 格、精英按 eliteWeight 计，充满为止不会溢出', () => {
  const { w } = arena()
  const need = w.mow.need()
  assert.equal(need, SURGE.need0, '第一次充能需要 need0 次击杀')
  const [a] = crowd(w, 1)
  w.killEnemy(a)
  assert.ok(Math.abs(w.mow.charge - 1 / need) < 1e-9, '一只杂兵 = 1 / need')

  const el = w.spawnEnemy('brute', w.player.x + 300, w.player.y, { spawnT: 0, elite: true })
  const before = w.mow.charge
  w.killEnemy(el)
  assert.ok(Math.abs(w.mow.charge - before - SURGE.eliteWeight / need) < 1e-9, '精英 = eliteWeight / need')

  for (const e of crowd(w, need * 2)) w.killEnemy(e)
  assert.equal(w.mow.charge, 1, '封顶 1')
  assert.equal(w.mow.ready, true)
})

test('浪涌充能需求：每放一次多 needStep 次击杀，封顶 needMax', () => {
  const { w } = arena()
  const m = w.mow
  assert.equal(m.need(), SURGE.need0)
  m.count = 3
  assert.equal(m.need(), SURGE.need0 + 3 * SURGE.needStep)
  m.count = 999
  assert.equal(m.need(), SURGE.needMax)
})

// ───────────────────────── 浪涌：释放时机 ─────────────────────────

test('浪涌释放：满能量 + 敌群够密 → 自动放一次；三道安静的友方环、清空充能、进入冷却', () => {
  const { w, events } = arena()
  crowd(w, SURGE.nearCount + 3)
  w.mow.charge = 1
  w.update(DT, input)
  assert.equal(w.stats.surges, 1)
  assert.equal(w.mow.count, 1)
  assert.equal(w.mow.charge, 0)
  assert.ok(w.mow.gap > SURGE.minGap - 0.1)
  assert.equal(count(events, 'surge'), 1)
  const rings = w.rings.filter((r) => r.alive && !r.hostile && r.quiet)
  assert.equal(rings.length, SURGE.ringMul.length, '每一环都是 quiet 的友方环')
  assert.ok(rings.every((r) => r.wide > 1), '浪涌的环比普通环宽')
  assert.ok(w.player.invuln >= SURGE.invuln - DT * 2, '释放瞬间给玩家短暂无敌')
})

test('浪涌释放：没充满不放；敌人不够密不放；只剩零星几只时等够 patience 才放', () => {
  const { w } = arena()
  crowd(w, SURGE.nearCount + 3)
  w.mow.charge = 0.99
  run(w, 1)
  assert.equal(w.stats.surges, 0, '没充满不放')

  const b = arena()
  crowd(b.w, 5)
  b.w.mow.charge = 1
  run(b.w, SURGE.patience - 0.5)
  assert.equal(b.w.stats.surges, 0, '只有 5 只、还没等够，不放')
  run(b.w, 1)
  assert.equal(b.w.stats.surges, 1, '等够 patience 秒，哪怕只有 5 只也放')

  const c = arena()
  crowd(c.w, 2)
  c.w.mow.charge = 1
  run(c.w, SURGE.patience + 2)
  assert.equal(c.w.stats.surges, 0, '只剩 2 只不值得放')
})

test('浪涌释放：Boss 在范围内就放，不需要小怪凑数；Boss 还在出场动画里则不放', () => {
  const { w } = arena()
  spawnBoss(w, 'overseer')
  const boss = w.boss!
  boss.x = w.player.x + 300
  boss.y = w.player.y
  w.mow.charge = 1
  w.update(DT, input)
  assert.equal(w.stats.surges, 0, '出场动画（intro > 0）期间不放')
  boss.intro = 0
  w.update(DT, input)
  assert.equal(w.stats.surges, 1)
})

test('浪涌冷却：放完之后再充满也要等 minGap 秒', () => {
  const { w } = arena()
  crowd(w, SURGE.nearCount + 2, 300)
  w.mow.charge = 1
  w.update(DT, input)
  assert.equal(w.stats.surges, 1)
  run(w, 1) // 冲击波走完，第一批敌人被扫光
  crowd(w, SURGE.nearCount + 2, 300)
  w.mow.charge = 1
  run(w, SURGE.minGap - 2.5)
  assert.equal(w.stats.surges, 1, 'minGap 之内不会放第二次')
  run(w, 3)
  assert.equal(w.stats.surges, 2, 'minGap 过后立刻放')
})

test('演示模式（主菜单背景）不放浪涌', () => {
  const { w } = arena(true)
  crowd(w, 30)
  w.mow.charge = 1
  run(w, 3)
  assert.equal(w.stats.surges, 0)
})

// ───────────────────────── 浪涌：效果 ─────────────────────────

test('浪涌的冲击波：把半径内的杂兵扫光，半径外的不受影响，击杀数与经验石都对得上', () => {
  const { w } = arena()
  const inside = crowd(w, 24, 300)
  const outside = crowd(w, 6, SURGE.radius + 260)
  const xp = inside.reduce((a, e) => a + e.xp, 0) * w.player.st.xp
  w.mow.charge = 1
  w.update(DT, input)
  run(w, 1.2)
  assert.ok(inside.every((e) => !e.alive), '半径内的杂兵全灭')
  assert.ok(outside.every((e) => e.alive), '半径外的完好无损')
  assert.equal(w.stats.kills, inside.length)
  run(w, 2) // 经验石被整张地图吸回来，之后全部进了账
  assert.ok(w.player.xp >= xp * 0.99, `杀掉的都变成了经验：应得约 ${xp.toFixed(1)}，实际 ${w.player.xp.toFixed(1)}`)
})

test('浪涌命中杂兵是"安静"的：不出伤害数字 / 命中事件，但每只都有击杀事件；精英照常显示命中', () => {
  const { w, events } = arena()
  const mobs = crowd(w, 20, 300)
  // 血很厚的精英：三环都打得到它，也都扛得住
  const elite = w.spawnEnemy('brute', w.player.x, w.player.y - 340, { spawnT: 0, elite: true, hpMul: 50 })
  elite.speed = 0
  w.mow.charge = 1
  w.update(DT, input)
  run(w, 1.2)
  const hits = events.filter((e) => e.t === 'hit')
  assert.ok(mobs.every((e) => !e.alive), '杂兵全灭')
  assert.ok(elite.alive, '精英还活着')
  assert.equal(count(events, 'kill'), mobs.length, '每只杂兵都有一条击杀事件')
  assert.equal(hits.length, SURGE.ringMul.length, '命中事件只来自精英：每一环一次，20 只杂兵一条都没有')
})

test('浪涌：清掉冲击波半径内的敌方弹幕，半径外的不动', () => {
  const { w } = arena()
  crowd(w, SURGE.nearCount + 2, 300)
  const p = w.player
  w.spawnEnemyBullet(p.x + 200, p.y, 0, 10, 5)
  w.spawnEnemyBullet(p.x - 300, p.y, 0, 10, 5)
  w.spawnEnemyBullet(p.x, p.y + SURGE.radius + 200, 0, 10, 5)
  w.mow.charge = 1
  w.update(DT, input)
  const alive = w.ebullets.filter((b) => b.alive).length
  assert.equal(alive, 1, '近处两发被清掉，远处一发保留')
})

test('浪涌之后：整张地图的经验石都被吸回来', () => {
  const { w } = arena()
  crowd(w, SURGE.nearCount + 2, 300)
  const p = w.player
  for (let i = 0; i < 12; i++) w.addGem(p.x + 1200 + i * 40, p.y - 900, 3)
  assert.ok(w.gems.every((g) => !g.mag))
  w.mow.charge = 1
  w.update(DT, input)
  assert.ok(
    w.gems.every((g) => !g.mag),
    '刚放出去的时候还没有吸',
  )
  run(w, SURGE.vacuumAfter + 0.1)
  assert.ok(w.gems.length >= 12)
  assert.ok(w.gems.every((g) => g.alive && g.mag), '半秒后所有经验石开始被吸')
})

test('浪涌的伤害随等级成长，且不吃暴击（数字可预期）', () => {
  const { w } = arena()
  w.player.level = 30
  w.player.st.crit = 1
  w.player.st.critMul = 5
  const target = w.spawnEnemy('brute', w.player.x + 260, w.player.y, { spawnT: 0, hpMul: 1000 })
  target.speed = 0
  const hp0 = target.hp
  crowd(w, SURGE.nearCount + 2, 300)
  w.mow.charge = 1
  w.update(DT, input)
  run(w, 1.2)
  const taken = hp0 - target.hp
  const one = (SURGE.base + SURGE.perLevel * 30) * w.player.st.dmg
  const expect = one * SURGE.ringMul.reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(taken - expect) < expect * 0.02, `三环合计应约为 ${expect.toFixed(0)}（无暴击），实际 ${taken.toFixed(0)}`)
})

// ───────────────────────── 群杀播报 ─────────────────────────

/** 在同一个窗口里连续制造 n 次击杀，返回新增的 multi 事件 */
function burst(w: World, events: GameEvent[], n: number): Extract<GameEvent, { t: 'multi' }>[] {
  const from = events.length
  const [e] = crowd(w, 1)
  for (let i = 0; i < n; i++) w.mow.onKill(w, e)
  return events.slice(from).filter((x): x is Extract<GameEvent, { t: 'multi' }> => x.t === 'multi')
}

test('群杀播报：窗口内击杀数每跨过一个档位就播报一次（n 为当时的击杀数）', () => {
  const { w, events } = arena()
  w.time = 100
  const got = burst(w, events, MULTI.tiers[2] + 5)
  assert.deepEqual(
    got.map((g) => g.tier),
    [1, 2, 3],
  )
  assert.deepEqual(
    got.map((g) => g.n),
    [MULTI.tiers[0], MULTI.tiers[1], MULTI.tiers[2]],
  )
  assert.equal(w.stats.bestMulti, MULTI.tiers[2] + 5)
})

test('群杀播报：不到最低档不播，窗口过期后重新计数', () => {
  const { w, events } = arena()
  w.time = 50
  assert.equal(burst(w, events, MULTI.tiers[0] - 1).length, 0)
  w.time += MULTI.span + 0.1
  assert.equal(burst(w, events, MULTI.tiers[0] - 1).length, 0, '新窗口从 0 开始数，不会和上一窗口的击杀累加')
  assert.equal(w.stats.bestMulti, MULTI.tiers[0] - 1)
})

test('群杀播报只看"突增"：近期击杀速度本来就很快时，同样的击杀数不算', () => {
  const { w, events } = arena()
  w.time = 80
  w.mow.rate = 40 // 每秒 40 个 → 窗口内平均 24 个，× spike 才是门槛
  const gate = 40 * MULTI.span * MULTI.spike
  const quiet = burst(w, events, Math.floor(gate) - 1)
  assert.equal(quiet.length, 0, '没有超过平均水平的 spike 倍，不播')
  const loud = burst(w, events, Math.ceil(gate) + 60)
  assert.ok(loud.length > 0, '明显超过平均水平才播')
})

test('群杀播报的冷却：同档位在 cooldown 内不重复，更高的档位不受限', () => {
  const { w, events } = arena()
  w.time = 10
  assert.equal(burst(w, events, MULTI.tiers[1]).length, 2, '第一次：1、2 档各一次')
  w.time += MULTI.span + 0.2 // 新窗口，但还在冷却里
  assert.equal(burst(w, events, MULTI.tiers[1]).length, 0, '冷却里同档位不再播')
  w.time += MULTI.span + 0.2
  const up = burst(w, events, MULTI.tiers[2])
  assert.ok(up.some((g) => g.tier === 3), '更高档位照播')
  w.time += MULTI.cooldown + 0.5
  assert.ok(burst(w, events, MULTI.tiers[1]).length > 0, '冷却过后同档位又能播')
})

test('一次浪涌必然是一次大场面：整局里只有它的那一下会冲到高档位', () => {
  const { w, events } = arena()
  crowd(w, 120, 330)
  crowd(w, 80, 420)
  w.mow.charge = 1
  w.update(DT, input)
  run(w, 1.5)
  const multis = events.filter((e): e is Extract<GameEvent, { t: 'multi' }> => e.t === 'multi')
  assert.ok(multis.length >= 1, '一片倒下要有群杀播报')
  assert.ok(Math.max(...multis.map((m) => m.tier)) >= 3, `200 只一起倒应当至少冲到第 3 档，实际 ${multis.map((m) => m.tier).join(',')}`)
  assert.ok(w.stats.bestMulti >= 150)
})

// ───────────────────────── 杂兵脆化 ─────────────────────────

test('杂兵血量成长：只吃一部分星区成长（hpGrow × 各自的 grow），分裂碎片不成长', () => {
  const { w } = arena()
  w.time = 600
  const m = 10
  const sc = w.sector
  const growth = sc.hpPerMin * m + sc.hpQuad * m * m
  const T = w.threat.hp
  for (const id of ['drone', 'brute', 'shielder', 'shard'] as const) {
    const e = w.spawnEnemy(id, w.player.x + 900, w.player.y, { spawnT: 0 })
    const def = ENEMIES[id]
    const expect = def.hp * (1 + growth * TUNE.hpGrow * def.grow) * T
    assert.ok(Math.abs(e.hp - expect) < 1e-6, `${id}: 期望 ${expect.toFixed(2)}，实际 ${e.hp.toFixed(2)}`)
    assert.ok(e.hp <= def.hp * (1 + growth) * T + 1e-9, `${id}: 不会比旧公式更厚`)
  }
  const shard = w.spawnEnemy('shard', w.player.x + 900, w.player.y, { spawnT: 0 })
  assert.ok(Math.abs(shard.hp - ENEMIES.shard.hp * T) < 1e-9, '碎片 grow = 0：十分钟后还是原始血量')
})

test('每种敌人都声明了 grow（0~2 之间）', () => {
  for (const def of Object.values(ENEMIES)) {
    assert.ok(Number.isFinite(def.grow) && def.grow >= 0 && def.grow <= 2, `${def.id}.grow = ${def.grow}`)
  }
})
