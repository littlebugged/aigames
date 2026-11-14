import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/**
 * 战斗 HUD 的板是纯 CSS + 一点 DOM 结构，Node 里看不到画面。这里守的是"几处必须同步改的地方有没有漏"：
 *  ① 钢板套件的 `:is(...)` 选择器列表在 main.css 里重复了好几遍，漏改一处就会得到"有的伪元素有、有的没有"的半成品板；
 *  ② 镂空外框（给半透明的板用）列表里的类名必须都是套件成员，否则它的 ::before 根本没有定位和底色；
 *  ③ 血条 / Boss 血条的填充条必须包在 `.bar-in` 里（CSS 靠它裁出同样的切角）；
 *  ④ 多边形的顶点数没写坏（少一个点画面上只是"有一条边歪了"，很难一眼看出来）。
 * 画面好不好看，用 `node scripts/e2e.mjs hud` 截图看。
 */
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
const hudSrc = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8')

/** 套件的 :is(...) 列表：以 `.btn, .card` 开头的那些（焦点环的列表是 `.btn, button.card`，不会混进来） */
function kitLists(): string[][] {
  const out: string[][] = []
  const re = /:is\((\.btn, \.card[^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) out.push(m[1].split(',').map((x) => x.trim()))
  return out
}

/** 取某条规则（从选择器开头到第一个 `}`）里 `clip-path: polygon(...)` 的顶点个数；找不到规则返回 -1 */
function polygonPoints(selector: string, prop = 'clip-path'): number {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) return -1
  const body = css.slice(at, css.indexOf('}', at))
  const m = new RegExp(`${prop}:\\s*polygon\\(([^;]*?)\\);`, 's').exec(body)
  if (!m) return -1
  return m[1]
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && x !== 'evenodd').length
}

test('钢板套件：每一处 :is() 列表完全一致（改一处必须改全）', () => {
  const lists = kitLists()
  assert.ok(lists.length >= 4, `只找到 ${lists.length} 处套件列表`)
  const first = lists[0].join(',')
  lists.forEach((l, i) => assert.equal(l.join(','), first, `第 ${i + 1} 处套件列表与第 1 处不一致`))
})

test('半透明的板：镂空外框列表里的类名都在套件里（暂停键是 .btn，由 .btn 带入）', () => {
  const kit = new Set(kitLists()[0])
  const m = /:is\((\.slot, [^)]*)\)::before \{/.exec(css)
  assert.ok(m, '找不到镂空外框那条规则')
  const ring = m![1].split(',').map((x) => x.trim())
  const viaBtn = new Set(['.hud-pause'])
  for (const sel of ring) assert.ok(kit.has(sel) || viaBtn.has(sel), `${sel} 要镂空外框，却不在钢板套件里`)
  // HUD 里确实在用的几种板都得在
  for (const sel of ['.slot', '.toast', '.hint', '.hp-bar', '.boss-track', '.need']) {
    assert.ok(ring.includes(sel), `${sel} 缺少镂空外框`)
    assert.ok(kit.has(sel), `${sel} 缺少钢板套件`)
  }
})

test('血条：HP 与 Boss 的填充条都包在 .bar-in 里，CSS 里有 .bar-in 的切角裁剪', () => {
  assert.equal((hudSrc.match(/class: 'bar-in'/g) ?? []).length, 2, 'hud.ts 里应有两处 .bar-in（血条、Boss 血条）')
  assert.ok(/\.bar-in \{[^}]*clip-path: polygon\(/s.test(css), '.bar-in 没有切角裁剪')
})

test('多边形：外框环、聚焦环、八边形、摇杆环的顶点数没写坏', () => {
  // 环 = 外轮廓 6 点 + 回到起点 1 + 内轮廓 6 点 + 回到起点 1
  const glass = /:is\(\.slot, [^)]*\)::before \{[^}]*clip-path: polygon\(([^;]*?)\);/s.exec(css)
  assert.ok(glass, '找不到镂空外框的 clip-path')
  assert.equal(glass![1].split(',').filter((x) => x.trim() && x.trim() !== 'evenodd').length, 14, '镂空外框应有 14 个点')
  // 正八边形 8 点；摇杆底盘的环 = 8 + 1 + 8 + 1
  const oct = /--oct:\s*polygon\(([^;]*?)\);/s.exec(css)
  assert.ok(oct, '找不到 --oct')
  assert.equal(oct![1].split(',').length, 8, '--oct 应是 8 个点')
  assert.equal(polygonPoints('.joy-base::before'), 18, '摇杆底盘的环应有 18 个点')
})
