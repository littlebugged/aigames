import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FloatTexts, type FloatStyle, type NumPainter } from '../src/render/floattext'

const st = (tier: number, life = 1): FloatStyle => ({ size: 12 + tier * 3, style: tier, life, tier })

interface Call {
  text: string
  style: number
  x: number
  y: number
  size: number
  scale: number
  alpha: number
}

/** 记录每次绘制调用的假画笔（FloatTexts 只负责"画什么、画在哪、多大、多透明"，字形怎么画是 NumberFont 的事） */
function recorder(): { ctx: CanvasRenderingContext2D; painter: NumPainter; calls: Call[] } {
  const calls: Call[] = []
  const ctx = { globalAlpha: 1 } as unknown as CanvasRenderingContext2D
  const painter: NumPainter = {
    draw(c, text, style, x, y, size, scale) {
      calls.push({ text, style, x, y, size, scale, alpha: (c as unknown as { globalAlpha: number }).globalAlpha })
    },
  }
  return { ctx, painter, calls }
}

function render(ft: FloatTexts, scale = 1): Call[] {
  const r = recorder()
  ft.draw(r.ctx, r.painter, scale)
  return r.calls
}

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
  const names = new Set(render(g).map((c) => c.text))
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

test('飘字绘制顺序：高档位画在最上层，即使它是先加入的', () => {
  const ft = new FloatTexts()
  ft.add(0, 0, 'BIG', st(6))
  ft.add(0, 0, 'mid', st(3))
  ft.add(0, 0, 'tiny-a', st(0))
  ft.add(0, 0, 'tiny-b', st(1))
  const order = render(ft).map((c) => c.text)
  assert.equal(order.length, 4)
  const idx = (s: string): number => order.indexOf(s)
  assert.ok(idx('tiny-a') < idx('BIG') && idx('tiny-b') < idx('BIG'), '小数字必须先画（在下面）')
  assert.ok(idx('tiny-a') < idx('mid') && idx('tiny-b') < idx('mid'))
})

test('飘字：外观下标、缩放原样交给画笔，画完把 globalAlpha 复位', () => {
  const ft = new FloatTexts()
  ft.add(10, 20, '123', { size: 19, style: 3, life: 1, tier: 3, pop: 1 })
  ft.add(10, 20, '-9', { size: 18, style: 8, life: 1, tier: 4, pop: 1 })
  const r = recorder()
  ft.draw(r.ctx, r.painter, 2.5)
  assert.deepEqual(r.calls.map((c) => [c.text, c.style, c.scale]), [
    ['123', 3, 2.5],
    ['-9', 8, 2.5],
  ])
  assert.equal((r.ctx as unknown as { globalAlpha: number }).globalAlpha, 1, '画完必须复位，否则会污染后面的所有绘制')
})

test('飘字：弹出时放大到 pop 倍，随后回弹落定为原字号；越到末尾越透明', () => {
  const ft = new FloatTexts()
  ft.add(0, 0, '77', { size: 20, style: 2, life: 1, pop: 2, tier: 2, rise: 0 })
  const first = render(ft)[0]
  assert.ok(first.size > 20 * 1.9 && first.size <= 20 * 2.0001, `刚出现时应接近 2 倍，实际 ${first.size}`)
  ft.update(0.4) // 弹出早已结束，剩余寿命 60%（>50%，还没开始淡出）
  const settled = render(ft)[0]
  assert.ok(Math.abs(settled.size - 20) < 0.01, `弹出结束后应落回原字号，实际 ${settled.size}`)
  assert.equal(settled.alpha, 1, '中段完全不透明')
  ft.update(0.5) // 剩余 10%
  const fading = render(ft)[0]
  assert.ok(fading.alpha < 0.5 && fading.alpha > 0, `快到期时应已在淡出，实际 ${fading.alpha}`)
})

test('飘字：重击数字比杂兵数字更晚才开始淡出', () => {
  const ft = new FloatTexts()
  ft.add(0, 0, 'low', { size: 12, style: 0, life: 1, pop: 1, tier: 0, rise: 0 })
  ft.add(0, 0, 'high', { size: 12, style: 3, life: 1, pop: 1, tier: 3, rise: 0 })
  ft.update(0.6) // 剩余 40%：低档已开始淡出（<50%），高档还没（>30%）
  const calls = render(ft)
  const low = calls.find((c) => c.text === 'low')
  const high = calls.find((c) => c.text === 'high')
  assert.ok(low && high)
  assert.ok(low.alpha < 1, '低档位已开始淡出')
  assert.equal(high.alpha, 1, '高档位仍完全不透明')
})

test('飘字：热档位弹出时抖动，但最终稳定停在原位', () => {
  const ft = new FloatTexts()
  ft.add(100, 100, '999', { size: 28, style: 5, life: 1, pop: 2, tier: 5, rise: 0 })
  const a = render(ft) // age=0：抖动最强
  ft.update(0.5)
  const b = render(ft) // 弹出结束后：不再抖
  ft.update(0.1)
  const c = render(ft)
  assert.equal(b.length, c.length)
  assert.deepEqual(
    b.map((v) => [v.x, v.y]),
    c.map((v) => [v.x, v.y]),
    '弹出结束后位置应保持稳定（vy=0 时 x/y 不变）',
  )
  assert.notEqual(a[0].x, b[0].x, '弹出瞬间应有抖动偏移')
})

test('飘字：非热档位弹出时不抖动', () => {
  const ft = new FloatTexts()
  ft.add(100, 100, '55', { size: 19, style: 3, life: 1, pop: 1.6, tier: 3, rise: 0 })
  const a = render(ft)
  ft.update(0.001)
  const b = render(ft)
  assert.equal(a[0].x, b[0].x)
  assert.equal(a[0].y, b[0].y)
})
