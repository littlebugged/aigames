import { TAU, clamp, clamp01 } from '../engine/math'
import type { BeamStyle } from '../data/ids'
import { fromHsl, lighten, rgba, toHsl } from './palette'

type Ctx = CanvasRenderingContext2D

/**
 * 光束 / 电弧 / 冲击环的绘制（运行时每帧画，长度和粗细都是动态的，没法预渲染成精灵）。
 *
 * 旧版全是"一条竖向渐变的光带 + 一圈辉光"：边缘是糊的，粗了就是一片白，所有武器看上去都是同一种东西。
 * 现在每一种都有自己的结构，并且遵循同一条规则——硬边、分层、有发射器：
 * - 棱镜激光：硬边的管体 + 内层亮带 + 白芯 + 沿光束流动的能量包 + 两侧的色散细线，枪口是一枚棱镜；
 * - 磁轨炮：极细的白芯 + 绕着它旋转的双螺旋尾流，出膛时有一圈冲击环和星芒；进化后的灼痕是一道还在燃烧的裂缝；
 * - 电弧：同一条抖动路径上叠三层（以前三层各抖各的，白线总是错位），带分叉的小枝和每个落点的星爆；
 * - 冲击环：一道有厚度的波前（外缘最亮、向内渐隐）+ 分段的装甲环 + 尾迹线；敌方的环带外翻的尖齿；
 * - Boss 光束：红色警戒管体 + 斜纹流动的危险条。
 * 全部在 'lighter' 混合下绘制（由调用方设置）；除了墨色的边，没有任何 shadowBlur。
 */

export interface BeamLook {
  /** 0~1：整体强度（淡入淡出 × 闪烁） */
  env: number
  /** 当前视觉宽度（世界单位，已含收缩） */
  width: number
  /** 剩余寿命比例 0~1 */
  life: number
  /** 渲染时钟（秒） */
  vt: number
}

/** 沿光束方向逐渐变淡的渐变：近端满强度，最后 28% 渐隐——光束有"射程尽头"，而不是一刀切 */
function along(ctx: Ctx, len: number, color: string, a: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, len, 0)
  g.addColorStop(0, rgba(color, a))
  g.addColorStop(0.72, rgba(color, a))
  g.addColorStop(1, rgba(color, a * 0.12))
  return g
}

/** 一个 n 角星（4 角 = 十字星芒，8 角 = 星爆） */
function star(ctx: Ctx, x: number, y: number, R: number, r: number, n: number, rot: number): void {
  ctx.beginPath()
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n
    const d = i % 2 === 0 ? R : r
    if (i === 0) ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d)
    else ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d)
  }
  ctx.closePath()
}

/** 棱镜：枪口的一枚小水晶，朝 +x（光束的起点；坐标系已旋转到光束方向） */
function prism(ctx: Ctx, h: number, color: string, e: number): void {
  const R = 7 + h * 0.5
  ctx.beginPath()
  ctx.moveTo(R + 4, 0)
  ctx.lineTo(R * 0.15, -R * 0.62)
  ctx.lineTo(-R * 0.55, 0)
  ctx.lineTo(R * 0.15, R * 0.62)
  ctx.closePath()
  ctx.fillStyle = rgba('#ffffff', 0.92 * e)
  ctx.fill()
  ctx.lineWidth = 1.4
  ctx.strokeStyle = rgba(lighten(color, 0.2), 0.95 * e)
  ctx.stroke()
  // 折射的横向星芒
  ctx.fillStyle = rgba(lighten(color, 0.5), 0.5 * e)
  ctx.beginPath()
  ctx.moveTo(-R * 1.1, 0)
  ctx.lineTo(R * 0.2, -1.4)
  ctx.lineTo(R * 2.4, 0)
  ctx.lineTo(R * 0.2, 1.4)
  ctx.closePath()
  ctx.fill()
}

/**
 * 管体色：把近白的武器色（奶油 / 冰蓝）拉回一个有色相的颜色。
 * 不这么做的话，管体、亮带、白芯全是白的，进化后的粗光束就成了一根白柱，看不出是什么武器。
 */
function tone(color: string): string {
  const [h, s, l] = toHsl(color)
  return fromHsl(h, Math.max(s, 0.6), Math.min(l, 0.66))
}

/** 棱镜激光 */
function laser(ctx: Ctx, len: number, color: string, o: BeamLook): void {
  const e = o.env
  const h = o.width * 0.62
  const body = tone(color)
  // 管体：硬边，不是糊的渐变
  ctx.fillStyle = along(ctx, len, body, 0.3 * e)
  ctx.fillRect(0, -h, len, h * 2)
  // 两条边轨
  ctx.fillStyle = along(ctx, len, lighten(body, 0.3), 0.95 * e)
  ctx.fillRect(0, -h, len, 1.6)
  ctx.fillRect(0, h - 1.6, len, 1.6)
  // 内层亮带：保留武器自己的颜色，只比管体亮一档
  ctx.fillStyle = along(ctx, len, lighten(body, 0.22), 0.7 * e)
  ctx.fillRect(0, -h * 0.52, len, h * 1.04)
  // 白芯：细一点，颜色才不会被白色吃掉
  ctx.fillStyle = along(ctx, len, '#ffffff', 0.97 * e)
  ctx.fillRect(0, -h * 0.12, len, h * 0.24)
  // 能量包：沿光束向外流动的亮段
  ctx.lineCap = 'butt'
  ctx.setLineDash([22, 62])
  ctx.lineDashOffset = -((o.vt * 640) % 84)
  ctx.strokeStyle = along(ctx, len, lighten(color, 0.8), 0.8 * e)
  ctx.lineWidth = h * 0.66
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(len, 0)
  ctx.stroke()
  ctx.setLineDash([])
  // 色散：棱镜把光拆开，管体外各有一条偏色的细线
  const [hue, sat] = toHsl(color)
  const s = Math.max(0.6, sat)
  ctx.lineWidth = 1.3
  for (const [d, k] of [[-1, -48], [1, 48]] as const) {
    ctx.strokeStyle = along(ctx, len, fromHsl(hue + k, s, 0.64), 0.6 * e)
    ctx.beginPath()
    ctx.moveTo(0, d * (h + 2.6))
    ctx.lineTo(len, d * (h + 2.6))
    ctx.stroke()
  }
  prism(ctx, h, color, e)
}

/** 磁轨炮：出膛的一瞬间 */
function rail(ctx: Ctx, len: number, color: string, o: BeamLook): void {
  const e = o.env
  const h = o.width * 0.6
  // 外壳：窄而硬的管体 + 边轨
  ctx.fillStyle = along(ctx, len, color, 0.26 * e)
  ctx.fillRect(0, -h, len, h * 2)
  ctx.fillStyle = along(ctx, len, lighten(color, 0.5), 0.95 * e)
  ctx.fillRect(0, -h, len, 1.4)
  ctx.fillRect(0, h - 1.4, len, 1.4)
  // 白芯：很细，但一直很亮
  ctx.fillStyle = along(ctx, len, '#ffffff', e)
  ctx.fillRect(0, -Math.max(1.1, h * 0.14), len, Math.max(2.2, h * 0.28))
  // 双螺旋尾流：绕着光轨旋转的两条带子，相位随时间向外推
  const A = h * 0.95
  const lam = 70
  const ph = -o.vt * 46
  ctx.lineWidth = 2.1
  ctx.lineJoin = 'round'
  for (const sgn of [1, -1]) {
    ctx.strokeStyle = along(ctx, len, lighten(color, 0.3), 0.85 * e)
    ctx.beginPath()
    for (let x = 0; x <= len; x += 9) {
      const y = Math.sin((x / lam) * TAU + ph) * A * sgn
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // 出膛：向前扩散的冲击环 + 十字星芒（寿命越短越大、越淡）
  const k = clamp01(1 - o.life)
  const flash = Math.pow(o.life, 1.6)
  ctx.strokeStyle = rgba(lighten(color, 0.6), 0.9 * flash)
  ctx.lineWidth = 1.5 + 3 * flash
  ctx.beginPath()
  ctx.arc(8 + k * 22, 0, 12 + k * 46, -1.1, 1.1)
  ctx.stroke()
  ctx.strokeStyle = rgba(color, 0.6 * flash)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(2 + k * 40, 0, 8 + k * 78, -0.8, 0.8)
  ctx.stroke()
  star(ctx, 0, 0, 12 + 34 * flash, 2.2, 4, 0)
  ctx.fillStyle = rgba('#ffffff', 0.95 * flash)
  ctx.fill()
}

/** 磁轨炮进化后留在原地的灼痕：一道还在燃烧的裂缝，火星乱跳 */
function scar(ctx: Ctx, len: number, color: string, o: BeamLook): void {
  const e = o.env
  const h = o.width * 0.6
  // 烘焦的地面
  ctx.fillStyle = along(ctx, len, color, 0.1 * e)
  ctx.fillRect(0, -h, len, h * 2)
  // 裂缝：折线，每帧重新抖一次——火在烧
  const step = 24
  const pts: number[] = []
  for (let x = 0; x <= len; x += step) pts.push(x, x === 0 || x + step > len ? 0 : (Math.random() - 0.5) * h * 1.1)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const [w, c, a] of [
    [h * 0.7, color, 0.32],
    [h * 0.26, lighten(color, 0.5), 0.8],
    [Math.max(1, h * 0.09), '#ffffff', 0.95],
  ] as const) {
    ctx.strokeStyle = along(ctx, len, c, a * e)
    ctx.lineWidth = w
    ctx.beginPath()
    for (let i = 0; i < pts.length; i += 2) {
      if (i === 0) ctx.moveTo(pts[i], pts[i + 1])
      else ctx.lineTo(pts[i], pts[i + 1])
    }
    ctx.stroke()
  }
  // 火星：随机落在裂缝上下，每帧换位置
  const n = Math.min(26, Math.round(len / 36))
  ctx.fillStyle = rgba('#ffffff', 0.9 * e)
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = Math.random() * len * (0.2 + 0.8 * Math.random())
    const y = (Math.random() - 0.5) * h * 2.2
    const r = 0.8 + Math.random() * 1.5
    ctx.moveTo(x + r, y)
    ctx.arc(x, y, r, 0, TAU)
  }
  ctx.fill()
}

/** Boss 的警戒光束：红色管体 + 沿光束流动的斜纹危险条 */
function bossBeam(ctx: Ctx, len: number, color: string, o: BeamLook): void {
  const e = o.env
  const h = o.width * 0.58
  ctx.fillStyle = along(ctx, len, color, 0.34 * e)
  ctx.fillRect(0, -h, len, h * 2)
  // 斜纹：clip 在管体里，平行四边形向前流动
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, -h, len, h * 2)
  ctx.clip()
  const P = 38
  const off = (o.vt * 150) % P
  ctx.fillStyle = along(ctx, len, lighten(color, 0.35), 0.55 * e)
  ctx.beginPath()
  for (let x = -P + off; x < len + P; x += P) {
    ctx.moveTo(x, h)
    ctx.lineTo(x + 15, h)
    ctx.lineTo(x + 15 + h * 1.3, -h)
    ctx.lineTo(x + h * 1.3, -h)
    ctx.closePath()
  }
  ctx.fill()
  ctx.restore()
  // 边轨 + 白芯
  ctx.fillStyle = along(ctx, len, lighten(color, 0.6), 0.95 * e)
  ctx.fillRect(0, -h, len, 2)
  ctx.fillRect(0, h - 2, len, 2)
  ctx.fillStyle = along(ctx, len, '#ffffff', 0.95 * e)
  ctx.fillRect(0, -Math.max(1.4, h * 0.13), len, Math.max(2.8, h * 0.26))
}

/** 光束分发：调用方已把坐标系平移到光束起点并旋转到光束方向 */
export function paintBeam(ctx: Ctx, style: BeamStyle, len: number, color: string, o: BeamLook): void {
  if (style === 'rail') rail(ctx, len, color, o)
  else if (style === 'scar') scar(ctx, len, color, o)
  else if (style === 'boss') bossBeam(ctx, len, color, o)
  else laser(ctx, len, color, o)
}

// ───────────────────────── 电弧 ─────────────────────────

const BRK = -1e9
const mainPath: number[] = []
const twigPath: number[] = []

function strokePath(ctx: Ctx, path: number[]): void {
  ctx.beginPath()
  let pen = false
  for (let i = 0; i < path.length; i += 2) {
    if (path[i] === BRK) {
      pen = false
      continue
    }
    if (!pen) {
      ctx.moveTo(path[i], path[i + 1])
      pen = true
    } else ctx.lineTo(path[i], path[i + 1])
  }
  ctx.stroke()
}

/**
 * 电弧：沿着 pts（x,y 交替）的折线，每段加两处随机偏移；分叉的小枝随机长在折点上。
 * 抖动只算一次，三层描边走同一条路径（白芯一定落在亮线正中）。
 */
export function paintBolt(ctx: Ctx, pts: readonly number[], color: string, f: number): void {
  mainPath.length = 0
  twigPath.length = 0
  for (let i = 2; i < pts.length; i += 2) {
    const x0 = pts[i - 2]
    const y0 = pts[i - 1]
    const x1 = pts[i]
    const y1 = pts[i + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const j = Math.min(14, len * 0.16)
    if (i === 2) mainPath.push(x0, y0)
    for (const t of [0.33, 0.66]) {
      const o = (Math.random() - 0.5) * 2 * j
      const vx = x0 + dx * t + nx * o
      const vy = y0 + dy * t + ny * o
      mainPath.push(vx, vy)
      // 折点上长出分叉的小枝
      if (Math.random() < 0.42) {
        const a = Math.atan2(dy, dx) + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7)
        const l1 = 10 + Math.random() * 16
        const mx = vx + Math.cos(a) * l1
        const my = vy + Math.sin(a) * l1
        const a2 = a + (Math.random() - 0.5) * 1.1
        const l2 = 6 + Math.random() * 12
        twigPath.push(vx, vy, mx, my, mx + Math.cos(a2) * l2, my + Math.sin(a2) * l2, BRK, 0)
      }
    }
    mainPath.push(x1, y1)
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const layers: [number, string, number][] = [
    [12, color, 0.17],
    [4.2, color, 0.9],
    [1.8, '#ffffff', 0.96],
  ]
  for (const [w, c, a] of layers) {
    ctx.strokeStyle = rgba(c, a * f)
    ctx.lineWidth = w
    strokePath(ctx, mainPath)
    ctx.lineWidth = w * 0.55
    strokePath(ctx, twigPath)
  }
  // 起点：电极的小火花；每个落点：星爆（实心的星，而不是一团光晕）
  for (let i = 0; i < pts.length; i += 2) {
    const first = i === 0
    const R = first ? 6 : 8 + Math.random() * 3
    star(ctx, pts[i], pts[i + 1], R, R * 0.36, first ? 4 : 6, Math.random() * TAU)
    ctx.fillStyle = rgba('#ffffff', 0.95 * f)
    ctx.fill()
    ctx.lineWidth = 1.2
    ctx.strokeStyle = rgba(color, 0.85 * f)
    ctx.stroke()
  }
}

// ───────────────────────── 冲击环 ─────────────────────────

/** 一个固定的"伪随机"：让尾迹线的长短每帧一致 */
const hash = (i: number): number => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * 冲击环。r 是当前半径，maxR 是最大半径；p = r / maxR 越大越淡。
 * 友方：一道有厚度的波前（外缘最亮、向内渐隐）+ 分段的装甲环 + 向内的尾迹线；
 * 敌方：同样的波前，但外缘长着一圈朝外的尖齿，颜色更饱和——远远一看就是"必须冲刺穿过去"的东西。
 */
export function paintRing(ctx: Ctx, x: number, y: number, r: number, maxR: number, color: string, hostile: boolean, vt: number): void {
  const p = clamp01(r / maxR)
  const a = 1 - p * 0.75
  // 波前自己的色相：武器色常是近白的（冰蓝 / 奶油），拿来做色带会发灰，所以把饱和度提上去
  const [hh, ss] = toHsl(color)
  const band = fromHsl(hh, Math.max(0.6, ss), hostile ? 0.64 : 0.6)
  const bw = clamp(r * (hostile ? 0.16 : 0.2), 9, hostile ? 30 : 38) * (1 - 0.3 * p)
  const r0 = Math.max(0, r - bw)
  // 波前的厚度：外缘亮、向内渐隐
  const g = ctx.createRadialGradient(x, y, r0, x, y, r)
  g.addColorStop(0, rgba(color, 0))
  g.addColorStop(0.55, rgba(band, (hostile ? 0.24 : 0.2) * a))
  g.addColorStop(1, rgba(band, (hostile ? 0.66 : 0.62) * a))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.arc(x, y, r0, 0, TAU)
  ctx.fill('evenodd')
  // 分段的装甲环：一圈短弧，缓慢旋转
  const rm = r - bw * 0.46
  if (rm > 6) {
    const N = hostile ? 36 : 28
    const C = TAU * rm
    ctx.setLineDash([(C / N) * 0.62, (C / N) * 0.38])
    ctx.lineDashOffset = -vt * (hostile ? -16 : 22)
    ctx.lineWidth = bw * 0.3
    ctx.strokeStyle = rgba(lighten(band, 0.2), (hostile ? 0.6 : 0.55) * a)
    ctx.beginPath()
    ctx.arc(x, y, rm, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
  }
  // 尾迹线：波前身后的速度线（长短固定，不会闪）
  if (r > 20) {
    ctx.strokeStyle = rgba('#ffffff', 0.26 * a)
    ctx.lineWidth = 1.1
    ctx.beginPath()
    const M = 34
    for (let i = 0; i < M; i++) {
      const ang = (i / M) * TAU + vt * 0.15
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      const ra = r - bw * (0.16 + 0.1 * hash(i))
      const rb = r - bw * (0.5 + 0.5 * hash(i + 91))
      ctx.moveTo(x + c * ra, y + s * ra)
      ctx.lineTo(x + c * rb, y + s * rb)
    }
    ctx.stroke()
  }
  // 敌方：朝外的尖齿
  if (hostile && r > 24) {
    const N = 40
    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * TAU - vt * 0.22
      const hgt = bw * (0.55 + 0.55 * hash(i + 17))
      const da = (TAU / N) * 0.36
      ctx.moveTo(x + Math.cos(ang - da) * r, y + Math.sin(ang - da) * r)
      ctx.lineTo(x + Math.cos(ang) * (r + hgt), y + Math.sin(ang) * (r + hgt))
      ctx.lineTo(x + Math.cos(ang + da) * r, y + Math.sin(ang + da) * r)
    }
    ctx.fillStyle = rgba(lighten(band, 0.15), 0.85 * a)
    ctx.fill()
  }
  // 内缘：一道很淡的细线，把色带的厚度框出来
  if (r0 > 4) {
    ctx.lineWidth = 1
    ctx.strokeStyle = rgba(band, 0.32 * a)
    ctx.beginPath()
    ctx.arc(x, y, r0, 0, TAU)
    ctx.stroke()
  }
  // 波前：一道白热的细线 + 一道色线
  ctx.lineWidth = 3.6
  ctx.strokeStyle = rgba(band, 0.85 * a)
  ctx.beginPath()
  ctx.arc(x, y, r + 0.8, 0, TAU)
  ctx.stroke()
  ctx.lineWidth = 1.7
  ctx.strokeStyle = rgba('#ffffff', 0.95 * a)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.stroke()
}
