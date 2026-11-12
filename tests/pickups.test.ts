import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RNG } from '../src/engine/rng'
import type { InputState } from '../src/game/entities'
import { World } from '../src/game/world'

/** 没有敌人干扰的空场地：只看经验石 / 道具怎么飞 */
function emptyWorld(seed: number): World {
  const w = new World({ seed, ship: 'vanguard', sector: 'fields', threat: 0, meta: {} })
  ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
  w.player.xpNext = 1e12
  return w
}

type Pattern = 'straight' | 'wander' | 'circle' | 'stopgo'

/** 模拟摇杆：直线 / 随机转向 / 绕圈 / 走走停停 */
function stick(pattern: Pattern, t: number, rng: RNG, st: { heading: number; nextTurn: number }, dt: number, input: InputState): void {
  switch (pattern) {
    case 'straight':
      input.mx = 1
      input.my = 0
      break
    case 'wander':
      if (t >= st.nextTurn) {
        st.heading += rng.range(-2.1, 2.1)
        st.nextTurn = t + rng.range(0.7, 1.6)
      }
      input.mx = Math.cos(st.heading)
      input.my = Math.sin(st.heading)
      break
    case 'circle':
      st.heading += 1.5 * dt
      input.mx = Math.cos(st.heading)
      input.my = Math.sin(st.heading)
      break
    case 'stopgo':
      input.mx = Math.floor(t / 1.2) % 2 === 0 ? 1 : 0
      input.my = 0
      break
  }
}

test('经验石：被吸附后无论怎么跑、帧率多少，都会很快被收走（不会绕着飞机转圈）', () => {
  for (const fps of [30, 60, 120]) {
    for (const pattern of ['straight', 'wander', 'circle', 'stopgo'] as Pattern[]) {
      const w = emptyWorld(11)
      const p = w.player
      const rng = new RNG(5)
      for (let i = 0; i < 160; i++) {
        const a = rng.angle()
        const d = rng.range(60, 900)
        w.addGem(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1)
      }
      for (const g of w.gems) g.mag = true // 相当于吃到了磁铁

      const dt = 1 / fps
      const input: InputState = { mx: 0, my: 0, dash: false }
      const st = { heading: 0, nextTurn: 0 }
      let t = 0
      while (t < 3 && w.gems.length > 0) {
        stick(pattern, t, rng, st, dt, input)
        w.update(dt, input)
        t += dt
      }
      assert.equal(w.gems.length, 0, `${pattern}@${fps}fps：3 秒后仍有 ${w.gems.length} 颗石头没被收走`)
      assert.ok(t < 2.5, `${pattern}@${fps}fps：全部收走用了 ${t.toFixed(2)}s，太慢`)
    }
  }
})

test('经验石：玩家持续移动时，常规吸附范围内的石头 0.5 秒内就会被收走', () => {
  for (const fps of [30, 60, 120]) {
    const w = emptyWorld(21)
    const p = w.player
    const rng = new RNG(8)
    const dt = 1 / fps
    const input: InputState = { mx: 0, my: 0, dash: false }
    const st = { heading: 0, nextTurn: 0 }
    const born = new Map<object, number>()
    let t = 0
    let worst = 0
    let nextDrop = 0
    while (t < 30) {
      if (t >= nextDrop) {
        nextDrop = t + 0.15
        for (let i = rng.int(1, 4); i > 0; i--) {
          const a = rng.angle()
          const d = rng.range(50, 250)
          w.addGem(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1)
        }
      }
      stick('wander', t, rng, st, dt, input)
      const before = [...w.gems]
      w.update(dt, input)
      t += dt
      for (const g of w.gems) if (g.mag && !born.has(g)) born.set(g, t)
      const alive = new Set<object>(w.gems)
      for (const g of before) {
        if (alive.has(g)) continue
        const b = born.get(g)
        if (b !== undefined) worst = Math.max(worst, t - b)
        born.delete(g)
      }
    }
    assert.ok(worst < 0.5, `${fps}fps：最慢的一颗被吸附后用了 ${worst.toFixed(2)}s 才收走`)
  }
})

test('道具：进入吸附范围后，即使玩家跑得比吸力还快也会被追上', () => {
  for (const fps of [30, 60, 120]) {
    const w = emptyWorld(31)
    const p = w.player
    p.st.speed = 420 // 远高于旧版 260 的固定吸力
    p.hp = 10
    w.addPickup('heal', p.x + 50, p.y)
    const dt = 1 / fps
    const input: InputState = { mx: -1, my: 0, dash: false } // 背向道具逃跑
    let t = 0
    while (t < 2 && w.pickups.length > 0) {
      w.update(dt, input)
      t += dt
    }
    assert.equal(w.pickups.length, 0, `${fps}fps：道具悬在飞机身后没被收走`)
    assert.ok(p.hp > 10, `${fps}fps：回血道具没有生效`)
    assert.ok(t < 1.2, `${fps}fps：追上用了 ${t.toFixed(2)}s`)
  }
})
