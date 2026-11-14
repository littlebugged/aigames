import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PASSIVE_IDS, WEAPON_IDS } from '../src/data/ids'
import { PASSIVE_ICON, UI_ICON, WEAPON_ICON, passiveIcon, uiIcon, weaponIcon, type UiIconName } from '../src/ui/icons'

/**
 * 图标是字符串拼出来的 SVG，没有浏览器可以看。这里守的是"结构 + 风格"两类回归：
 *  · 结构：覆盖全、标签配对、数字有限、只用允许的元素 / 属性 / 颜色写法；
 *  · 风格：物件图标（武器 / 被动）必须是"墨线描边 + 多层明暗"的硬表面造型，不能退回单线条轮廓；
 *    功能图标（UI）必须是跟随文字色的实心符号，不能带固定颜色或描边。
 * 画面是否越界 / 偏心 / 好不好看，用 `npm run icons -- --check` 在无头浏览器里量。
 */

type Kind = 'weapon' | 'passive' | 'ui'
interface Icon {
  kind: Kind
  id: string
  /** 完整 <svg> 标记（和页面里实际出现的一模一样） */
  svg: string
  /** 只有图元的部分 */
  inner: string
  size: 32 | 24
}

const UI_NAMES = Object.keys(UI_ICON) as UiIconName[]

const ICONS: Icon[] = [
  ...WEAPON_IDS.map((id): Icon => ({ kind: 'weapon', id, svg: weaponIcon(id, 'probe'), inner: WEAPON_ICON[id], size: 32 })),
  ...PASSIVE_IDS.map((id): Icon => ({ kind: 'passive', id, svg: passiveIcon(id, 'probe'), inner: PASSIVE_ICON[id], size: 32 })),
  ...UI_NAMES.map((id): Icon => ({ kind: 'ui', id, svg: uiIcon(id, 'probe'), inner: UI_ICON[id], size: 24 })),
]
const OBJECTS = ICONS.filter((i) => i.kind !== 'ui')
const UIS = ICONS.filter((i) => i.kind === 'ui')

const label = (i: Icon): string => `${i.kind}:${i.id}`
const count = (s: string, re: RegExp): number => s.match(re)?.length ?? 0

test('覆盖：每个武器 / 被动都有图标，且没有多余的', () => {
  assert.deepEqual(Object.keys(WEAPON_ICON).sort(), [...WEAPON_IDS].sort())
  assert.deepEqual(Object.keys(PASSIVE_ICON).sort(), [...PASSIVE_IDS].sort())
  assert.ok(UI_NAMES.length >= 25, `功能图标数量异常：${UI_NAMES.length}`)
})

test('外壳：画布尺寸、类名、无障碍标记、通用绘制属性', () => {
  for (const i of ICONS) {
    const root = /^<svg ([^>]*)>/.exec(i.svg)
    assert.ok(root, `${label(i)} 没有 <svg> 根`)
    const attrs = root![1]
    assert.match(attrs, /class="ico probe"/, `${label(i)} class`)
    assert.ok(attrs.includes(`viewBox="0 0 ${i.size} ${i.size}"`), `${label(i)} viewBox 应为 ${i.size}`)
    assert.ok(attrs.includes('aria-hidden="true"'), `${label(i)} 应是装饰性图标（aria-hidden）`)
    assert.ok(attrs.includes('fill="currentColor"'), `${label(i)} 默认填充应跟随文字色`)
    assert.ok(i.svg.endsWith('</svg>'), `${label(i)} 没有闭合`)
  }
})

test('结构：只有 path / g，标签配对，属性在白名单内', () => {
  const ALLOWED_ATTRS: Record<string, string[]> = {
    path: ['d', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'paint-order', 'transform'],
    g: ['transform'],
  }
  for (const i of ICONS) {
    const stack: string[] = []
    for (const m of i.inner.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
      const [, closing, name, rest, selfClose] = m
      assert.ok(name in ALLOWED_ATTRS, `${label(i)} 出现了不允许的元素 <${name}>`)
      if (closing) {
        assert.equal(stack.pop(), name, `${label(i)} 标签没有配对：</${name}>`)
        continue
      }
      for (const a of rest.matchAll(/\s([a-z-]+)="/g)) {
        assert.ok(ALLOWED_ATTRS[name].includes(a[1]), `${label(i)} <${name}> 出现了不允许的属性 ${a[1]}`)
      }
      if (name === 'path') assert.ok(selfClose, `${label(i)} <path> 应自闭合`)
      else if (!selfClose) stack.push(name)
    }
    assert.equal(stack.length, 0, `${label(i)} 有未闭合的标签：${stack.join(',')}`)
    assert.ok(count(i.inner, /<path /g) >= 1, `${label(i)} 一个图元都没有`)
  }
})

test('数字：所有坐标 / 变换都是有限数，没有 NaN / undefined 混进去', () => {
  for (const i of ICONS) {
    assert.doesNotMatch(i.svg, /NaN|undefined|Infinity|null|\[object/, `${label(i)} 含有非法字面量`)
    for (const m of i.inner.matchAll(/\b(?:d|transform)="([^"]*)"/g)) {
      for (const n of m[1].matchAll(/-?\d*\.?\d+(?:e-?\d+)?/g)) assert.ok(Number.isFinite(Number(n[0])), `${label(i)} 数字非法：${n[0]}`)
    }
    // 路径必须以 M 起笔，且每个子路径都闭合或显式是线条
    for (const m of i.inner.matchAll(/<path d="([^"]*)"/g)) assert.match(m[1], /^M-?\d/, `${label(i)} 路径应以 M 起笔：${m[1].slice(0, 30)}`)
  }
})

test('颜色：只写十六进制 / currentColor / none，不写零散的命名色', () => {
  for (const i of ICONS) {
    for (const m of i.inner.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)) {
      assert.match(m[1], /^(?:currentColor|none|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/, `${label(i)} 颜色写法不规范：${m[1]}`)
    }
    for (const m of i.inner.matchAll(/(?:fill|stroke)-opacity="([^"]+)"/g)) {
      const v = Number(m[1])
      assert.ok(v > 0 && v <= 1, `${label(i)} 透明度无效（0 的叠层是死代码，越界也不行）：${m[1]}`)
    }
  }
})

test('物件图标（武器 / 被动）：墨线描边 + 多层明暗 + 跟随主题色，不能退回单线条', () => {
  for (const i of OBJECTS) {
    const paths = count(i.inner, /<path /g)
    const outlined = count(i.inner, /stroke="#04060d"[^>]*paint-order="stroke"/g)
    const ink = count(i.inner, /stroke="#04060d"/g)
    const tones = new Set<string>()
    for (const m of i.inner.matchAll(/<path [^>]*>/g)) {
      const fill = /fill="([^"]+)"/.exec(m[0])?.[1] ?? 'currentColor'
      if (fill === 'none') continue
      tones.add(`${fill}@${/fill-opacity="([^"]+)"/.exec(m[0])?.[1] ?? '1'}`)
    }
    assert.ok(paths >= 5, `${label(i)} 图元太少（${paths}），像是简笔画`)
    assert.ok(outlined >= 1, `${label(i)} 没有墨线描边的实体块`)
    assert.ok(ink >= outlined, `${label(i)} 墨线统计异常`)
    assert.ok(tones.size >= 3, `${label(i)} 只有 ${tones.size} 种色调，缺少暗面 / 高光`)
    // 主色必须跟随 currentColor（默认填充，或显式 currentColor），这样 HUD / 升级卡里才会按武器色变色
    const themed = /fill="currentColor"|stroke="currentColor"|<path (?![^>]*\bfill=)/.test(i.inner)
    assert.ok(themed, `${label(i)} 没有任何元素跟随主题色`)
    // 至少有一层黑 / 白半透明叠层（立体感的来源）
    assert.ok(/fill="#(?:000|fff)" fill-opacity="/.test(i.inner), `${label(i)} 缺少明暗叠层`)
  }
})

test('功能图标（UI）：实心双色符号，颜色全部跟随文字色，不带描边', () => {
  for (const i of UIS) {
    assert.doesNotMatch(i.inner, /paint-order/, `${label(i)} 功能图标不该用墨线描边`)
    for (const m of i.inner.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)) {
      assert.ok(['currentColor', 'none', '#000', '#fff'].includes(m[1]), `${label(i)} 功能图标写死了颜色 ${m[1]}，应跟随文字色`)
    }
  }
})

test('各不相同：任意两个图标的图元都不一样', () => {
  const seen = new Map<string, string>()
  for (const i of ICONS) {
    const prev = seen.get(i.inner)
    assert.equal(prev, undefined, `${label(i)} 和 ${prev} 画得一模一样`)
    seen.set(i.inner, label(i))
  }
})

test('体积：单个图标和整套图标都不能膨胀（它们会被内联进每个页面）', () => {
  for (const i of OBJECTS) assert.ok(i.inner.length <= 6000, `${label(i)} 太大：${i.inner.length} 字节`)
  for (const i of UIS) assert.ok(i.inner.length <= 2500, `${label(i)} 太大：${i.inner.length} 字节`)
  const total = ICONS.reduce((a, i) => a + i.inner.length, 0)
  assert.ok(total <= 80_000, `整套图标 ${total} 字节，超出预算`)
})

test('小数位：坐标统一保留两位以内，避免浮点噪声撑大体积', () => {
  for (const i of ICONS) {
    const bad = /\d+\.\d{3,}/.exec(i.inner)
    assert.equal(bad, null, `${label(i)} 有过长的小数：${bad?.[0]}`)
  }
})
