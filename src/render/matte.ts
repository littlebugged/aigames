import { TAU } from '../engine/math'
import { fromHsl, lighten, mixHex, rgba, toHsl } from './palette'

/**
 * 「哑光硬表面」美术工具箱。
 *
 * 旧版的做法是：半透明填充 + 一圈霓虹灯管描边 + shadowBlur 辉光。单个看还行，成群出现时
 * 辉光互相叠加成一团粉雾，也没有任何体积感，所以显得廉价。
 * 新版把"发光"让给真正会发光的小部件（灯、核心、枪口），机体本身改成不透明的硬表面：
 *   深色墨线描边 → 渐变底色 → 刻面明暗 → 边缘高光/暗部 → 内嵌板 → 刻线/铆钉 → 小发光件。
 * 这里只放与具体敌人/飞船无关的通用工具，全部是纯 Canvas2D，只在启动时调用一次。
 */

/** 描边墨色：不是纯黑，带一点蓝，贴着深色背景更自然 */
export const INK = '#04060d'
export const ink = (a: number): string => rgba(INK, a)

export interface Tones {
  /** 受光面 */
  hi: string
  /** 基色 */
  mid: string
  /** 背光面 */
  lo: string
  /** 凹槽 / 阴影 */
  deep: string
  /** 点缀色（发光件、涂装条） */
  accent: string
  /** 发光件的亮色 */
  glow: string
}

/** 色相向蓝色方向偏移一点：暗部偏冷是绘画里最常用的"高级感"手法 */
function coolShift(h: number, amt: number): number {
  const d = ((240 - h + 540) % 360) - 180
  return h + Math.max(-amt, Math.min(amt, d))
}

/**
 * 由一个主色推出一套哑光色阶。
 * 在 HSL 里调明度（而不是往黑色混合），这样黄色不会变成泥黄、粉色不会变成脏紫；
 * 暗部再向冷色偏一点，亮部保留一点饱和度，发光件才是画面里最亮的东西。
 * dark>0 整体更暗，<0 更亮。
 */
export function tonesOf(color: string, dark = 0): Tones {
  const [h, s, l0] = toHsl(color)
  // 黄绿色段在同样明度下看起来更暗、更脏，补一点明度
  const boost = h > 38 && h < 110 ? 0.06 : 0
  const k = (l: number): number => Math.max(0.03, Math.min(0.9, l - dark * 0.5))
  return {
    hi: fromHsl(h, s * 0.95, k(Math.min(0.78, l0 + 0.08 + boost))),
    mid: fromHsl(h, s * 0.86, k(0.42 + boost)),
    lo: fromHsl(coolShift(h, 10), s * 0.8, k(0.22 + boost * 0.5)),
    deep: fromHsl(coolShift(h, 16), s * 0.7, k(0.1)),
    accent: color,
    glow: lighten(color, 0.5),
  }
}

/** 受击闪白用的纯色色阶 */
export function flatTones(c = '#ffffff'): Tones {
  return { hi: c, mid: c, lo: c, deep: c, accent: c, glow: c }
}

export interface HullOpts {
  /** 描边宽度（世界单位）；默认随半径缩放 */
  line?: number
  /** 径向明暗（圆形 / 自转物体）；否则沿车头方向由亮到暗 */
  radial?: boolean
  /** 刻面数量；0 = 不刻面 */
  facets?: number
  /** 刻面起始角 */
  phase?: number
  /** 刻面强度倍率 */
  facetK?: number
  /** 受光方向（局部坐标系里的弧度；默认朝车头偏上） */
  light?: number
  /** 边缘高光强度 0~1 */
  rim?: number
}

/** 路径构造器：只构建路径（含 beginPath），不描边不填充 */
export type Trace = () => void

/** 在 (0,0) 为中心、半径约 R 的范围内，按"面朝光的方向"给每个扇形刻面加亮或加暗 */
function wedges(ctx: CanvasRenderingContext2D, R: number, n: number, phase: number, light: number, k: number): void {
  for (let i = 0; i < n; i++) {
    const a0 = phase + (i / n) * TAU
    const a1 = phase + ((i + 1) / n) * TAU
    const lit = Math.cos((a0 + a1) / 2 - light)
    ctx.fillStyle = lit > 0 ? rgba('#ffffff', 0.17 * lit * k) : rgba('#000000', 0.3 * -lit * k)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(Math.cos(a0) * R, Math.sin(a0) * R)
    ctx.lineTo(Math.cos(a1) * R, Math.sin(a1) * R)
    ctx.closePath()
    ctx.fill()
  }
}

/** 画一个不透明的机体：墨线描边 + 渐变底色 + 刻面 + 边缘高光 */
export function hull(ctx: CanvasRenderingContext2D, trace: Trace, r: number, t: Tones, o: HullOpts = {}): void {
  const lw = o.line ?? Math.max(1.2, r * 0.09)
  const light = o.light ?? -0.7
  // 外描边：先画双倍宽度，里面那半会被底色盖住，剩下的就是向外的墨线
  trace()
  ctx.lineWidth = lw * 2
  ctx.strokeStyle = ink(0.95)
  ctx.stroke()
  // 底色
  trace()
  let g: CanvasGradient
  if (o.radial) {
    g = ctx.createRadialGradient(Math.cos(light) * r * 0.45, Math.sin(light) * r * 0.45, r * 0.04, 0, 0, r * 1.2)
    g.addColorStop(0, t.hi)
    g.addColorStop(0.5, t.mid)
    g.addColorStop(1, t.lo)
  } else {
    g = ctx.createLinearGradient(r, 0, -r, 0)
    g.addColorStop(0, t.hi)
    g.addColorStop(0.5, t.mid)
    g.addColorStop(1, t.lo)
  }
  ctx.fillStyle = g
  ctx.fill()
  // 刻面与边缘光：裁剪在轮廓之内
  ctx.save()
  trace()
  ctx.clip()
  if ((o.facets ?? 0) > 0) wedges(ctx, r * 1.7, o.facets ?? 0, o.phase ?? 0, light, o.facetK ?? 1)
  const rim = o.rim ?? 1
  if (rim > 0) {
    trace()
    ctx.lineWidth = lw * 2.2
    const rg = ctx.createLinearGradient(0, -r, 0, r)
    rg.addColorStop(0, rgba('#ffffff', 0.5 * rim))
    rg.addColorStop(0.55, rgba('#ffffff', 0.05 * rim))
    rg.addColorStop(1, rgba('#000000', 0.32 * rim))
    ctx.strokeStyle = rg
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * 内嵌板：在机体上叠一块略暗/略亮的装甲板。
 * raised=true 像凸起（上沿亮、下沿暗），false 像凹陷（上沿暗、下沿亮）。
 */
export function plate(
  ctx: CanvasRenderingContext2D,
  build: Trace,
  r: number,
  top: string,
  bottom: string,
  o: { line?: number; raised?: boolean; alpha?: number } = {},
): void {
  const lw = o.line ?? 0.9
  const raised = o.raised ?? false
  build()
  const g = ctx.createLinearGradient(0, -r, 0, r)
  g.addColorStop(0, top)
  g.addColorStop(1, bottom)
  ctx.fillStyle = g
  ctx.fill()
  ctx.save()
  build()
  ctx.clip()
  build()
  ctx.lineWidth = lw * 2.4
  const bg = ctx.createLinearGradient(0, -r, 0, r)
  bg.addColorStop(0, raised ? rgba('#ffffff', 0.4) : rgba('#000000', 0.5))
  bg.addColorStop(1, raised ? rgba('#000000', 0.4) : rgba('#ffffff', 0.22))
  ctx.strokeStyle = bg
  ctx.stroke()
  ctx.restore()
  build()
  ctx.lineWidth = lw
  ctx.strokeStyle = ink(o.alpha ?? 0.78)
  ctx.stroke()
}

/** 刻线：一条暗槽，旁边带一线亮边，像压在金属上的缝 */
export function groove(ctx: CanvasRenderingContext2D, build: Trace, w = 1): void {
  build()
  ctx.lineWidth = w * 1.5
  ctx.strokeStyle = ink(0.72)
  ctx.stroke()
  ctx.save()
  ctx.translate(w * 0.3, w * 0.65)
  build()
  ctx.restore()
  ctx.lineWidth = w * 0.8
  ctx.strokeStyle = rgba('#ffffff', 0.2)
  ctx.stroke()
}

/** 铆钉 / 螺栓 */
export function rivet(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number): void {
  ctx.beginPath()
  ctx.arc(x, y, rad, 0, TAU)
  ctx.fillStyle = ink(0.62)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x - rad * 0.28, y - rad * 0.32, rad * 0.5, 0, TAU)
  ctx.fillStyle = rgba('#ffffff', 0.5)
  ctx.fill()
}

/**
 * 发光件（灯 / 核心 / 枪口）：一圈很小的柔光 + 带灯座的实心灯体。
 * 柔光半径只有灯体的 2.2 倍，不会扩散成雾。
 */
export function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, color: string, k = 1): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const R = rad * 2.2
  const g = ctx.createRadialGradient(x, y, 0, x, y, R)
  g.addColorStop(0, rgba(color, 0.6 * k))
  g.addColorStop(0.5, rgba(color, 0.17 * k))
  g.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, R, 0, TAU)
  ctx.fill()
  ctx.restore()
  // 灯座
  ctx.beginPath()
  ctx.arc(x, y, rad * 1.18, 0, TAU)
  ctx.fillStyle = ink(0.8)
  ctx.fill()
  // 灯体
  const b = ctx.createRadialGradient(x - rad * 0.28, y - rad * 0.3, 0, x, y, rad)
  b.addColorStop(0, '#ffffff')
  b.addColorStop(0.5, lighten(color, 0.55))
  b.addColorStop(1, color)
  ctx.fillStyle = b
  ctx.beginPath()
  ctx.arc(x, y, rad, 0, TAU)
  ctx.fill()
}

/** 椭圆 / 圆角矩形等小件用的路径辅助 */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number): void {
  const r = Math.min(rad, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}
