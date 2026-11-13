import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NUM_LOOKS } from '../src/engine/feel'
import { NumberFont, type PaintSurface } from '../src/render/numfont'

/** 记录调用的假 2D 上下文：只关心"画了什么、按什么顺序、状态有没有复位" */
interface Rec {
  w: number
  h: number
  ops: string[]
  state: Record<string, unknown>
  ctx: CanvasRenderingContext2D
}

function surfaces(): { make: (w: number, h: number) => PaintSurface; made: Rec[] } {
  const made: Rec[] = []
  const make = (w: number, h: number): PaintSurface => {
    const ops: string[] = []
    const state: Record<string, unknown> = {}
    const ctx = new Proxy(state, {
      get(o, k: string) {
        if (k === 'measureText') return (t: string) => ({ width: t.length * 10 })
        if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} })
        if (k === 'fillText' || k === 'strokeText')
          return (t: string) => {
            ops.push(`${k}:${t}:blur=${Number(o.shadowBlur ?? 0)}`)
          }
        if (k === 'setTransform')
          return (...a: number[]) => {
            ops.push(`setTransform:${a.join(',')}`)
          }
        if (k in o) return o[k]
        return () => {}
      },
      set(o, k: string, v) {
        o[k] = v
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    const rec: Rec = { w, h, ops, state, ctx }
    made.push(rec)
    return { canvas: { w, h } as unknown as CanvasImageSource, ctx }
  }
  return { make, made }
}

interface Blit {
  w: number
  h: number
  x: number
  y: number
  dw: number
  dh: number
}

function target(): { ctx: CanvasRenderingContext2D; blits: Blit[] } {
  const blits: Blit[] = []
  const ctx = {
    drawImage(src: { w: number; h: number }, x: number, y: number, dw: number, dh: number) {
      blits.push({ w: src.w, h: src.h, x, y, dw, dh })
    },
  } as unknown as CanvasRenderingContext2D
  return { ctx, blits }
}

const ready = (): boolean => true

test('数字字形图集：每个字符 × 每个外观只预渲染一次，之后只做 drawImage', () => {
  const s = surfaces()
  const font = new NumberFont(NUM_LOOKS, s.make, ready)
  const t = target()
  font.draw(t.ctx, '1234', 1, 0, 0, 13, 2)
  const built = s.made.length
  assert.equal(font.glyphCount, 4)
  assert.equal(t.blits.length, 4)
  // 再画含重复字符的串：不应再创建任何画布
  font.draw(t.ctx, '1221', 1, 0, 0, 13, 2)
  assert.equal(s.made.length, built, '命中缓存，不再创建画布')
  assert.equal(font.glyphCount, 4)
  assert.equal(t.blits.length, 8)
  // 换一个外观：重新预渲染
  font.draw(t.ctx, '12', 4, 0, 0, 23, 2)
  assert.equal(font.glyphCount, 6)
})

test('数字字形图集：整串在 x 处水平居中，字符按步进依次排开', () => {
  const s = surfaces()
  const font = new NumberFont(NUM_LOOKS, s.make, ready)
  const t = target()
  font.draw(t.ctx, '1.5k', 1, 100, 50, 13, 2)
  assert.equal(t.blits.length, 4)
  const xs = t.blits.map((b) => b.x + 0) // 起点（含字形内边距）
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2] && xs[2] < xs[3], '从左到右排开')
  // 整串的左右边界关于 x 对称：首字形起点到 x 的距离 ≈ x 到末字形终点的距离（内边距对称）
  const first = t.blits[0]
  const last = t.blits[3]
  const left = 100 - first.x
  const right = last.x + last.dw - 100
  assert.ok(Math.abs(left - right) < 0.5, `左右应对称：${left} vs ${right}`)
  // 垂直方向：字形画布的中线对齐 y
  for (const b of t.blits) assert.ok(Math.abs(b.y + b.dh / 2 - 50) < 0.5)
})

test('数字字形图集：字号变化只改变绘制尺寸，不重建图集', () => {
  const s = surfaces()
  const font = new NumberFont(NUM_LOOKS, s.make, ready)
  const t = target()
  font.draw(t.ctx, '88', 3, 0, 0, 19, 2)
  const built = s.made.length
  font.draw(t.ctx, '88', 3, 0, 0, 19 * 2, 2) // 弹出瞬间放大 2 倍
  assert.equal(s.made.length, built)
  assert.ok(Math.abs(t.blits[2].dw / t.blits[0].dw - 2) < 1e-6, '绘制宽度随字号线性放大')
})

test('数字字形图集：屏幕缩放变化很大时图集失效并以新分辨率重建，小幅变化不重建', () => {
  const s = surfaces()
  const font = new NumberFont(NUM_LOOKS, s.make, ready)
  const t = target()
  font.draw(t.ctx, '7', 2, 0, 0, 15, 1)
  const small = s.made[s.made.length - 1]
  const built = s.made.length
  font.draw(t.ctx, '7', 2, 0, 0, 15, 1.1) // 小幅变化（缩放抖动）：沿用
  assert.equal(s.made.length, built)
  font.draw(t.ctx, '7', 2, 0, 0, 15, 3) // 放大 3 倍（DPR / 窗口变化）：重建
  assert.ok(s.made.length > built)
  const big = s.made[s.made.length - 1]
  assert.ok(big.h > small.h * 2, `新图集分辨率应明显更高：${big.h} vs ${small.h}`)
})

test('数字字形图集：字体未就绪时不预渲染也不缓存（避免把后备字体的字形永远缓存下来）', () => {
  const s = surfaces()
  let ok = false
  const font = new NumberFont(NUM_LOOKS, s.make, () => ok)
  const t = target()
  const before = s.made.length // 构造时会建一个测量用画布
  font.draw(t.ctx, '123', 2, 0, 0, 15, 2)
  assert.equal(t.blits.length, 0)
  assert.equal(s.made.length, before)
  assert.equal(font.glyphCount, 0)
  ok = true
  font.draw(t.ctx, '123', 2, 0, 0, 15, 2)
  assert.equal(t.blits.length, 3)
  assert.equal(font.glyphCount, 3)
})

test('数字字形图集：未知外观下标安全地什么都不画', () => {
  const s = surfaces()
  const font = new NumberFont(NUM_LOOKS, s.make, ready)
  const t = target()
  font.draw(t.ctx, '5', 99, 0, 0, 15, 2)
  assert.equal(t.blits.length, 0)
})

test('数字字形的画法：有光晕的外观先画柔光再画描边和字面，且光晕只在预渲染时用 shadowBlur 并复位', () => {
  const s = surfaces()
  const font = new NumberFont(NUM_LOOKS, s.make, ready)
  const t = target()
  // 外观 5（红色重击）：有光晕、斜体、高光
  font.draw(t.ctx, '9', 5, 0, 0, 28, 2)
  const g = s.made[s.made.length - 1]
  const fills = g.ops.filter((o) => o.startsWith('fillText'))
  const strokes = g.ops.filter((o) => o.startsWith('strokeText'))
  assert.equal(strokes.length, 1, '一层暗描边')
  assert.equal(fills.length, 3, '光晕 ×1（贴边的一圈，克制）+ 字面 + 顶部高光')
  assert.ok(Number(fills[0].split('blur=')[1]) > 0, '光晕层带 shadowBlur')
  assert.equal(Number(fills[2].split('blur=')[1]), 0, '字面与高光层不带 shadowBlur')
  assert.equal(g.state.shadowBlur, 0)
  assert.equal(g.state.shadowColor, 'transparent')
  assert.equal(g.state.globalAlpha, 1)
  assert.ok(g.ops.some((o) => o.startsWith('setTransform:1,0,-')), '斜体：错切变换')
  assert.equal(g.ops[g.ops.length - 1], 'setTransform:1,0,0,1,0,0', '画完把变换复位')
})

test('数字字形的画法：低档位是中性的"无光晕、无斜体、无高光"，只有描边 + 渐变字面', () => {
  const s = surfaces()
  const font = new NumberFont(NUM_LOOKS, s.make, ready)
  const t = target()
  font.draw(t.ctx, '9', 0, 0, 0, 11, 2)
  const g = s.made[s.made.length - 1]
  assert.equal(g.ops.filter((o) => o.startsWith('fillText')).length, 1, '只有字面一层')
  assert.equal(g.ops.filter((o) => o.startsWith('strokeText')).length, 1)
  assert.ok(g.ops.every((o) => !o.startsWith('setTransform:1,0,-')), '正体不错切')
})

test('数字外观表：层级单调递进（越重的击打越亮、越斜、光晕越大），低档位克制', () => {
  // 0..7 是伤害档位，最后一个是受伤数字（单独的一套）
  const dmg = NUM_LOOKS.slice(0, 8)
  for (let i = 1; i < dmg.length; i++) {
    assert.ok(dmg[i].size > dmg[i - 1].size, `字号递增 @${i}`)
    assert.ok(dmg[i].glowK >= dmg[i - 1].glowK, `光晕不减 @${i}`)
    assert.ok(dmg[i].skew >= dmg[i - 1].skew, `斜度不减 @${i}`)
    assert.ok(dmg[i].gloss >= dmg[i - 1].gloss, `高光不减 @${i}`)
  }
  assert.equal(dmg[0].glowK, 0, '最低档无光晕')
  assert.equal(dmg[1].glowK, 0, '次低档无光晕')
  assert.ok(dmg[7].glowK > dmg[2].glowK, '顶档光晕明显更大')
  // 每档的字面渐变（顶/中/底）互不相同，保证相邻档位看得出区别
  const sig = new Set(dmg.map((l) => `${l.top}|${l.mid}|${l.bot}`))
  assert.equal(sig.size, dmg.length)
  // 受伤数字有自己的外观
  const hurt = NUM_LOOKS[8]
  assert.ok(hurt.glow !== '' && hurt.glowK > 0)
  assert.ok(!dmg.some((l) => l.mid === hurt.mid), '受伤数字的颜色不与任何伤害档位重复')
})

test('数字外观表：所有颜色都是 6 位十六进制（图集里要拆成 rgba 用）', () => {
  const hex = /^#[0-9a-f]{6}$/i
  for (const l of NUM_LOOKS) {
    assert.match(l.top, hex)
    assert.match(l.mid, hex)
    assert.match(l.bot, hex)
    if (l.glow) assert.match(l.glow, hex)
  }
})
