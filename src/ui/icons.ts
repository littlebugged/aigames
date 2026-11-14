import type { PassiveId, WeaponId } from '../data/ids'

/**
 * 内联 SVG 图标。只返回字符串，不碰 DOM，所以 Node 里生成静态页面时也能用。
 *
 * 两套语言，都和局内的"哑光硬表面"精灵保持同一个方向：
 *  · 物件图标（武器 / 被动，32×32 网格）——每个都是一个能认出来的小物件：
 *    墨线描边（和局内精灵同一个墨色）+ 底色 + 暗面 + 高光，钢件与强调色分开。
 *    主色取 currentColor（外层 CSS 的 color），暗面 / 高光是黑白半透明叠层，所以任何主色都自带明暗。
 *    光源固定在左上；小尺寸（20px）只剩剪影与大色块，大尺寸（60px+）才露出铆钉、刻线这些细节。
 *  · 功能图标（UI，24×24 网格）——实心双色符号：主体 currentColor，暗面叠层给一点体积，不描边，
 *    几何统一（圆角、笔画粗细、留白一致）。
 *
 * 调图标的流程：`npm run icons` 出样张（大图 + 真实使用尺寸，`--only weapons,ui` / `--ids a,b` 只看一部分）；
 * `npm run icons -- --check` 在无头浏览器里量每个图标的实际绘制范围，越界（被裁掉）会报错退出；
 * `tests/icons.test.ts` 守结构与风格（墨线 + 多层明暗 + 跟随主题色，不许退回单线条）。
 * 只用 <path> 与 <g>：颜色只写 currentColor / 十六进制，暗面与高光一律是黑白半透明叠层。
 */

// ───────────────────────── 绘制工具 ─────────────────────────

const INK = '#04060d'
const DARK = '#0b1020'
const STEEL = { hi: '#e3eaf7', lt: '#bcc7dd', md: '#8a96b1', dk: '#586280', xd: '#2b3249' }
const HOT = '#ff9b3d'
const FIRE = '#ffd84a'

const num = (v: number): string => String(Math.round(v * 100) / 100)
const rad = (deg: number): number => (deg * Math.PI) / 180
const pt = (cx: number, cy: number, r: number, deg: number): [number, number] => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))]
const xy = (p: [number, number]): string => `${num(p[0])} ${num(p[1])}`

/** 多边形：poly(x1, y1, x2, y2, …) */
const poly = (...v: number[]): string => {
  let d = ''
  for (let i = 0; i < v.length; i += 2) d += `${i ? 'L' : 'M'}${num(v[i])} ${num(v[i + 1])}`
  return `${d}Z`
}

const circ = (cx: number, cy: number, r: number): string =>
  `M${num(cx - r)} ${num(cy)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0Z`

const rrect = (x: number, y: number, w: number, h: number, r = 0): string => {
  if (r <= 0) return poly(x, y, x + w, y, x + w, y + h, x, y + h)
  return (
    `M${num(x + r)} ${num(y)}H${num(x + w - r)}A${num(r)} ${num(r)} 0 0 1 ${num(x + w)} ${num(y + r)}` +
    `V${num(y + h - r)}A${num(r)} ${num(r)} 0 0 1 ${num(x + w - r)} ${num(y + h)}` +
    `H${num(x + r)}A${num(r)} ${num(r)} 0 0 1 ${num(x)} ${num(y + h - r)}` +
    `V${num(y + r)}A${num(r)} ${num(r)} 0 0 1 ${num(x + r)} ${num(y)}Z`
  )
}

/** 圆弧（顺时针，a0 → a1，角度制，0° 指向右、90° 指向下） */
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): string => {
  const span = (((a1 - a0) % 360) + 360) % 360
  return `M${xy(pt(cx, cy, r, a0))}A${num(r)} ${num(r)} 0 ${span > 180 ? 1 : 0} 1 ${xy(pt(cx, cy, r, a1))}`
}

/** 星形 / 齿形：外半径 rOut、内半径 rIn、n 个尖 */
const star = (cx: number, cy: number, rOut: number, rIn: number, n: number, rot = -90): string => {
  const v: number[] = []
  for (let i = 0; i < n * 2; i++) {
    const [x, y] = pt(cx, cy, i % 2 ? rIn : rOut, rot + (i * 180) / n)
    v.push(x, y)
  }
  return poly(...v)
}

/** 不规则爆闪星：每个尖的半径各不相同（rays），谷半径 rIn */
const burst = (cx: number, cy: number, rays: number[], rIn: number, rot = -90): { d: string; facets: string } => {
  const n = rays.length
  const v: number[] = []
  let facets = ''
  rays.forEach((r, i) => {
    const a = rot + (i * 360) / n
    const tip = pt(cx, cy, r, a)
    const valley = pt(cx, cy, rIn, a + 180 / n)
    const before = pt(cx, cy, rIn, a - 180 / n)
    v.push(before[0], before[1], tip[0], tip[1])
    facets += `M${num(cx)} ${num(cy)}L${xy(tip)}L${xy(valley)}Z`
  })
  return { d: poly(...v), facets }
}

/** 星形每个尖的顺时针半面（压暗后得到一圈刻面，和 star() 的参数一一对应） */
const starFacets = (cx: number, cy: number, rOut: number, rIn: number, n: number, rot = -90): string => {
  let d = ''
  for (let i = 0; i < n; i++) {
    const tip = pt(cx, cy, rOut, rot + (i * 360) / n)
    const valley = pt(cx, cy, rIn, rot + (i * 360) / n + 180 / n)
    d += `M${num(cx)} ${num(cy)}L${xy(tip)}L${xy(valley)}Z`
  }
  return d
}

/** 圆体的暗面：圆 (cx,cy,r) 里去掉一个朝左上偏移 off 的同半径圆，剩下右下的月牙 */
const crescent = (cx: number, cy: number, r: number, off: number): string => {
  const o = off / Math.SQRT2
  const mx = cx - o / 2
  const my = cy - o / 2
  const d = Math.hypot(o, o)
  const h = Math.sqrt(Math.max(r * r - (d / 2) * (d / 2), 0))
  const px = h / Math.SQRT2
  const p1 = `${num(mx + px)} ${num(my - px)}`
  const p2 = `${num(mx - px)} ${num(my + px)}`
  return `M${p1}A${num(r)} ${num(r)} 0 0 1 ${p2}A${num(r)} ${num(r)} 0 0 0 ${p1}Z`
}

const OW = 3 // 墨线描边宽度（外侧可见一半）

/** 带墨线的实体块：描边先画、填充后画，只露出外侧一半，轮廓总是利落；块与块叠放时自然出现压边线 */
const body = (d: string, fill = 'currentColor', w = OW): string =>
  `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${w}" paint-order="stroke"/>`
/** 暗面 / 高光：黑白半透明叠层，不描边 */
const shade = (d: string, a = 0.3): string => `<path d="${d}" fill="#000" fill-opacity="${a}"/>`
const light = (d: string, a = 0.45): string => `<path d="${d}" fill="#fff" fill-opacity="${a}"/>`
const flat = (d: string, fill: string, a = 1): string => `<path d="${d}" fill="${fill}"${a < 1 ? ` fill-opacity="${a}"` : ''}/>`
/** 线条（不填充）：墨线打底 + 色线压上 */
const line = (d: string, w: number, stroke = INK, a = 1): string =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}"${a < 1 ? ` stroke-opacity="${a}"` : ''}/>`
const tube = (d: string, w: number, stroke = 'currentColor', a = 1): string => line(d, w + 2.4, INK) + line(d, w, stroke, a)
const g = (tf: string, ...inner: string[]): string => `<g transform="${tf}">${inner.join('')}</g>`
const all = (...inner: string[]): string => inner.join('')
/** 把一组图元以 (cx, cy) 为中心缩放 k 倍后放到画布正中（画布 32×32）；用 `npm run icons -- --check` 量出的绘制范围来取 (cx, cy) */
const fit = (cx: number, cy: number, k: number, ...inner: string[]): string => g(`translate(16 16) scale(${k}) translate(${num(-cx)} ${num(-cy)})`, ...inner)

// ───────────────────────── 武器（32×32） ─────────────────────────

/** 朝右的叶形光弹：尾尖 (0,0)，头尖 (len,0)，最宽处在 28% 位置 */
const leaf = (len: number, w: number): string =>
  `M0 0L${num(len * 0.28)} ${num(-w / 2)}Q${num(len * 0.8)} ${num(-w / 2)} ${num(len)} 0Q${num(len * 0.8)} ${num(w / 2)} ${num(len * 0.28)} ${num(w / 2)}Z`

/** 回旋飞轮的风车刃：谷在 i*45-12°，尖在 i*45+10° */
const pinwheel = (cx: number, cy: number, rOut: number, rIn: number): { d: string; tris: string[] } => {
  const v: number[] = []
  const tris: string[] = []
  for (let i = 0; i < 8; i++) {
    const tip = pt(cx, cy, rOut, i * 45 + 12)
    const valley = pt(cx, cy, rIn, i * 45 - 12)
    const next = pt(cx, cy, rIn, (i + 1) * 45 - 12)
    v.push(valley[0], valley[1], tip[0], tip[1])
    tris.push(poly(tip[0], tip[1], next[0], next[1], (valley[0] + next[0]) / 2, (valley[1] + next[1]) / 2))
  }
  return { d: poly(...v), tris }
}
const WHEEL = pinwheel(16, 16, 14.4, 8.4)

/** 冲击波中心的爆闪：10 个长短不一的尖 */
const NOVA_BURST = burst(16, 16, [10.6, 7.4, 9.4, 6.8, 10.8, 7.6, 9.6, 7.0, 10.2, 7.2], 4.4, -84)

const BOLT = 'M19.8 1.8L7.6 17.6H14.2L11.2 30.4L24.6 12.8H17.8Z'

/**
 * 沿圆轨道公转的弯刀：刀尾在 tailDeg，顺时针扫过 span 度收成锐尖；刀柄从刀尾向逆时针方向伸出（与局内的环绕刃精灵同一个造型）。
 * 返回 [刀身, 刀柄] 两段，调用方分别叠放，刀身在下、刀柄在上。
 */
const scimitar = (cx: number, cy: number, R: number, thick: number, tailDeg: number, span: number): [string, string] => {
  const out0 = pt(cx, cy, R, tailDeg)
  const out1 = pt(cx, cy, R, tailDeg + span)
  const in0 = pt(cx, cy, R - thick, tailDeg)
  const edge = `M${xy(out0)}A${num(R)} ${num(R)} 0 0 1 ${xy(out1)}A${num(R * 1.16)} ${num(R * 1.16)} 0 0 0 ${xy(in0)}Z`
  const blade = all(
    body(edge, 'currentColor', 2.4),
    shade(`M${xy(pt(cx, cy, R - thick * 0.5, tailDeg + 4))}A${num(R - thick * 0.5)} ${num(R - thick * 0.5)} 0 0 1 ${xy(out1)}A${num(R * 1.16)} ${num(R * 1.16)} 0 0 0 ${xy(in0)}Z`, 0.26),
    line(arc(cx, cy, R - 0.9, tailDeg + 10, tailDeg + span - 14), 1.1, '#fff', 0.8),
  )
  const base = pt(cx, cy, R - thick / 2, tailDeg)
  const hilt = g(
    `translate(${xy(base)}) rotate(${num(tailDeg + 90)})`,
    body(rrect(-6.6, -1.1, 5.6, 2.2, 1), STEEL.dk, 2),
    body(circ(-7, 0, 1.7), STEEL.lt, 1.8),
    body(rrect(-1.4, -thick / 2 - 1.5, 2.6, thick + 3, 1), STEEL.lt, 2),
    light(rrect(-0.9, -thick / 2 - 1, 0.9, thick + 2, 0.4), 0.6),
  )
  return [blade, hilt]
}

export const WEAPON_ICON: Record<WeaponId, string> = {
  // 脉冲炮：斜指右上的钢制炮管 + 彩色炮口环，连射出由小到大的三发叶形光弹
  pulse: g(
    'translate(17.3 14.6) rotate(-42) translate(-1.3 0)',
    ...[
      [-6.4, 6.4, 3.8],
      [1.2, 7.8, 5],
      [9.4, 9.4, 6.6],
    ].map(([x, len, w]) =>
      g(`translate(${x} 0)`, body(leaf(len, w), 'currentColor', 2.2), shade(`M${num(len * 0.28)} 0L${num(len)} 0Q${num(len * 0.8)} ${num(w / 2)} ${num(len * 0.28)} ${num(w / 2)}Z`, 0.24), flat(leaf(len * 0.7, w * 0.32), '#fff')),
    ),
    body(rrect(-16.4, -4.6, 9.4, 9.2, 2), STEEL.md),
    light(rrect(-15.4, -3.6, 7.4, 1.8, 0.9), 0.5),
    shade(rrect(-16.4, 0.6, 9.4, 4, 2), 0.28),
    body(rrect(-9.2, -5.6, 3.2, 11.2, 1.2)),
    shade(rrect(-7.6, -4.6, 1.6, 9.2, 0.7), 0.3),
  ),

  // 环绕刃：两把弯刀沿着轨道首尾追逐（造型取自局内的环绕刃），中央是被保护的核心
  orbit: all(
    line(circ(16, 16, 10), 1.2, 'currentColor', 0.45),
    ...[
      [-140, 96],
      [40, 96],
    ].flatMap(([tail, span]) => scimitar(16, 16, 12.4, 4.4, tail, span)),
    body(circ(16, 16, 3.8), STEEL.md, 2.2),
    shade(crescent(16, 16, 3.8, 1.5), 0.3),
    flat(circ(16, 16, 1.7), 'currentColor'),
    flat(circ(15.5, 15.5, 0.6), '#fff', 0.9),
  ),

  // 电弧链：粗壮的闪电在两个节点之间跳跃
  arc: all(
    body(BOLT, 'currentColor', 3),
    shade('M17.8 12.8L24.6 12.8L11.2 30.4L13 20.4Z', 0.26),
    `<path d="${BOLT}" transform="translate(16.4 16.2) scale(.46) translate(-16.2 -16.1)" fill="#fff" fill-opacity=".92"/>`,
    body(circ(23.2, 5.6, 4), STEEL.xd, 2.4),
    flat(circ(23.2, 5.6, 2), 'currentColor'),
    flat(circ(22.6, 5, 0.7), '#fff', 0.9),
    body(circ(8.8, 26.4, 4), STEEL.xd, 2.4),
    flat(circ(8.8, 26.4, 2), 'currentColor'),
    flat(circ(8.2, 25.8, 0.7), '#fff', 0.9),
  ),

  // 追踪导弹：钢体 + 彩色弹头与箍带 + 尾焰
  missile: fit(
    13.9,
    18.1,
    0.96,
    g('translate(16.8 15.2) rotate(-45)',
    body(`M-9.2 -2.6Q-14.6 -1.8 -17 0Q-14.6 1.8 -9.2 2.6Z`, HOT, 2.2),
    flat(`M-9.2 -1.3Q-12.6 -0.8 -14.4 0Q-12.6 0.8 -9.2 1.3Z`, FIRE),
    body(poly(-9, -3.6, -13.6, -10.4, -6.6, -10.4, -3.4, -3.6), STEEL.dk),
    body(poly(-9, 3.6, -13.6, 10.4, -6.6, 10.4, -3.4, 3.6), STEEL.dk),
    shade(poly(-9, 3.6, -13.6, 10.4, -6.6, 10.4, -3.4, 3.6), 0.2),
    body(rrect(-9.6, -3.8, 3.6, 7.6, 1.4), STEEL.dk),
    body(rrect(-8, -4.4, 15, 8.8, 3.2), STEEL.lt),
    shade(rrect(-8, 0.9, 15, 3.5, 3.2), 0.24),
    light(rrect(-6.6, -3.5, 11.6, 1.7, 0.85), 0.6),
    body(rrect(-3.4, -4.4, 3, 8.8, 0.8)),
    body('M6.4 -4.4Q12.4 -4.2 15.6 0Q12.4 4.2 6.4 4.4Z'),
    shade('M6.4 0.6L15.6 0Q12.4 4.2 6.4 4.4Z', 0.28),
    light('M7.4 -3.2Q11.2 -3.1 13.2 -0.9Q10.4 -1.9 7.4 -1.8Z', 0.55),
    ),
  ),

  // 棱镜激光：白光射入棱镜，折成三色光束射出
  laser: fit(
    15.85,
    14.75,
    0.93,
    line('M1.6 16.6L10 16.6', 5.4, INK),
    line('M19 16.4L28.4 9.6', 5, INK),
    line('M19.4 17.2L30.4 15', 5, INK),
    line('M19 18L29.8 21', 5, INK),
    line('M1.6 16.6L10 16.6', 2.6, '#fff'),
    line('M19 16.4L28.4 9.6', 2.4, '#ff7ae0'),
    line('M19.4 17.2L30.4 15', 2.4, 'currentColor'),
    line('M19 18L29.8 21', 2.4, '#5df0ff'),
    body(poly(14.6, 3.8, 4.6, 25.6, 24.6, 25.6)),
    light(poly(14.6, 3.8, 4.6, 25.6, 14.6, 25.6), 0.32),
    shade(poly(14.6, 3.8, 24.6, 25.6, 14.6, 25.6), 0.32),
    line('M13.3 7.4L7.4 20.6', 1.5, '#fff', 0.7),
    flat(poly(14.6, 11.6, 10.6, 20.4, 18.6, 20.4), '#fff', 0.14),
  ),

  // 磁暴地雷：带刺的钢壳 + 彩色外壳 + 中央信标灯
  mine: all(
    body(star(16, 16, 14.6, 8.8, 8, -90), STEEL.md, 2.6),
    shade(starFacets(16, 16, 14.6, 8.8, 8), 0.26),
    body(circ(16, 16, 9)),
    shade(crescent(16, 16, 9, 2.6), 0.3),
    line(arc(16, 16, 6.9, -165, -108), 1.5, '#fff', 0.65),
    body(circ(16, 16, 3.8), DARK, 1.6),
    flat(circ(16, 16, 2.2), '#fff'),
    flat(circ(10.4, 16, 0.9), INK, 0.55),
    flat(circ(21.6, 16, 0.9), INK, 0.55),
    flat(circ(16, 10.4, 0.9), INK, 0.55),
    flat(circ(16, 21.6, 0.9), INK, 0.55),
  ),

  // 冲击波：白热的爆闪 + 向外扩散、被撕开缺口的冲击环
  nova: all(
    ...[-62, 28, 118, 208].map((a) => tube(arc(16, 16, 12.9, a, a + 52), 2.4, 'currentColor')),
    body(NOVA_BURST.d, '#fff', 2.4),
    shade(NOVA_BURST.facets, 0.2),
    body(circ(16, 16, 3.6), '#58d8ff', 1.6),
    flat(circ(15.2, 15.2, 1), '#fff', 0.9),
  ),

  // 僚机无人机：小型战机，机头钢灰，翼尖彩色
  drone: fit(
    12.9,
    20.15,
    0.95,
    g('translate(15.6 16.4) rotate(-40)',
    body(poly(-11, -1.7, -16, 0, -11, 1.7), HOT, 2),
    body(poly(7.4, -3, -5.8, -12.6, -11, -12.6, -6.2, -3)),
    body(poly(7.4, 3, -5.8, 12.6, -11, 12.6, -6.2, 3)),
    shade(poly(7.4, 3, -5.8, 12.6, -11, 12.6, -6.2, 3), 0.28),
    flat(poly(-5.8, -12.6, -11, -12.6, -10.2, -10.4, -6.6, -10.4), HOT),
    flat(poly(-5.8, 12.6, -11, 12.6, -10.2, 10.4, -6.6, 10.4), HOT),
    shade(poly(-5.8, 12.6, -11, 12.6, -10.2, 10.4, -6.6, 10.4), 0.2),
    body('M-11.4 0Q-8.4 -5 3 -4.2L14.4 0L3 4.2Q-8.4 5 -11.4 0Z'),
    shade('M-11.4 0Q-8.4 5 3 4.2L14.4 0Z', 0.26),
    body(poly(6.4, -3.6, 14.4, 0, 6.4, 3.6), STEEL.lt, 2),
    shade(poly(6.4, 0.2, 14.4, 0, 6.4, 3.6), 0.22),
    body('M-3.4 0Q-0.6 -3 4 0Q-0.6 3 -3.4 0Z', DARK, 1.3),
    flat('M-2 -0.4Q-0.6 -1.6 1.4 -0.4Q-0.6 -0.8 -2 -0.4Z', '#fff', 0.8),
    ),
  ),

  // 回旋飞轮：风车刃 + 钢环 + 铆钉
  chakram: all(
    body(WHEEL.d, 'currentColor', 2.6),
    ...WHEEL.tris.map((t) => shade(t, 0.28)),
    body(circ(16, 16, 6.6), STEEL.lt, 2.2),
    shade(crescent(16, 16, 6.6, 2.2), 0.24),
    body(circ(16, 16, 3.2), DARK, 1.4),
    ...[0, 60, 120, 180, 240, 300].map((a) => flat(circ(...pt(16, 16, 4.95, a + 30), 0.62), STEEL.dk)),
    line(arc(16, 16, 5.3, 200, 262), 1.3, '#fff', 0.8),
  ),

  // 磁轨炮：两条平行钢轨 + 套在轨上的通电线圈环 + 正在出膛、拖着光尾的弹体
  rail: fit(
    16.05,
    16,
    0.94,
    tube('M1.8 14.4H12', 1.4, 'currentColor', 0.9),
    tube('M1.8 17.6H10', 1.4, 'currentColor', 0.9),
    ...[7.6, 20.4].map((y) => all(body(rrect(1.6, y, 24.4, 4, 1.4), STEEL.md, 2.6), light(rrect(2.6, y + 0.7, 22.4, 1.1, 0.5), 0.55), shade(rrect(1.6, y + 2.4, 24.4, 1.6, 0.8), 0.26))),
    ...[5.2, 12].flatMap((x) =>
      [6.2, 19.4].map((y) => all(body(rrect(x, y, 3, 6.4, 1.1), 'currentColor', 2.2), shade(rrect(x + 1.6, y + 0.4, 1.4, 5.6, 0.6), 0.28), light(rrect(x + 0.5, y + 0.8, 0.8, 4.8, 0.4), 0.55))),
    ),
    body('M13.6 12.2H24.4L31 16L24.4 19.8H13.6Z', '#fff', 2.4),
    shade('M13.6 16.4H31L24.4 19.8H13.6Z', 0.16),
    flat('M23.8 12.2L31 16L23.8 19.8Z', 'currentColor'),
    shade('M23.8 16.4L31 16L23.8 19.8Z', 0.26),
  ),
}

// ───────────────────────── 被动（32×32） ─────────────────────────

const HEART =
  'M16 28.4C6.2 21.4 2.6 15.6 2.6 10.8C2.6 6.8 5.6 4.2 9.2 4.2C12.2 4.2 14.6 5.8 16 8.4C17.4 5.8 19.8 4.2 22.8 4.2C26.4 4.2 29.4 6.8 29.4 10.8C29.4 15.6 25.8 21.4 16 28.4Z'

const SHIELD = 'M16 2.8L27.6 6.6V15.4C27.6 22 22.6 26.6 16 29.6C9.4 26.6 4.4 22 4.4 15.4V6.6Z'

/** 三叶草的一片叶：心形，尖朝原点，朝 -y 方向张开 */
const CLOVER_LEAF =
  'M0 0C-2.2 -2 -6.6 -4.2 -6.6 -8C-6.6 -10.8 -4.2 -12 -2.2 -11C-1 -10.4 0 -9.2 0 -8.6C0 -9.2 1 -10.4 2.2 -11C4.2 -12 6.6 -10.8 6.6 -8C6.6 -4.2 2.2 -2 0 0Z'

/** 一发子弹，朝上，底部中心在原点 */
const BULLET_TIP = 'M0 -21.4Q3.5 -17.6 3.5 -12.4V-11H-3.5V-12.4Q-3.5 -17.6 0 -21.4Z'

export const PASSIVE_ICON: Record<PassiveId, string> = {
  // 过载核心：六边形能量核心，中间一道闪电
  power: all(
    body(poly(29.2, 16, 22.6, 27.4, 9.4, 27.4, 2.8, 16, 9.4, 4.6, 22.6, 4.6)),
    shade(poly(29.2, 16, 22.6, 27.4, 9.4, 27.4, 6.6, 20.4, 25, 20.4), 0.3),
    light(poly(2.8, 16, 9.4, 4.6, 22.6, 4.6, 21.4, 7, 10.6, 7, 5.4, 16), 0.38),
    flat(poly(25.3, 16, 20.4, 24.4, 11.6, 24.4, 6.7, 16, 11.6, 7.6, 20.4, 7.6), DARK),
    body('M17.6 8.6L11 17.6H15.4L13.8 24L21.2 14.2H16.8Z', FIRE, 1.6),
    light('M17.2 10.4L13.2 16.2H16.6Z', 0.65),
  ),

  // 速射模块：圆角模块 + 前冲的双人字箭头
  haste: all(
    body(rrect(2.8, 6, 26.4, 20, 5.2)),
    shade('M2.8 19.4H29.2V20.8A5.2 5.2 0 0 1 24 26H8A5.2 5.2 0 0 1 2.8 20.8Z', 0.3),
    light(rrect(4.6, 7.6, 22.8, 2.4, 1.2), 0.45),
    body('M7.8 11L14.2 16L7.8 21H11.6L18 16L11.6 11Z', '#fff', 1.7),
    body('M15.6 11L22 16L15.6 21H19.4L25.8 16L19.4 11Z', '#fff', 1.7),
  ),

  // 强化舱体：心形舱体 + 钢制补强板
  hull: all(
    body(HEART),
    shade('M16 28.4C25.8 21.4 29.4 15.6 29.4 10.8C29.4 6.8 26.4 4.2 22.8 4.2C19.8 4.2 17.4 5.8 16 8.4Z', 0.2),
    light('M5.2 11C5 8.4 7 6.4 9.4 6.4C11.4 6.4 12.8 7.4 14 9.2C11.6 7.8 8 8 5.2 11Z', 0.6),
    body(rrect(10.4, 11.6, 11.2, 8.4, 1.8), STEEL.lt, 2.2),
    shade(rrect(10.4, 16, 11.2, 4, 1.8), 0.22),
    flat(circ(12.8, 13.8, 0.85), STEEL.dk),
    flat(circ(19.2, 13.8, 0.85), STEEL.dk),
    flat(circ(12.8, 17.8, 0.85), STEEL.dk),
    flat(circ(19.2, 17.8, 0.85), STEEL.dk),
  ),

  // 偏转装甲：盾牌 + 内缘 + 偏转徽记
  armor: all(
    body(SHIELD),
    shade('M16 2.8L27.6 6.6V15.4C27.6 22 22.6 26.6 16 29.6Z', 0.3),
    light('M6.4 7.6L16 4.6V7.4L8.2 10Z', 0.55),
    `<path d="${SHIELD}" transform="translate(16 16.2) scale(.74) translate(-16 -16.2)" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.8"/>`,
    body('M10.4 11.4L16 16.6L21.6 11.4V15.2L16 20.4L10.4 15.2Z', '#fff', 1.6),
  ),

  // 推进器：钢制燃烧室 + 彩色箍带 + 喇叭形喷口，下面喷出三层尾焰
  thruster: all(
    body('M8.4 19.6Q16 40.4 23.6 19.6Z', HOT, 2.4),
    flat('M11 19.6Q16 33.4 21 19.6Z', FIRE),
    flat('M13.6 19.6Q16 26.8 18.4 19.6Z', '#fff'),
    body('M10.6 11.4H21.4L26.6 19.8H5.4Z', STEEL.lt),
    shade('M16 11.4H21.4L26.6 19.8H16Z', 0.26),
    light('M11.8 12.4H13.8L9 18.8H7.6Z', 0.5),
    line('M13.4 12.4L10.6 19M18.6 12.4L21.4 19', 1, INK, 0.3),
    body(rrect(9.2, 8.4, 13.6, 3.6, 1.2)),
    shade(rrect(9.2, 10.4, 13.6, 1.6, 0.8), 0.28),
    light(rrect(10.2, 9, 11.6, 1, 0.5), 0.5),
    body(rrect(10.4, 2.2, 11.2, 7, 1.8), STEEL.md),
    light(rrect(11.4, 3.2, 9.2, 1.6, 0.8), 0.5),
    shade(rrect(16, 2.2, 5.6, 7, 1.8), 0.2),
  ),

  // 磁力线圈：U 形磁铁，银色极头，臂上缠着线圈
  magnet: fit(
    16,
    14.8,
    1,
    body('M5.6 3.4H12.2V16A3.8 3.8 0 0 0 19.8 16V3.4H26.4V16A10.4 10.4 0 0 1 5.6 16Z'),
    shade('M26.4 3.4V16A10.4 10.4 0 0 1 16 26.4V19.8A3.8 3.8 0 0 0 19.8 16V3.4Z', 0.3),
    light('M7.8 5V16A8.2 8.2 0 0 0 10.4 21.8A9.2 9.2 0 0 1 7.8 16Z', 0.5),
    flat(rrect(5.6, 11.2, 6.6, 1.5, 0.7), INK, 0.4),
    flat(rrect(19.8, 11.2, 6.6, 1.5, 0.7), INK, 0.4),
    flat(rrect(5.6, 14.4, 6.6, 1.5, 0.7), INK, 0.4),
    flat(rrect(19.8, 14.4, 6.6, 1.5, 0.7), INK, 0.4),
    body(rrect(5.6, 2.8, 6.6, 6.2, 1.2), STEEL.hi, 2.4),
    body(rrect(19.8, 2.8, 6.6, 6.2, 1.2), STEEL.hi, 2.4),
    shade(rrect(9.2, 3.4, 3, 5.6, 0.8), 0.2),
    shade(rrect(23.4, 3.4, 3, 5.6, 0.8), 0.2),
  ),

  // 纳米修复：十字 + 环绕的循环箭头
  regen: all(
    tube(arc(16, 16, 13, 215, 335), 2.4),
    tube(arc(16, 16, 13, 35, 155), 2.4),
    body(poly(31, 21.4, 25.4, 21.4, 28.4, 26.8), 'currentColor', 1.8),
    body(poly(1, 10.6, 6.6, 10.6, 3.6, 5.2), 'currentColor', 1.8),
    body('M12.6 7.6H19.4V12.6H24.4V19.4H19.4V24.4H12.6V19.4H7.6V12.6H12.6Z', 'currentColor', 2.4),
    shade('M19.4 12.6H24.4V19.4H19.4V24.4H12.6V19.4H19.4Z', 0.28),
    flat('M14.8 10.4H17.2V14.8H21.6V17.2H17.2V21.6H14.8V17.2H10.4V14.8H14.8Z', '#fff'),
  ),

  // 扩散透镜：放大镜——钢圈里是带"+"的彩色镜片，镜片里的东西被放大（范围 / 体型增大）
  area: g(
    'translate(14 14)',
    g('rotate(45)', body(rrect(9.4, -2.7, 10.2, 5.4, 2.2), STEEL.dk), shade(rrect(9.4, 0, 10.2, 2.7, 1.4), 0.26), flat(rrect(14.2, -2.7, 5, 5.4, 2.2), 'currentColor'), shade(rrect(14.2, 0, 5, 2.7, 1.4), 0.28)),
    body(circ(0, 0, 10.4), STEEL.md, 2.6),
    shade(crescent(0, 0, 10.4, 2.8), 0.26),
    body(circ(0, 0, 7.6), 'currentColor', 1.6),
    shade(crescent(0, 0, 7.6, 2.6), 0.26),
    flat('M-5.6 -2.4A6.2 6.2 0 0 1 -2 -5.8A7.8 7.8 0 0 0 -5.6 -2.4Z', '#fff', 0.8),
    flat('M-1.3 -4.4H1.3V-1.3H4.4V1.3H1.3V4.4H-1.3V1.3H-4.4V-1.3H-1.3Z', '#fff', 0.95),
  ),

  // 学习芯片：带引脚的芯片，核心里是一颗经验晶体
  learning: all(
    ...[9.2, 14.8, 20.4].flatMap((p) => [
      body(rrect(p, 1.6, 2.6, 4.6, 0.9), STEEL.lt, 2),
      body(rrect(p, 25.8, 2.6, 4.6, 0.9), STEEL.lt, 2),
      body(rrect(1.6, p, 4.6, 2.6, 0.9), STEEL.lt, 2),
      body(rrect(25.8, p, 4.6, 2.6, 0.9), STEEL.lt, 2),
    ]),
    body(rrect(5.4, 5.4, 21.2, 21.2, 3.8)),
    shade('M26.6 12V22.8A3.8 3.8 0 0 1 22.8 26.6H12Z', 0.28),
    light(rrect(6.8, 6.8, 18.4, 2, 1), 0.4),
    flat(rrect(9.8, 9.8, 12.4, 12.4, 2.2), DARK),
    body(poly(16, 10.6, 20.4, 16, 16, 21.4, 11.6, 16), '#58e8ff', 1.5),
    light(poly(16, 10.6, 11.6, 16, 16, 16), 0.5),
    shade(poly(16, 16, 20.4, 16, 16, 21.4), 0.3),
  ),

  // 幸运回路：四叶草，叶面带高光
  luck: all(
    tube('M16.4 16.6Q17.4 24 23.8 28.6', 2.2, '#52d27e'),
    ...[0, 90, 180, 270].map((a) =>
      g(
        `translate(16 16) rotate(${a})`,
        body(CLOVER_LEAF, 'currentColor', 2.4),
        shade('M0 0C2.2 -2 6.6 -4.2 6.6 -8C6.6 -10.8 4.2 -12 2.2 -11C1 -10.4 0 -9.2 0 -8.6Z', 0.2),
        flat('M-4.6 -8.4C-4.6 -10 -3.4 -10.4 -2.4 -9.8C-3.4 -9.6 -4.2 -9.2 -4.6 -8.4Z', '#fff', 0.8),
      ),
    ),
    flat(circ(16, 16, 1.6), FIRE),
  ),

  // 加速线圈：仪表盘，指针打到红区
  accel: all(
    body(circ(16, 16.4, 13.4), STEEL.md, 2.6),
    shade(crescent(16, 16.4, 13.4, 3), 0.26),
    flat(circ(16, 16.4, 10.6), DARK),
    tube(arc(16, 16.4, 8, 150, 300), 2.4, 'currentColor'),
    tube(arc(16, 16.4, 8, 304, 392), 2.4, '#ff4d6d'),
    ...[150, 195, 240, 285, 330, 375].map((a) => line(`M${xy(pt(16, 16.4, 9.8, a))}L${xy(pt(16, 16.4, 10.4, a))}`, 1.2, '#fff', 0.7)),
    body('M16 14.4L24.4 9.2L18.2 18Z', '#fff', 1.6),
    body(circ(16, 16.4, 2.6), STEEL.lt, 1.8),
    flat(circ(16, 16.4, 1), 'currentColor'),
  ),

  // 多重弹仓：三发子弹从同一个支点扇形展开（弹头彩色、弹壳钢色）
  multi: fit(
    16,
    17.1,
    1,
    ...[-34, 34, 0].map((a) =>
      g(
        `translate(16 26.2) rotate(${a})`,
        body(rrect(-3.7, -12.4, 7.4, 14.2, 1), STEEL.lt, 2.2),
        shade(rrect(0.4, -12.4, 3.3, 14.2, 0.8), 0.22),
        light(rrect(-2.6, -11.4, 1, 11.6, 0.5), 0.6),
        body(BULLET_TIP, 'currentColor', 2.2),
        shade('M0 -21.4Q3.5 -17.6 3.5 -12.4V-11H0Z', 0.26),
        light('M-2.4 -15.4Q-2.2 -17.6 -0.6 -19.2Q-1.2 -16.4 -1.2 -13Z', 0.7),
      ),
    ),
    body(circ(16, 26.2, 2.6), STEEL.dk, 2),
    flat(circ(15.4, 25.6, 0.7), '#fff', 0.7),
  ),
}

// ───────────────────────── 通用 UI（24×24） ─────────────────────────

const u = (d: string, a = 1): string => `<path d="${d}"${a < 1 ? ` fill-opacity="${a}"` : ''}/>`
/** 圆润化的实心块：同色细描边把尖角磨圆 */
const ur = (d: string, w = 1.6): string => `<path d="${d}" stroke="currentColor" stroke-width="${w}"/>`
/** 带镂空的实心块（奇偶填充：子路径叠出来的部分被挖掉） */
const ue = (d: string): string => `<path d="${d}" fill-rule="evenodd"/>`
const us = (d: string, w = 2.4, a = 1): string => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}"${a < 1 ? ` stroke-opacity="${a}"` : ''}/>`
const cut = (d: string, a = 0.72): string => shade(d, a)
/** 功能图标的"放大并居中"：以 (cx, cy) 为中心缩放 k 倍后放到 24×24 画布正中 */
const ufit = (cx: number, cy: number, k: number, ...inner: string[]): string => g(`translate(12 12) scale(${k}) translate(${num(-cx)} ${num(-cy)})`, ...inner)

/** 齿轮：n 个梯形齿 */
const gear = (cx: number, cy: number, rTip: number, rRoot: number, n: number): string => {
  const v: number[] = []
  const step = 360 / n
  for (let i = 0; i < n; i++) {
    const c = i * step - 90
    for (const [r, da] of [
      [rRoot, -step * 0.5],
      [rRoot, -step * 0.29],
      [rTip, -step * 0.19],
      [rTip, step * 0.19],
      [rRoot, step * 0.29],
    ] as const) {
      const [x, y] = pt(cx, cy, r, c + da)
      v.push(x, y)
    }
  }
  return poly(...v)
}

export const UI_ICON = {
  play: ufit(
    12.7,
    12,
    1.12,
    ur('M8.6 4.8C7.6 4.2 6.4 4.9 6.4 6V18C6.4 19.1 7.6 19.8 8.6 19.2L19.4 13.2C20.4 12.6 20.4 11.4 19.4 10.8Z'),
    shade('M6.4 12H20L19.4 13.2L8.6 19.2C7.6 19.8 6.4 19.1 6.4 18Z', 0.3),
  ),
  pause: all(u(rrect(5.2, 3.4, 5, 17.2, 1.9)), u(rrect(13.8, 3.4, 5, 17.2, 1.9)), shade(rrect(8, 3.4, 2.2, 17.2, 1), 0.28), shade(rrect(16.6, 3.4, 2.2, 17.2, 1), 0.28)),
  close: us('M5 5L19 19M19 5L5 19', 3.1),
  lock: all(
    us('M8.2 11V8A3.8 3.8 0 0 1 15.8 8V11', 2.4),
    u(rrect(4.6, 10.4, 14.8, 10.6, 2.6)),
    shade(rrect(4.6, 16, 14.8, 5, 2.6), 0.22),
    cut(circ(12, 14.4, 1.7)),
    cut(poly(11.2, 15, 12.8, 15, 13.2, 18.2, 10.8, 18.2)),
  ),
  core: all(
    ur('M12 2.8L19.6 8.8L12 21.2L4.4 8.8Z', 1.2),
    light('M12 2.8L4.4 8.8H12Z', 0.42),
    shade('M12 8.8H19.6L12 21.2Z', 0.3),
    shade('M4.4 8.8H12L12 21.2Z', 0.1),
    line('M4.6 8.8H19.4', 0.9, '#000', 0.45),
  ),
  dash: all(u('M9.6 9.4V5.2L20.6 12L9.6 18.8V14.6H3.6V9.4Z'), shade('M9.6 12H20.6L9.6 18.8V14.6H3.6V12Z', 0.28), us('M3.2 5.6H7M3.2 18.4H7', 2, 0.6)),
  sound: all(
    u('M3.4 9.4H7.4L12.6 5V19L7.4 14.6H3.4Z'),
    shade('M7.4 12H12.6V19L7.4 14.6H3.4V12Z', 0.28),
    us('M15.6 9A4.2 4.2 0 0 1 15.6 15', 2.2),
    us('M18.2 6.2A8 8 0 0 1 18.2 17.8', 2.2, 0.7),
  ),
  gear: all(ue(`${gear(12, 12, 10.8, 8.2, 8)}${circ(12, 12, 3.9)}`), line(circ(12, 12, 6.1), 1.1, '#000', 0.28)),
  trophy: all(
    us('M7 5.6H4.2V7.4A3.6 3.6 0 0 0 7.8 11M17 5.6H19.8V7.4A3.6 3.6 0 0 1 16.2 11', 2),
    ur('M6.8 3.4H17.2V9.4A5.2 5.2 0 0 1 6.8 9.4Z', 1),
    shade('M12 3.4H17.2V9.4A5.2 5.2 0 0 1 12 14.6Z', 0.26),
    u(rrect(10.6, 14, 2.8, 3.8)),
    u(rrect(7, 17.4, 10, 3.4, 1.3)),
    shade(rrect(12, 17.4, 5, 3.4, 1.3), 0.26),
    cut(star(12, 8.6, 2.4, 1, 5), 0.6),
  ),
  hangar: all(
    us(poly(12, 2.6, 20.2, 7.3, 20.2, 16.7, 12, 21.4, 3.8, 16.7, 3.8, 7.3), 2.2),
    ur('M12 6.6L16.2 16.8L12 14.4L7.8 16.8Z', 1.2),
    shade('M12 6.6L16.2 16.8L12 14.4Z', 0.3),
  ),
  refresh: all(
    us('M19 10.6A7.4 7.4 0 0 0 6.2 7.6', 2.4),
    us('M5 13.4A7.4 7.4 0 0 0 17.8 16.4', 2.4),
    u('M20.6 4.4V11.6H13.4Z'),
    u('M3.4 19.6V12.4H10.6Z'),
  ),
  share: all(
    us('M8.4 10.8L15.4 7.2M8.4 13.2L15.4 16.8', 1.9),
    u(circ(6.2, 12, 3)),
    u(circ(17.8, 6, 3)),
    u(circ(17.8, 18, 3)),
    shade(crescent(6.2, 12, 3, 1.2), 0.28),
    shade(crescent(17.8, 6, 3, 1.2), 0.28),
    shade(crescent(17.8, 18, 3, 1.2), 0.28),
  ),
  check: us('M4.8 12.6L9.8 17.4L19.4 6.8', 3),
  dice: all(
    u(rrect(3.4, 3.4, 17.2, 17.2, 4)),
    shade('M20.6 10V16.6A4 4 0 0 1 16.6 20.6H10Z', 0.26),
    cut(circ(8.6, 8.6, 1.5)),
    cut(circ(15.4, 8.6, 1.5)),
    cut(circ(12, 12, 1.5)),
    cut(circ(8.6, 15.4, 1.5)),
    cut(circ(15.4, 15.4, 1.5)),
  ),
  ban: all(us(circ(12, 12, 8.6), 2.6), us('M6 6L18 18', 2.6)),
  fullscreen: us('M3.8 9V5.2Q3.8 3.8 5.2 3.8H9M15 3.8H18.8Q20.2 3.8 20.2 5.2V9M20.2 15V18.8Q20.2 20.2 18.8 20.2H15M9 20.2H5.2Q3.8 20.2 3.8 18.8V15', 2.6),
  download: all(u('M10.6 3.6H13.4V10.8H17L12 16.4L7 10.8H10.6Z'), shade('M12 10.8H17L12 16.4Z', 0.28), us('M4.6 15.6V18.4Q4.6 20.2 6.4 20.2H17.6Q19.4 20.2 19.4 18.4V15.6', 2.4)),
  book: all(
    ur('M3.2 5.8C6.2 4.8 9.4 5.2 12 7V19.4C9.4 17.8 6.2 17.4 3.2 18.4Z', 1),
    ur('M20.8 5.8C17.8 4.8 14.6 5.2 12 7V19.4C14.6 17.8 17.8 17.4 20.8 18.4Z', 1),
    shade('M20.8 5.8C17.8 4.8 14.6 5.2 12 7V19.4C14.6 17.8 17.8 17.4 20.8 18.4Z', 0.28),
    line('M12 7V19.4', 1, '#000', 0.5),
  ),
  heal: all(
    ur('M9.4 3.8H14.6V9.4H20.2V14.6H14.6V20.2H9.4V14.6H3.8V9.4H9.4Z', 1.6),
    shade('M14.6 9.4H20.2V14.6H14.6V20.2H9.4V14.6H14.6Z', 0.26),
  ),
  skull: ufit(
    12,
    11,
    1.1,
    u('M12 2.8C7.4 2.8 4.2 6 4.2 10.4C4.2 13 5.4 15 7.2 16.2V19.2H9.2V17.4H10.8V19.2H13.2V17.4H14.8V19.2H16.8V16.2C18.6 15 19.8 13 19.8 10.4C19.8 6 16.6 2.8 12 2.8Z'),
    shade('M12 2.8C16.6 2.8 19.8 6 19.8 10.4C19.8 13 18.6 15 16.8 16.2V19.2H14.8V17.4H13.2V19.2H12Z', 0.2),
    cut(circ(8.8, 10.8, 2.3), 0.82),
    cut(circ(15.2, 10.8, 2.3), 0.82),
    cut(poly(12, 13.2, 10.8, 15.4, 13.2, 15.4), 0.82),
  ),
  clock: all(
    u(circ(12, 12, 9.2)),
    shade(crescent(12, 12, 9.2, 3), 0.26),
    cut('M11 6.4H13V11.6L16.4 13.6L15.4 15.3L11 12.8Z', 0.8),
  ),
  swords: all(
    ...[45, -45].map((a) => {
      const back = a > 0
      return g(
        `rotate(${a} 12 12)`,
        u('M12 -1.6L14.4 2.6V14.8H9.6V2.6Z'),
        shade('M12 -1.6L14.4 2.6V14.8H12Z', 0.28),
        back ? shade('M12 -1.6L14.4 2.6V14.8H9.6V2.6Z', 0.24) : '',
        u(rrect(6.4, 14.8, 11.2, 2.4, 1.1)),
        u(rrect(10.8, 17.2, 2.4, 4.6, 0.8)),
        u(circ(12, 23.2, 1.5)),
        back ? shade(rrect(6.4, 14.8, 11.2, 2.4, 1.1), 0.18) : '',
      )
    }),
  ),
  infinity: us('M12 12C10 8.8 8.2 7.6 6.4 7.6A4.4 4.4 0 0 0 6.4 16.4C8.2 16.4 10 15.2 12 12ZM12 12C14 15.2 15.8 16.4 17.6 16.4A4.4 4.4 0 0 0 17.6 7.6C15.8 7.6 14 8.8 12 12Z', 2.8),
  info: all(u(circ(12, 12, 9.2)), shade(crescent(12, 12, 9.2, 3), 0.26), cut(circ(12, 7.8, 1.4), 0.82), cut(rrect(10.9, 10.6, 2.2, 6.6, 1), 0.82)),
  tutorial: all(
    u('M12 2.6A6.4 6.4 0 0 0 8.4 14.3V16.6H15.6V14.3A6.4 6.4 0 0 0 12 2.6Z'),
    shade('M12 2.6A6.4 6.4 0 0 1 15.6 14.3V16.6H12Z', 0.26),
    u(rrect(9, 17.8, 6, 1.9, 0.9)),
    u(rrect(10, 20.3, 4, 1.7, 0.85)),
    line('M10.4 8.6L12 11.8L13.6 8.6', 1.4, '#000', 0.5),
  ),
} as const

export type UiIconName = keyof typeof UI_ICON

const wrap = (inner: string, cls: string, vb: number): string =>
  `<svg class="ico ${cls}" viewBox="0 0 ${vb} ${vb}" fill="currentColor" stroke="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

export const weaponIcon = (id: WeaponId, cls = ''): string => wrap(WEAPON_ICON[id], cls, 32)
export const passiveIcon = (id: PassiveId, cls = ''): string => wrap(PASSIVE_ICON[id], cls, 32)
export const uiIcon = (name: UiIconName, cls = ''): string => wrap(UI_ICON[name], cls, 24)
