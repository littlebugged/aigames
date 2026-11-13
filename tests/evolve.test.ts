import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EnemyId, WeaponId } from '../src/data/ids'
import { EVOLVE_SHOCK } from '../src/data/tuning'
import { WeaponInst, type Enemy, type InputState } from '../src/game/entities'
import type { GameEvent } from '../src/game/events'
import { applyOffer } from '../src/game/offers'
import { World } from '../src/game/world'

const input: InputState = { mx: 0, my: 0, dash: false }
const DT = 1 / 60

interface Arena {
  w: World
  wi: WeaponInst
  events: GameEvent[]
}

/** 空旷的靶场：不刷怪、武器已满级（但不会自己开火），方便单独观察进化冲击波 */
function arena(id: WeaponId = 'pulse'): Arena {
  const w = new World({ seed: 5, ship: 'vanguard', sector: 'fields', threat: 0, meta: {} })
  ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
  const p = w.player
  p.xpNext = 1e12
  p.weapons.length = 0
  const wi = new WeaponInst(id, 0)
  wi.level = 8
  p.weapons.push(wi)
  w.recalc()
  const events: GameEvent[] = []
  w.sink = (e) => events.push(e)
  return { w, wi, events }
}

function evolve(a: Arena, id: WeaponId = 'pulse'): void {
  applyOffer(a.w, { kind: 'weapon', id, to: 8, isNew: false, evolve: true })
  // 武器的炮火会干扰对"冲击波本身"的观察
  a.wi.timer = 1e9
}

function dummy(w: World, dx: number, dy: number, id: EnemyId = 'brute', hpMul = 1000): Enemy {
  const e = w.spawnEnemy(id, w.player.x + dx, w.player.y + dy, { spawnT: 0, hpMul })
  e.speed = 0
  return e
}

/** 推进到冲击波引爆的那一帧（含）；最多等 2 秒 */
function stepToBoom(a: Arena): number {
  let t = 0
  while (t < 2) {
    a.w.update(DT, input)
    t += DT
    if (a.events.some((e) => e.t === 'evolveBoom')) return t
  }
  return -1
}

test('进化：立刻发 evolve 事件，等 delay 后才发 evolveBoom，且只发一次', () => {
  const a = arena()
  evolve(a)
  assert.equal(a.events.filter((e) => e.t === 'evolve').length, 1)
  assert.equal(a.events.filter((e) => e.t === 'evolveBoom').length, 0, '选卡的瞬间不该已经爆')
  assert.equal(a.wi.evolved, true)

  // delay 之前不爆
  let t = 0
  while (t < EVOLVE_SHOCK.delay - 0.05) {
    a.w.update(DT, input)
    t += DT
  }
  assert.equal(a.events.filter((e) => e.t === 'evolveBoom').length, 0, `${t.toFixed(2)}s 时不该已经爆`)
  // 之后爆一次，再等很久也不会重复
  for (let i = 0; i < 60 * 3; i++) a.w.update(DT, input)
  const booms = a.events.filter((e) => e.t === 'evolveBoom')
  assert.equal(booms.length, 1)
  assert.equal(booms[0].t === 'evolveBoom' && booms[0].w, 'pulse')
})

test('进化冲击波：半径内的敌人被削血并被震开，半径外毫发无伤', () => {
  const a = arena()
  const near = dummy(a.w, 140, 0)
  const nearLeft = dummy(a.w, -200, 0)
  const far = dummy(a.w, EVOLVE_SHOCK.radius + 200, 0)
  const nearHp = near.hp
  const farHp = far.hp
  evolve(a)
  const t = stepToBoom(a)
  assert.ok(t > 0, '应该引爆')
  assert.ok(near.hp < nearHp, '半径内的敌人应被削血')
  assert.ok(near.kx > 0, `右侧的敌人应被向右震开，kx=${near.kx}`)
  assert.ok(nearLeft.kx < 0, `左侧的敌人应被向左震开，kx=${nearLeft.kx}`)
  assert.equal(far.hp, farHp, '半径外的敌人不应受影响')
  assert.equal(far.kx, 0)
  const hits = a.events.filter((e) => e.t === 'hit')
  assert.ok(hits.length >= 2, '被波及的敌人都应有命中事件（飘字）')
})

test('进化冲击波：能直接清掉半径内的杂兵，且威力随时间增长', () => {
  const weak = arena()
  const fodder = dummy(weak.w, 120, 0, 'drone', 1)
  evolve(weak)
  stepToBoom(weak)
  assert.equal(fodder.alive, false, '最弱的杂兵应当被一波带走')

  const early = arena()
  const e1 = dummy(early.w, 100, 0)
  const hp1 = e1.hp
  evolve(early)
  stepToBoom(early)
  const dmgEarly = hp1 - e1.hp

  const late = arena()
  late.w.time = 480
  const e2 = dummy(late.w, 100, 0)
  const hp2 = e2.hp
  evolve(late)
  stepToBoom(late)
  const dmgLate = hp2 - e2.hp
  assert.ok(dmgLate > dmgEarly * 1.5, `8 分钟时的冲击波应明显更强：${dmgEarly.toFixed(0)} → ${dmgLate.toFixed(0)}`)
})

test('进化冲击波：不会伤到玩家自己，并抹掉半径内的敌方弹幕（半径外保留）', () => {
  const a = arena()
  const p = a.w.player
  p.invuln = 0
  const hp0 = p.hp
  a.w.spawnEnemyBullet(p.x + 120, p.y, 0, 0, 10, { life: 30 })
  a.w.spawnEnemyBullet(p.x - 80, p.y + 60, 0, 0, 10, { life: 30 })
  a.w.spawnEnemyBullet(p.x + EVOLVE_SHOCK.radius + 150, p.y, 0, 0, 10, { life: 30 })
  assert.equal(a.w.ebullets.filter((b) => b.alive).length, 3)
  evolve(a)
  stepToBoom(a)
  assert.equal(p.hp, hp0, '冲击波不该伤玩家')
  assert.ok(!a.events.some((e) => e.t === 'hurt'))
  assert.equal(a.w.ebullets.filter((b) => b.alive).length, 1, '只剩半径外的那一发')
})

test('进化冲击波：连续进化两把武器会各爆一次', () => {
  const a = arena('pulse')
  const second = new WeaponInst('orbit', 1)
  second.level = 8
  a.w.player.weapons.push(second)
  a.w.recalc()
  applyOffer(a.w, { kind: 'weapon', id: 'pulse', to: 8, isNew: false, evolve: true })
  applyOffer(a.w, { kind: 'weapon', id: 'orbit', to: 8, isNew: false, evolve: true })
  a.wi.timer = second.timer = 1e9
  for (let i = 0; i < 60 * 2; i++) a.w.update(DT, input)
  const booms = a.events.flatMap((e) => (e.t === 'evolveBoom' ? [e.w] : []))
  assert.deepEqual(booms.sort(), ['orbit', 'pulse'])
})

test('进化后的首轮火力等冲击波之后再打；shot 事件带 evo 标记', () => {
  const a = arena('pulse')
  const p = a.w.player
  dummy(a.w, 200, 0, 'brute', 1000)
  applyOffer(a.w, { kind: 'weapon', id: 'pulse', to: 8, isNew: false, evolve: true })
  assert.ok(a.wi.timer >= EVOLVE_SHOCK.delay, `首轮火力的等待 ${a.wi.timer} 应不早于冲击波 ${EVOLVE_SHOCK.delay}`)
  let firstShot = -1
  let boom = -1
  for (let i = 0; i < 60 * 2 && (firstShot < 0 || boom < 0); i++) {
    a.w.update(DT, input)
    if (boom < 0 && a.events.some((e) => e.t === 'evolveBoom')) boom = i
    if (firstShot < 0 && a.events.some((e) => e.t === 'shot')) firstShot = i
  }
  assert.ok(boom >= 0 && firstShot >= 0, '应该炸了、也应该开火了')
  assert.ok(firstShot >= boom, `首发（第 ${firstShot} 帧）不该早于冲击波（第 ${boom} 帧）`)
  const shot = a.events.find((e) => e.t === 'shot')
  assert.ok(shot && shot.t === 'shot' && shot.evo === true, '进化后的 shot 事件应带 evo=true')
  assert.ok(Number.isFinite(p.x))

  // 没进化的武器：evo 为 false
  const b = arena('pulse')
  dummy(b.w, 200, 0, 'brute', 1000)
  for (let i = 0; i < 60; i++) b.w.update(DT, input)
  const s2 = b.events.find((e) => e.t === 'shot')
  assert.ok(s2 && s2.t === 'shot' && !s2.evo, '未进化的 shot 事件 evo 应为假')
})
