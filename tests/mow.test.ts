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

// ───────────────────────── 浪涌：一波的句号 ─────────────────────────

test('浪涌：三道安静的友方环（只收割杂兵）、短暂无敌、带波数的 surge 事件', () => {
  const { w, events } = arena()
  w.mow.sweep(w, 3)
  const rings = w.rings.filter((r) => r.alive && !r.hostile)
  assert.equal(rings.length, SURGE.ringScale.length)
  assert.ok(rings.every((r) => r.quiet && r.fodder), '每一环都是 quiet 的、只对杂兵生效')
  assert.ok(rings.every((r) => r.wide > 1), '浪涌的环比普通环宽')
  assert.ok(w.player.invuln >= SURGE.invuln - DT * 2, '放出的瞬间给玩家短暂无敌')
  const ev = events.find((e) => e.t === 'surge')
  assert.ok(ev && ev.t === 'surge' && ev.n === 3, '事件带着是第几波')
})

test('浪涌：把半径内的杂兵扫光，半径外的不受影响；击杀数与经验即时入账', () => {
  const { w } = arena()
  const inside = crowd(w, 24, 300)
  const outside = crowd(w, 6, SURGE.radius + 260)
  const gain = inside.reduce((a, e) => a + e.xp, 0) * w.player.st.xp * (TUNE.xpByDensity > 0 ? 1 / w.sector.density ** TUNE.xpByDensity : 1)
  w.mow.sweep(w, 1)
  run(w, 1.4)
  assert.ok(inside.every((e) => !e.alive), '半径内的杂兵全灭')
  assert.ok(outside.every((e) => e.alive), '半径外的完好无损')
  assert.equal(w.stats.kills, inside.length)
  assert.ok(Math.abs(w.player.xp - gain) < gain * 0.01 + 1e-6, `经验当场入账：应得 ${gain.toFixed(2)}，实际 ${w.player.xp.toFixed(2)}`)
})

test('浪涌只收割杂兵：特殊兵种、精英和 Boss 一点伤害都没有', () => {
  const { w } = arena()
  const p = w.player
  const brute = w.spawnEnemy('brute', p.x + 260, p.y, { spawnT: 0, hpMul: 1 })
  const shield = w.spawnEnemy('shielder', p.x - 260, p.y, { spawnT: 0, hpMul: 1 })
  const eliteDrone = w.spawnEnemy('drone', p.x, p.y - 300, { spawnT: 0, elite: true })
  const filler = crowd(w, 12, 330)
  for (const e of [brute, shield, eliteDrone]) e.speed = 0
  spawnBoss(w, 'overseer')
  const boss = w.boss!
  boss.x = p.x
  boss.y = p.y + 340
  const bossHp = boss.hp
  const hp = [brute.hp, shield.hp, eliteDrone.hp]
  w.mow.sweep(w, 5)
  run(w, 1.4)
  assert.ok(filler.every((e) => !e.alive), '杂兵被收走')
  assert.ok([brute, shield, eliteDrone].every((e) => e.alive), '特殊兵种与精英还在')
  assert.deepEqual([brute.hp, shield.hp, eliteDrone.hp], hp, '而且一滴血都没掉')
  assert.equal(boss.hp, bossHp, 'Boss 不受影响')
})

test('浪涌命中杂兵是"安静"的：不出伤害数字 / 命中事件，但每只都有击杀事件', () => {
  const { w, events } = arena()
  const mobs = crowd(w, 20, 300)
  w.mow.sweep(w, 1)
  run(w, 1.4)
  assert.ok(mobs.every((e) => !e.alive))
  assert.equal(count(events, 'kill'), mobs.length, '每只杂兵都有一条击杀事件')
  assert.equal(count(events, 'hit'), 0, '没有逐只的命中事件（20 只一条都没有）')
})

test('浪涌：清掉冲击波半径内的敌方弹幕，半径外的不动', () => {
  const { w } = arena()
  crowd(w, 6, 300)
  const p = w.player
  w.spawnEnemyBullet(p.x + 200, p.y, 0, 10, 5)
  w.spawnEnemyBullet(p.x - 300, p.y, 0, 10, 5)
  w.spawnEnemyBullet(p.x, p.y + SURGE.radius + 200, 0, 10, 5)
  w.mow.sweep(w, 1)
  const alive = w.ebullets.filter((b) => b.alive).length
  assert.equal(alive, 1, '近处两发被清掉，远处一发保留')
})

test('浪涌一次放倒一整片：几百只一起倒就是一次大场面（群杀播报冲到高档位）', () => {
  const { w, events } = arena()
  crowd(w, 120, 330)
  crowd(w, 80, 420)
  w.mow.sweep(w, 1)
  run(w, 1.6)
  const multis = events.filter((e): e is Extract<GameEvent, { t: 'multi' }> => e.t === 'multi')
  assert.ok(multis.length >= 1, '一片倒下要有群杀播报')
  assert.ok(Math.max(...multis.map((m) => m.tier)) >= 3, `200 只一起倒应当至少冲到第 3 档，实际 ${multis.map((m) => m.tier).join(',')}`)
  assert.ok(w.stats.bestMulti >= 150)
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

test('一局下来：杂兵一直是一两下就倒（十分钟后也不变厚），特殊兵种则越来越厚', () => {
  const { w } = arena()
  w.time = 590
  const drone = w.spawnEnemy('drone', w.player.x + 900, w.player.y, { spawnT: 0 })
  const brute = w.spawnEnemy('brute', w.player.x - 900, w.player.y, { spawnT: 0 })
  assert.ok(drone.hp <= ENEMIES.drone.hp * w.threat.hp + 1e-9, '杂兵血量不随时间变厚')
  assert.ok(brute.hp > ENEMIES.brute.hp * 2, `重甲后期应当明显更厚：${brute.hp.toFixed(0)}`)
})
