import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FloatTexts, type FloatStyle } from '../src/render/floattext'

const st = (tier: number, life = 1): FloatStyle => ({ size: 12 + tier * 3, color: '#fff', life, tier })

/** 池容量（与实现里的 CAP 保持一致，测试里靠"填满"来探测） */
function fill(ft: FloatTexts, tier: number, life = 1): number {
  let n = 0
  while (ft.add(0, 0, `t${tier}-${n}`, st(tier, life))) n++
  return n
}

test('飘字池：容量有限，满了以后同档位的新字被丢弃', () => {
  const ft = new FloatTexts()
  const cap = fill(ft, 1)
  assert.ok(cap >= 30 && cap <= 80, `池大小应当适中，实际 ${cap}`)
  assert.equal(ft.count, cap)
  assert.equal(ft.add(0, 0, 'x', st(1)), false, '同档位满池时丢弃')
  assert.equal(ft.add(0, 0, 'x', st(0)), false, '更低档位满池时丢弃')
  assert.equal(ft.count, cap)
})

test('飘字池：满池时高档位挤掉最低档，重击的数字一定看得到', () => {
  const ft = new FloatTexts()
  const cap = fill(ft, 0)
  assert.equal(ft.add(0, 0, 'BIG', st(5)), true)
  assert.equal(ft.count, cap, '挤掉一条，总数不变')
  assert.equal(ft.tiers().filter((t) => t === 5).length, 1)
  assert.equal(ft.tiers().filter((t) => t === 0).length, cap - 1)
  // 继续来更多重击：每一条都能挤掉一条低档位
  for (let i = 0; i < 10; i++) assert.equal(ft.add(0, 0, 'BIG', st(5)), true)
  assert.equal(ft.tiers().filter((t) => t === 5).length, 11)
})

test('飘字池：高档位不会被低档位或同档位挤掉；挤的是最低档里最老的一条', () => {
  const ft = new FloatTexts()
  const cap = fill(ft, 4)
  assert.equal(ft.add(0, 0, 'small', st(2)), false)
  assert.equal(ft.add(0, 0, 'same', st(4)), false)
  assert.equal(ft.tiers().every((t) => t === 4), true)
  assert.equal(ft.add(0, 0, 'bigger', st(6)), true, '更高档位可以挤掉低档位')
  assert.equal(ft.count, cap)

  // 最老 = 剩余寿命占比最小。让它排在池的最后一个位置，防止"总是挤掉第 0 条"的错误实现蒙混过关
  const probe = new FloatTexts()
  const slots = fill(probe, 0, 10)
  const g = new FloatTexts()
  for (let i = 0; i < slots - 1; i++) g.add(0, 0, `fresh${i}`, st(0, 10))
  g.add(0, 0, 'old', st(0, 1))
  assert.equal(g.count, slots)
  g.update(0.7) // old 只剩 30%，其余还有 93%
  assert.equal(g.add(0, 0, 'BIG', st(3)), true)
  assert.equal(g.count, slots)
  const names = new Set<string>()
  g.draw(recorder(names))
  assert.ok(!names.has('old'), '最老的那条应被挤掉')
  assert.ok(names.has('BIG'))
  assert.ok(names.has('fresh0'), '其余的都还在')
})

test('飘字池：到期自动移除', () => {
  const ft = new FloatTexts()
  ft.add(0, 0, 'a', st(0, 0.3))
  ft.add(0, 0, 'b', st(0, 1))
  assert.equal(ft.count, 2)
  ft.update(0.31)
  assert.equal(ft.count, 1)
  ft.update(1)
  assert.equal(ft.count, 0)
  ft.add(0, 0, 'c', st(0))
  ft.clear()
  assert.equal(ft.count, 0)
})

/** 记录 fillText 调用顺序的假画布 */
function recorder(into: Set<string> | string[]): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get(t, k: string) {
      if (k === 'fillText')
        return (text: string) => {
          if (Array.isArray(into)) into.push(text)
          else into.add(text)
        }
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      if (k in t) return t[k]
      return () => {}
    },
    set(t, k: string, v) {
      t[k] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

test('飘字绘制顺序：高档位画在最上层，即使它是先加入的', () => {
  const ft = new FloatTexts()
  ft.add(0, 0, 'BIG', st(6))
  ft.add(0, 0, 'mid', st(3))
  ft.add(0, 0, 'tiny-a', st(0))
  ft.add(0, 0, 'tiny-b', st(1))
  const order: string[] = []
  ft.draw(recorder(order))
  assert.equal(order.length, 4)
  const idx = (s: string): number => order.indexOf(s)
  assert.ok(idx('tiny-a') < idx('BIG') && idx('tiny-b') < idx('BIG'), '小数字必须先画（在下面）')
  assert.ok(idx('tiny-a') < idx('mid') && idx('tiny-b') < idx('mid'))
})

/** 记录 fillText 的 x 坐标与 shadowBlur 状态的假画布 */
function probe(): { ctx: CanvasRenderingContext2D; xs: number[]; blurs: number[]; state: Record<string, unknown> } {
  const xs: number[] = []
  const blurs: number[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get(o, k: string) {
      if (k === 'fillText')
        return (_: string, x: number) => {
          xs.push(x)
          blurs.push(Number(o.shadowBlur ?? 0))
        }
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      if (k in o) return o[k]
      return () => {}
    },
    set(o, k: string, v) {
      o[k] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, xs, blurs, state }
}

test('飘字：热档位弹出时抖动，但最终稳定停在原位', () => {
  const ft = new FloatTexts()
  ft.add(100, 100, '999', { size: 28, color: '#f55', halo: '#f00', life: 1, pop: 2, tier: 5, rise: 0 })
  const a = probe()
  ft.draw(a.ctx) // age=0：抖动最强
  ft.update(0.5)
  const b = probe()
  ft.draw(b.ctx) // 弹出结束后：不再抖
  ft.update(0.1)
  const c = probe()
  ft.draw(c.ctx)
  assert.equal(b.xs.length, c.xs.length)
  assert.deepEqual(b.xs, c.xs, '弹出结束后位置应保持稳定（vy=0 时 x 不变）')
  assert.notEqual(a.xs[0], b.xs[0], '弹出瞬间应有抖动偏移')
})

test('飘字光晕：重击档位多画一层 shadowBlur 柔光，低画质可关闭，且绘制后一定复位', () => {
  const heavy = new FloatTexts()
  heavy.add(0, 0, '500', { size: 28, color: '#f55', halo: '#f00', life: 1, tier: 5 })
  const on = probe()
  heavy.draw(on.ctx, 2, true)
  assert.equal(on.xs.length, 2, '光晕层 + 正常填充层')
  assert.ok(on.blurs[0] > 0, '第一遍带 shadowBlur')
  assert.equal(on.blurs[1], 0, '第二遍（正常填充）不带 shadowBlur')
  assert.equal(on.state.shadowBlur, 0, '画完后 shadowBlur 必须复位，否则会污染后面的所有绘制')
  assert.equal(on.state.shadowColor, 'transparent')

  const off = probe()
  heavy.draw(off.ctx, 2, false)
  assert.equal(off.xs.length, 1, '低画质：只有正常填充')
  assert.ok(off.blurs.every((v) => v === 0))

  // 小数字（低档位）永远不走 shadowBlur
  const small = new FloatTexts()
  small.add(0, 0, '30', { size: 15, color: '#fff', halo: '#7fe9ff', life: 1, tier: 2 })
  const sm = probe()
  small.draw(sm.ctx, 2, true)
  assert.equal(sm.xs.length, 1)
  assert.ok(sm.blurs.every((v) => v === 0))
})
