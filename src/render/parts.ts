import { TAU } from '../engine/math'
import { hull, ink, lamp, plate, type HullOpts, type Tones, type Trace } from './matte'
import { fromHsl, lighten, mixHex, rgba, toHsl } from './palette'

/**
 * 「拼装式」美术的通用部件：敌人（creatures.ts）和飞船（shipart.ts）共用。
 *
 * 轮廓优先的做法是把一只怪 / 一架飞船拆成十几个部件（翅、腿、钳、舱、灯……），
 * 每个部件各自一条明暗渐变（solid / soft 用包围盒确定明暗中心），
 * 这样尾部的翅膀不会因为"整只共用一条渐变"而变成一团黑。
 * 坐标单位都是"美术半径 R"，朝 +x。
 */

export type Ctx = CanvasRenderingContext2D
export type Pt = readonly [number, number]


/** 折线闭合路径（坐标单位 R） */
export function poly(ctx: Ctx, R: number, pts: readonly Pt[]): void {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * R, y * R) : ctx.lineTo(x * R, y * R)))
  ctx.closePath()
}

/** 过所有点的闭合平滑曲线（Catmull-Rom → 三次贝塞尔） */
export function blob(ctx: Ctx, R: number, pts: readonly Pt[], k = 1): void {
  const n = pts.length
  const at = (i: number): Pt => pts[(i + n) % n]
  ctx.beginPath()
  ctx.moveTo(at(0)[0] * R, at(0)[1] * R)
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    ctx.bezierCurveTo(
      (p1[0] + ((p2[0] - p0[0]) * k) / 6) * R,
      (p1[1] + ((p2[1] - p0[1]) * k) / 6) * R,
      (p2[0] - ((p3[0] - p1[0]) * k) / 6) * R,
      (p2[1] - ((p3[1] - p1[1]) * k) / 6) * R,
      p2[0] * R,
      p2[1] * R,
    )
  }
  ctx.closePath()
}

/** 上半边轮廓（首尾点落在对称轴上）→ 左右对称的完整轮廓 */
export function mirror(top: readonly Pt[]): Pt[] {
  const out: Pt[] = [...top]
  for (let i = top.length - 2; i >= 1; i--) out.push([top[i][0], -top[i][1]])
  return out
}

/** 把一组点的 y 翻到另一侧 */
export const flipY = (pts: readonly Pt[], s: number): Pt[] => pts.map(([x, y]) => [x, y * s] as Pt)

/** 点集的包围盒：用来让每个部件各自明暗（而不是整只怪共用一条渐变） */
export function bounds(pts: readonly Pt[], R: number): { cx: number; cy: number; r: number; hy: number } {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  return { cx: ((x0 + x1) / 2) * R, cy: ((y0 + y1) / 2) * R, r: (Math.max(x1 - x0, y1 - y0) / 2) * R, hy: ((y1 - y0) / 2) * R }
}

/** 多边形部件 */
export function solid(ctx: Ctx, R: number, pts: readonly Pt[], t: Tones, o: HullOpts = {}): void {
  const b = bounds(pts, R)
  hull(ctx, () => poly(ctx, R, pts), b.r, t, { line: 1.2, ...o, cx: b.cx, cy: b.cy })
}

/** 平滑曲线部件 */
export function soft(ctx: Ctx, R: number, pts: readonly Pt[], t: Tones, o: HullOpts = {}, k = 1): void {
  const b = bounds(pts, R)
  hull(ctx, () => blob(ctx, R, pts, k), b.r, t, { line: 1.2, ...o, cx: b.cx, cy: b.cy })
}

/** 在 (x,y)、旋转 rot 的局部坐标系里画 */
export function at(ctx: Ctx, x: number, y: number, rot: number, draw: () => void): void {
  ctx.save()
  ctx.translate(x, y)
  if (rot !== 0) ctx.rotate(rot)
  draw()
  ctx.restore()
}

/** 椭圆部件：自带径向明暗（以自身为中心） */
export function oval(ctx: Ctx, x: number, y: number, rx: number, ry: number, t: Tones, o: HullOpts = {}): void {
  hull(
    ctx,
    () => {
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, TAU)
    },
    Math.max(rx, ry),
    t,
    { radial: true, line: Math.max(1, Math.min(rx, ry) * 0.16), ...o, cx: x, cy: y },
  )
}

/** 圆形凹槽 + 里面的灯：反应堆 / 镜头 / 核心 */
export function socket(ctx: Ctx, x: number, y: number, rad: number, t: Tones, lampK = 1.1): void {
  at(ctx, x, y, 0, () => {
    plate(
      ctx,
      () => {
        ctx.beginPath()
        ctx.arc(0, 0, rad, 0, TAU)
      },
      rad,
      mixHex(t.lo, '#10141f', 0.5),
      '#06080f',
      { raised: false, line: 1 },
    )
    lamp(ctx, 0, 0, rad * 0.62, t.glow, lampK)
  })
}

/** 细长肢体：墨线衬边 + 肢体 + 一道高光 */
export function limb(ctx: Ctx, R: number, pts: readonly Pt[], w: number, t: Tones): void {
  const path = (): void => {
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * R, y * R) : ctx.lineTo(x * R, y * R)))
  }
  path()
  ctx.lineWidth = w + 2.2
  ctx.strokeStyle = ink(0.95)
  ctx.stroke()
  path()
  ctx.lineWidth = w
  ctx.strokeStyle = t.mid
  ctx.stroke()
  path()
  ctx.lineWidth = Math.max(0.55, w * 0.38)
  ctx.strokeStyle = rgba(t.hi, 0.9)
  ctx.stroke()
}

export const line = (ctx: Ctx, R: number, x0: number, y0: number, x1: number, y1: number): (() => void) => () => {
  ctx.beginPath()
  ctx.moveTo(x0 * R, y0 * R)
  ctx.lineTo(x1 * R, y1 * R)
}

/** 骨白：同色相、低饱和、高明度的附肢色（翅 / 腿 / 角）。深色背景上它比躯干更醒目 */
export function bone(t: Tones): Tones {
  const [h] = toHsl(t.accent)
  return {
    hi: fromHsl(h, 0.55, 0.9),
    mid: fromHsl(h, 0.42, 0.68),
    lo: fromHsl(h, 0.4, 0.42),
    deep: fromHsl(h, 0.4, 0.22),
    accent: t.accent,
    glow: t.glow,
  }
}

/** 带一点主色倾向的冷灰金属：钳、炮管、喷口、盾 */
export function metal(t: Tones): Tones {
  const [h] = toHsl(t.accent)
  return {
    hi: fromHsl(h, 0.2, 0.84),
    mid: fromHsl(h, 0.16, 0.6),
    lo: fromHsl(h, 0.2, 0.36),
    deep: fromHsl(h, 0.24, 0.18),
    accent: t.accent,
    glow: t.glow,
  }
}

/** 装甲板的暗面渐变（和机体同色系，略暗） */
export const dark = (t: Tones): [string, string] => [mixHex(t.lo, t.mid, 0.4), t.deep]

/**
 * 一颗刻面宝石：墨线底 → 按边的朝向给每个三角刻面上不同明暗（光从左上来）→ 棱线 → 外轮廓。
 * pts 是按顺时针排列的外轮廓；c 是刻面汇聚的中心点。宝石和补给晶核共用。
 */
export function cut(ctx: Ctx, pts: readonly Pt[], c: Pt, col: string): void {
  const trace: Trace = () => {
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
  }
  trace()
  ctx.lineWidth = 2.2
  ctx.strokeStyle = ink(0.92)
  ctx.stroke()
  const shades = [lighten(col, 0.7), lighten(col, 0.38), col, mixHex(col, '#0a0c14', 0.28), mixHex(col, '#0a0c14', 0.52)]
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    // 外法线朝向与光方向 (-1,-1) 的夹角 → 明暗
    const nx = b[1] - a[1]
    const ny = a[0] - b[0]
    const len = Math.hypot(nx, ny) || 1
    const lit = (-nx - ny) / len / Math.SQRT2 // -1..1
    ctx.beginPath()
    ctx.moveTo(c[0], c[1])
    ctx.lineTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.closePath()
    ctx.fillStyle = shades[Math.min(4, Math.max(0, Math.round((1 - lit) * 2)))]
    ctx.fill()
  }
  ctx.beginPath()
  for (const [x, y] of pts) {
    ctx.moveTo(c[0], c[1])
    ctx.lineTo(x, y)
  }
  ctx.lineWidth = 0.6
  ctx.strokeStyle = rgba('#ffffff', 0.32)
  ctx.stroke()
  trace()
  ctx.lineWidth = 1
  ctx.strokeStyle = ink(0.85)
  ctx.stroke()
}
