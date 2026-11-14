import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GroundFx, MAX_MARKS, MAX_PUFFS } from '../src/render/groundfx'

test('焦痕：有数量上限，满了顶掉最老的；寿命到了就消失', () => {
  const g = new GroundFx()
  for (let i = 0; i < MAX_MARKS + 10; i++) g.scorch(i, 0, 60)
  assert.equal(g.markCount, MAX_MARKS)
  g.update(1)
  assert.equal(g.markCount, MAX_MARKS, '寿命没到不该消失')
  g.update(5)
  assert.equal(g.markCount, 0, '寿命到了都应消失')
})

test('焦痕：先保持全浓，再单调淡出到 0', () => {
  const g = new GroundFx()
  g.scorch(0, 0, 60, 2)
  assert.equal(g.markAlpha(0), 1)
  let prev = 1
  for (let i = 0; i < 40; i++) {
    g.update(0.05)
    if (g.markCount === 0) break
    const a = g.markAlpha(0)
    assert.ok(a <= prev + 1e-9 && a >= 0, `浓度应单调不增：${prev} → ${a}`)
    prev = a
  }
  assert.ok(prev < 1, '应该已经开始淡出')
  assert.equal(g.markAlpha(99), 0, '不存在的焦痕浓度为 0')
})

test('烟团：有数量上限（满了丢弃新的）、会漂移减速、寿命到了就消失', () => {
  const g = new GroundFx()
  for (let i = 0; i < MAX_PUFFS + 20; i++) g.smoke(0, 0, 100, 0, 5, 20, 1, 0.5)
  assert.equal(g.puffCount, MAX_PUFFS)
  g.update(0.5)
  assert.equal(g.puffCount, MAX_PUFFS)
  g.update(1)
  assert.equal(g.puffCount, 0)
  // 一团烟：水平速度被阻尼衰减，同时被向上（屏幕 y 负方向）托起
  const s = new GroundFx()
  s.smoke(0, 0, 200, 0, 5, 20, 3, 0.5)
  let x = 0
  const probe = s as unknown as { puffs: { x: number; y: number; vx: number; vy: number }[] }
  for (let i = 0; i < 30; i++) {
    s.update(1 / 30)
    const p = probe.puffs[0]
    assert.ok(p.x >= x, '应一直向前飘')
    x = p.x
  }
  const p = probe.puffs[0]
  assert.ok(p.vx < 200 * 0.2, '水平速度应被阻尼大幅衰减')
  assert.ok(p.y < 0, '应向上漂移')
})

test('零或负的时间步长不推进任何东西；clear 清空全部', () => {
  const g = new GroundFx()
  g.scorch(0, 0, 60)
  g.smoke(0, 0, 0, 0, 5, 20, 1, 0.5)
  g.update(0)
  g.update(-1)
  assert.equal(g.markAlpha(0), 1)
  assert.equal(g.markCount + g.puffCount, 2)
  g.clear()
  assert.equal(g.markCount + g.puffCount, 0)
})
