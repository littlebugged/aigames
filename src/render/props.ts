import { TAU } from '../engine/math'
import { groove, hull, ink, lamp, plate, rivet, tonesOf, type Trace } from './matte'
import { lighten, mixHex, rgba } from './palette'
import { bone, cut, metal, soft, solid, type Ctx, type Pt } from './parts'
import { steelTones } from './shipart'

/**
 * 拾取物与武器小件的"造型"。
 *
 * 和敌人 / 飞船一样先画轮廓：回血是十字医疗箱，磁铁是 U 形马蹄磁铁，炸弹是带引信的圆炸弹，
 * 宝箱是带锁的箱子，补给是立在底座上的晶体；环绕刃是弯月镰刀，飞轮是带钩齿的锯盘，
 * 僚机是带翼的微型战机，地雷是带尖刺的圆盘。
 * 这里只负责"画"：尺寸、光晕、缓存仍由 sprites.ts 决定。坐标原点是精灵中心。
 */

/** 圆角折线：每个顶点在相邻两边的中点之间用圆弧过渡（坐标单位 R，rad 是世界单位） */
function roundPoly(ctx: Ctx, pts: readonly Pt[], R: number, rad: number): void {
  const n = pts.length
  ctx.beginPath()
  ctx.moveTo(((pts[n - 1][0] + pts[0][0]) / 2) * R, ((pts[n - 1][1] + pts[0][1]) / 2) * R)
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % n]
    ctx.arcTo(p[0] * R, p[1] * R, ((p[0] + q[0]) / 2) * R, ((p[1] + q[1]) / 2) * R, rad)
  }
  ctx.closePath()
}

const circle =
  (ctx: Ctx, x: number, y: number, rad: number): Trace =>
  () => {
    ctx.beginPath()
    ctx.arc(x, y, rad, 0, TAU)
  }

const rect =
  (ctx: Ctx, x0: number, y0: number, x1: number, y1: number, rad = 0): Trace =>
  () => {
    ctx.beginPath()
    if (rad > 0) {
      const r = Math.min(rad, (x1 - x0) / 2, (y1 - y0) / 2)
      ctx.moveTo(x0 + r, y0)
      ctx.arcTo(x1, y0, x1, y1, r)
      ctx.arcTo(x1, y1, x0, y1, r)
      ctx.arcTo(x0, y1, x0, y0, r)
      ctx.arcTo(x0, y0, x1, y0, r)
      ctx.closePath()
    } else {
      ctx.rect(x0, y0, x1 - x0, y1 - y0)
    }
  }

/** 一道带墨线衬底的亮线（高光 / 绳 / 导线） */
function stroke(ctx: Ctx, trace: Trace, w: number, color: string, under = 0): void {
  if (under > 0) {
    trace()
    ctx.lineWidth = w + under
    ctx.strokeStyle = ink(0.9)
    ctx.stroke()
  }
  trace()
  ctx.lineWidth = w
  ctx.strokeStyle = color
  ctx.stroke()
}

// ───────────────────────── 拾取物 ─────────────────────────

const plusPts = (a: number, L: number): Pt[] => [
  [-a, -L], [a, -L], [a, -a], [L, -a], [L, a], [a, a], [a, L], [-a, L], [-a, a], [-L, a], [-L, -a], [-a, -a],
]

/** 回血：十字医疗箱——绿色的十字外壳 + 白色十字嵌板，四个臂尖各一颗铆钉 */
export function paintHeal(ctx: Ctx, r: number, col: string): void {
  const t = tonesOf(col, -0.25)
  hull(ctx, () => roundPoly(ctx, plusPts(0.42, 1.04), r, r * 0.2), r * 1.04, t, { radial: true, line: 1.5, light: -2.3 })
  plate(ctx, () => roundPoly(ctx, plusPts(0.17, 0.68), r, r * 0.08), r * 0.7, '#ffffff', mixHex('#ffffff', col, 0.42), { raised: true, line: 0.8 })
  for (const [x, y] of [[0, -0.87], [0.87, 0], [0, 0.87], [-0.87, 0]] as Pt[]) rivet(ctx, x * r, y * r, r * 0.07)
}

/** 磁铁：U 形马蹄磁铁——彩色磁体、银白磁极、两极之间的磁力线 */
export function paintMagnet(ctx: Ctx, r: number, col: string): void {
  const t = tonesOf(col, -0.2)
  const R1 = r * 0.92
  const R2 = r * 0.46
  const cy = r * 0.16
  const top = -r * 0.92
  const tipH = r * 0.5
  const u: Trace = () => {
    ctx.beginPath()
    ctx.moveTo(-R1, top)
    ctx.lineTo(-R1, cy)
    ctx.arc(0, cy, R1, Math.PI, 0, true)
    ctx.lineTo(R1, top)
    ctx.lineTo(R2, top)
    ctx.lineTo(R2, cy)
    ctx.arc(0, cy, R2, 0, Math.PI, false)
    ctx.lineTo(-R2, top)
    ctx.closePath()
  }
  hull(ctx, u, r, t, { radial: true, line: 1.5, light: -2.3, cy: cy * 0.5 })
  // 磁极：银白色的帽
  ctx.save()
  u()
  ctx.clip()
  const tg = ctx.createLinearGradient(0, top, 0, top + tipH)
  tg.addColorStop(0, '#ffffff')
  tg.addColorStop(1, '#9aa8c2')
  ctx.fillStyle = tg
  ctx.fillRect(-R1 - 1, top - 1, R1 * 2 + 2, tipH + 1)
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(-R1, top + tipH)
  ctx.lineTo(-R2, top + tipH)
  ctx.moveTo(R2, top + tipH)
  ctx.lineTo(R1, top + tipH)
  ctx.lineWidth = 1.1
  ctx.strokeStyle = ink(0.88)
  ctx.stroke()
  u()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = ink(0.9)
  ctx.stroke()
  // 磁体上的一道高光：沿左腿和底部的弧
  const Rm = (R1 + R2) / 2
  stroke(
    ctx,
    () => {
      ctx.beginPath()
      ctx.moveTo(-Rm, top + tipH + r * 0.14)
      ctx.lineTo(-Rm, cy)
      ctx.arc(0, cy, Rm, Math.PI, Math.PI * 0.66, true)
    },
    1.1,
    rgba('#ffffff', 0.5),
  )
  // 磁力线：两极之间的两道弧
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const [k, a] of [[0.34, 0.95], [0.62, 0.55]] as Pt[]) {
    ctx.beginPath()
    ctx.ellipse(0, top - r * 0.02, Rm, k * r, 0, Math.PI, TAU)
    ctx.lineWidth = 1.1
    ctx.strokeStyle = rgba(lighten(col, 0.55), a)
    ctx.stroke()
  }
  ctx.restore()
}

/** 炸弹：灰钢球体 + 彩色腰带 + 金属帽 + 绳引信 + 火花 */
export function paintBomb(ctx: Ctx, r: number, col: string): void {
  const cy = r * 0.2
  const br = r * 0.8
  const steel = tonesOf(mixHex('#7c86a4', col, 0.1), -0.05)
  // 引信：画在球体后面，从帽顶弯出去
  const fuse: Trace = () => {
    ctx.beginPath()
    ctx.moveTo(0, -r * 0.86)
    ctx.bezierCurveTo(-r * 0.04, -r * 1.14, r * 0.5, -r * 0.9, r * 0.6, -r * 1.24)
  }
  stroke(ctx, fuse, 2, '#e6d6ab', 2.2)
  // 球体
  const body = circle(ctx, 0, cy, br)
  hull(ctx, body, br, steel, { radial: true, line: 1.5, light: -2.3, cx: 0, cy })
  // 腰带：彩色，上下各一道暗边
  ctx.save()
  body()
  ctx.clip()
  const bg = ctx.createLinearGradient(0, cy - br * 0.26, 0, cy + br * 0.26)
  bg.addColorStop(0, lighten(col, 0.38))
  bg.addColorStop(0.55, col)
  bg.addColorStop(1, mixHex(col, '#0a0c14', 0.45))
  ctx.fillStyle = bg
  ctx.fillRect(-br - 1, cy - br * 0.26, br * 2 + 2, br * 0.52)
  ctx.fillStyle = ink(0.75)
  ctx.fillRect(-br - 1, cy - br * 0.26 - 0.5, br * 2 + 2, 1)
  ctx.fillRect(-br - 1, cy + br * 0.26 - 0.5, br * 2 + 2, 1)
  ctx.restore()
  body()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = ink(0.88)
  ctx.stroke()
  // 高光
  ctx.beginPath()
  ctx.ellipse(-br * 0.4, cy - br * 0.5, br * 0.17, br * 0.3, -0.75, 0, TAU)
  ctx.fillStyle = rgba('#ffffff', 0.62)
  ctx.fill()
  // 金属帽
  const capT = metal(tonesOf(col))
  hull(ctx, rect(ctx, -r * 0.3, -r * 0.94, r * 0.3, -r * 0.5, r * 0.1), r * 0.44, capT, { line: 1.2, light: -2.3 })
  groove(ctx, () => {
    ctx.beginPath()
    ctx.moveTo(-r * 0.3, -r * 0.7)
    ctx.lineTo(r * 0.3, -r * 0.7)
  }, 0.8)
  // 火花
  const sx = r * 0.6
  const sy = -r * 1.24
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3
    ctx.moveTo(sx + Math.cos(a) * r * 0.1, sy + Math.sin(a) * r * 0.1)
    ctx.lineTo(sx + Math.cos(a) * r * (i % 2 ? 0.26 : 0.38), sy + Math.sin(a) * r * (i % 2 ? 0.26 : 0.38))
  }
  ctx.lineWidth = 1
  ctx.strokeStyle = '#fff2b0'
  ctx.stroke()
  lamp(ctx, sx, sy, r * 0.12, '#ffd84a', 1.4)
}

/** 宝箱：棕色木箱 + 金色包边 + 带钥匙孔的锁 */
export function paintChest(ctx: Ctx, r: number, col: string): void {
  const wood = tonesOf(mixHex(col, '#8a4a1e', 0.66), -0.05)
  const W = r * 1.0
  const seam = -r * 0.04
  const bottom = r * 0.8
  const lidTop = -r * 0.9
  const lidSide = -r * 0.46
  const baseT: Trace = rect(ctx, -W, seam, W, bottom, r * 0.12)
  const lidT: Trace = () => {
    ctx.beginPath()
    ctx.moveTo(-W, seam)
    ctx.lineTo(-W, lidSide)
    ctx.quadraticCurveTo(-W, lidTop, 0, lidTop)
    ctx.quadraticCurveTo(W, lidTop, W, lidSide)
    ctx.lineTo(W, seam)
    ctx.closePath()
  }
  const all: Trace = () => {
    ctx.beginPath()
    ctx.moveTo(-W, bottom - r * 0.12)
    ctx.lineTo(-W, lidSide)
    ctx.quadraticCurveTo(-W, lidTop, 0, lidTop)
    ctx.quadraticCurveTo(W, lidTop, W, lidSide)
    ctx.lineTo(W, bottom - r * 0.12)
    ctx.arcTo(W, bottom, W - r * 0.12, bottom, r * 0.12)
    ctx.lineTo(-W + r * 0.12, bottom)
    ctx.arcTo(-W, bottom, -W, bottom - r * 0.12, r * 0.12)
    ctx.closePath()
  }
  hull(ctx, baseT, r, { ...wood, hi: wood.mid, mid: wood.lo, lo: wood.deep }, { line: 1.5, light: -1.6, rim: 0.7 })
  hull(ctx, lidT, r, wood, { line: 1.5, light: -1.8, rim: 0.8, cy: lidSide * 0.6 })
  // 木纹：箱身两道横缝
  for (const y of [0.34, 0.62]) {
    groove(ctx, () => {
      ctx.beginPath()
      ctx.moveTo(-W + 2, y * r)
      ctx.lineTo(W - 2, y * r)
    }, 0.7)
  }
  // 金属包边：竖带 + 缝口横带（裁在箱子轮廓里）
  const gTop = lighten(col, 0.62)
  const gBot = mixHex(col, '#3a2000', 0.5)
  ctx.save()
  all()
  ctx.clip()
  for (const s of [-1, 1]) plate(ctx, rect(ctx, s * r * 0.5 - r * 0.15, lidTop - 2, s * r * 0.5 + r * 0.15, bottom + 2), r, gTop, gBot, { raised: true, line: 0.9 })
  plate(ctx, rect(ctx, -W - 2, seam - r * 0.1, W + 2, seam + r * 0.1), r, gTop, gBot, { raised: true, line: 0.9 })
  ctx.restore()
  all()
  ctx.lineWidth = 1.3
  ctx.strokeStyle = ink(0.9)
  ctx.stroke()
  // 锁扣
  plate(ctx, rect(ctx, -r * 0.2, seam - r * 0.22, r * 0.2, seam + r * 0.34, r * 0.07), r * 0.4, lighten(col, 0.7), mixHex(col, '#3a2000', 0.35), { raised: true, line: 1 })
  ctx.beginPath()
  ctx.arc(0, seam + r * 0.02, r * 0.065, 0, TAU)
  ctx.moveTo(-r * 0.04, seam + r * 0.05)
  ctx.lineTo(-r * 0.065, seam + r * 0.22)
  ctx.lineTo(r * 0.065, seam + r * 0.22)
  ctx.lineTo(r * 0.04, seam + r * 0.05)
  ctx.fillStyle = ink(0.9)
  ctx.fill()
  for (const [x, y] of [[-0.8, 0.68], [0.8, 0.68], [-0.8, -0.3], [0.8, -0.3]] as Pt[]) rivet(ctx, x * r, y * r, r * 0.055)
}

/** 补给晶核：立在金属底座上的紫晶 + 两颗小碎晶 */
export function paintCache(ctx: Ctx, r: number, col: string): void {
  const mt = metal(tonesOf(col))
  // 底座：梯形
  const base: Trace = () => roundPoly(ctx, [[-1.0, 0.82], [-0.78, 0.46], [0.78, 0.46], [1.0, 0.82]], r, r * 0.06)
  // 后排碎晶先画
  for (const [x, rot, k] of [[-0.58, -0.5, 0.4], [0.6, 0.5, 0.36]] as [number, number, number][]) {
    ctx.save()
    ctx.translate(x * r, r * 0.12)
    ctx.rotate(rot)
    const h = r * k
    cut(ctx, [[0, -h * 1.3], [h * 0.6, -h * 0.5], [h * 0.6, h * 0.55], [0, h * 0.9], [-h * 0.6, h * 0.55], [-h * 0.6, -h * 0.5]], [0, 0], col)
    ctx.restore()
  }
  hull(ctx, base, r, mt, { line: 1.4, light: -1.7, rim: 0.8 })
  // 底座上的一条发光缝
  groove(ctx, () => {
    ctx.beginPath()
    ctx.moveTo(-r * 0.66, r * 0.62)
    ctx.lineTo(r * 0.66, r * 0.62)
  }, 0.8)
  lamp(ctx, 0, r * 0.64, r * 0.1, col, 1.1)
  // 主晶体
  const h = r * 0.62
  ctx.save()
  ctx.translate(0, -r * 0.02)
  cut(ctx, [[0, -h * 1.34], [h * 0.68, -h * 0.5], [h * 0.68, h * 0.55], [0, h * 0.86], [-h * 0.68, h * 0.55], [-h * 0.68, -h * 0.5]], [0, 0], col)
  // 高光：一道斜着的亮斑（不能画成十字星——会被看成回血的"+"）
  ctx.beginPath()
  ctx.ellipse(-h * 0.34, -h * 0.5, h * 0.09, h * 0.3, 0.45, 0, TAU)
  ctx.fillStyle = rgba('#ffffff', 0.85)
  ctx.fill()
  ctx.restore()
}

// ───────────────────────── 武器小件 ─────────────────────────

/**
 * 环绕刃：弯月镰刀。刃尖朝 +x、凸脊朝 -y（渲染时 -y 正好是"离机身远的一侧"），刃口在内侧凹弧上。
 * 尺寸基准 r=20：刃尖在 +r，刀柄尾在 -r。
 */
export function paintBlade(ctx: Ctx, r: number, color: string): void {
  // 刃身是"带色泽的钢"，不是纯色：纯黄 / 纯蓝的一整块会像香蕉，钢色里掺三成主色才像金属
  const t = tonesOf(mixHex(color, '#aeb8cf', 0.34), -0.1)
  const hand = metal(tonesOf(mixHex(color, '#6c7790', 0.55)))
  // 刀柄：先画，让护手盖住它的根部
  hull(ctx, rect(ctx, -r * 1.0, -r * 0.16, -r * 0.5, r * 0.02, r * 0.05), r * 0.5, hand, { line: 1.1, light: -1.6 })
  for (const x of [-0.9, -0.8, -0.7]) {
    ctx.beginPath()
    ctx.moveTo(x * r, -r * 0.15)
    ctx.lineTo(x * r, r * 0.01)
    ctx.lineWidth = 0.8
    ctx.strokeStyle = ink(0.55)
    ctx.stroke()
  }
  hull(ctx, circle(ctx, -r * 1.02, -r * 0.07, r * 0.1), r * 0.1, hand, { radial: true, line: 1, light: -2.2, cx: -r * 1.02, cy: -r * 0.07 })
  // 刃身：轮廓与两个斜面共用同一组曲线
  const tip: Pt = [r, 0.16 * r]
  const baseTop: Pt = [-0.52 * r, -0.36 * r]
  const baseBot: Pt = [-0.52 * r, 0.22 * r]
  const baseMid: Pt = [-0.52 * r, -0.07 * r]
  const spineTo = (): void => ctx.bezierCurveTo(0.72 * r, -0.52 * r, 0.12 * r, -0.7 * r, baseTop[0], baseTop[1]) // 尖 → 根（凸脊）
  const edgeTo = (): void => ctx.bezierCurveTo(-0.12 * r, -0.16 * r, 0.52 * r, -0.18 * r, tip[0], tip[1]) // 根 → 尖（刃口，内凹）
  const ridgeTo = (): void => ctx.bezierCurveTo(-0.1 * r, -0.43 * r, 0.5 * r, -0.35 * r, tip[0], tip[1]) // 根中点 → 尖（两个斜面之间的棱）
  const blade: Trace = () => {
    ctx.beginPath()
    ctx.moveTo(tip[0], tip[1])
    spineTo()
    ctx.lineTo(baseBot[0], baseBot[1])
    edgeTo()
    ctx.closePath()
  }
  hull(ctx, blade, r, t, { line: 1.5, light: -1.3, rim: 0 })
  // 斜面：凸脊一侧压暗、刃口一侧磨亮，中间一道清晰的棱——这才是"刀"而不是一块弯板
  ctx.save()
  blade()
  ctx.clip()
  ctx.beginPath()
  ctx.moveTo(tip[0], tip[1])
  spineTo()
  ctx.lineTo(baseMid[0], baseMid[1])
  ridgeTo()
  ctx.closePath()
  const tc = tonesOf(color, -0.05)
  const up = ctx.createLinearGradient(r, 0, -0.52 * r, 0)
  up.addColorStop(0, mixHex(tc.mid, '#aeb8cf', 0.22))
  up.addColorStop(1, tc.lo)
  ctx.fillStyle = up
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(baseMid[0], baseMid[1])
  ridgeTo()
  ctx.bezierCurveTo(0.52 * r, -0.18 * r, -0.12 * r, -0.16 * r, baseBot[0], baseBot[1]) // 尖 → 根（刃口，倒着走）
  ctx.closePath()
  const lo = ctx.createLinearGradient(r, 0, -0.52 * r, 0)
  lo.addColorStop(0, lighten(color, 0.82))
  lo.addColorStop(0.55, lighten(mixHex(color, '#aeb8cf', 0.3), 0.5))
  lo.addColorStop(1, t.hi)
  ctx.fillStyle = lo
  ctx.fill()
  ctx.restore()
  // 棱线：一道暗缝 + 紧贴的一线亮边
  stroke(
    ctx,
    () => {
      ctx.beginPath()
      ctx.moveTo(baseMid[0] + r * 0.05, baseMid[1])
      ridgeTo()
    },
    0.8,
    ink(0.55),
  )
  // 刃口：贴着内侧凹弧、往里缩一点的一线亮边（贴死在轮廓上会被描边吃掉）
  ctx.save()
  ctx.translate(0, -r * 0.05)
  stroke(
    ctx,
    () => {
      ctx.beginPath()
      ctx.moveTo(baseBot[0] + r * 0.05, baseBot[1])
      ctx.bezierCurveTo(-0.12 * r, -0.14 * r, 0.52 * r, -0.16 * r, 0.96 * r, 0.14 * r)
    },
    1,
    rgba('#ffffff', 0.9),
  )
  ctx.restore()
  // 刃色：沿刃口内侧压一线主色，让它仍然属于这把武器的颜色体系
  ctx.save()
  blade()
  ctx.clip()
  ctx.translate(0, -r * 0.1)
  ctx.beginPath()
  ctx.moveTo(baseBot[0], baseBot[1])
  edgeTo()
  ctx.lineWidth = r * 0.14
  ctx.strokeStyle = rgba(color, 0.55)
  ctx.stroke()
  ctx.restore()
  // 重描一遍外轮廓，盖住斜面填色的毛边
  blade()
  ctx.lineWidth = 0.9
  ctx.strokeStyle = ink(0.9)
  ctx.stroke()
  // 护手
  plate(ctx, rect(ctx, -r * 0.62, -r * 0.44, -r * 0.48, r * 0.3, r * 0.05), r * 0.5, lighten(color, 0.65), mixHex(color, '#0a0c14', 0.45), { raised: true, line: 1 })
  rivet(ctx, -r * 0.55, -r * 0.07, r * 0.045)
}

/** 回旋飞轮：外缘八枚朝转向弯钩的锯齿 + 金属环 + 中心孔。基准 r=14 */
export function paintChakram(ctx: Ctx, r: number, color: string): void {
  const t = tonesOf(color, -0.15)
  const N = 8
  const P = (a: number, k: number): Pt => [Math.cos(a) * r * k, Math.sin(a) * r * k]
  const body: Trace = () => {
    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const a = (i * TAU) / N
      const b1 = P(a - 0.16, 0.82)
      const c1 = P(a + 0.04, 1.3)
      const tip = P(a + 0.36, 1.5)
      const c2 = P(a + 0.4, 1.02)
      const b2 = P(a + 0.3, 0.82)
      ctx.moveTo(b1[0], b1[1])
      ctx.quadraticCurveTo(c1[0], c1[1], tip[0], tip[1])
      ctx.quadraticCurveTo(c2[0], c2[1], b2[0], b2[1])
      ctx.closePath()
    }
    ctx.moveTo(r * 0.9, 0)
    ctx.arc(0, 0, r * 0.9, 0, TAU)
  }
  const hole = circle(ctx, 0, 0, r * 0.34)
  body()
  ctx.lineWidth = 3
  ctx.strokeStyle = ink(0.92)
  ctx.stroke()
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.5)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.35, lighten(color, 0.4))
  g.addColorStop(0.7, t.mid)
  g.addColorStop(1, t.lo)
  ctx.fillStyle = g
  body()
  ctx.fill('nonzero')
  // 刻面：八个扇区明暗交替
  ctx.save()
  body()
  ctx.clip()
  for (let i = 0; i < N; i++) {
    const a0 = (i * TAU) / N - TAU / 16
    const a1 = a0 + TAU / N
    ctx.fillStyle = i % 2 === 0 ? rgba('#ffffff', 0.12) : rgba('#000000', 0.2)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(Math.cos(a0) * r * 2, Math.sin(a0) * r * 2)
    ctx.lineTo(Math.cos(a1) * r * 2, Math.sin(a1) * r * 2)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  // 钩齿的刃口：每枚齿朝转向那一侧一线亮边
  for (let i = 0; i < N; i++) {
    const a = (i * TAU) / N
    const tip = P(a + 0.36, 1.5)
    const b2 = P(a + 0.3, 0.82)
    const c2 = P(a + 0.4, 1.02)
    ctx.beginPath()
    ctx.moveTo(tip[0], tip[1])
    ctx.quadraticCurveTo(c2[0], c2[1], b2[0], b2[1])
    ctx.lineWidth = 0.9
    ctx.strokeStyle = rgba('#ffffff', 0.65)
    ctx.stroke()
  }
  // 内圈凹槽 + 中心孔
  groove(ctx, circle(ctx, 0, 0, r * 0.62), 0.9)
  hole()
  ctx.fillStyle = ink(0.95)
  ctx.fill()
  hole()
  ctx.lineWidth = 1
  ctx.strokeStyle = rgba('#ffffff', 0.3)
  ctx.stroke()
  for (let i = 0; i < 4; i++) rivet(ctx, Math.cos((i * TAU) / 4 + TAU / 8) * r * 0.5, Math.sin((i * TAU) / 4 + TAU / 8) * r * 0.5, r * 0.045)
}

/** 僚机：带后掠翼的微型战机，机头炮管、座舱、尾喷口。基准 r=9，朝 +x */
export function paintDrone(ctx: Ctx, r: number, color: string): void {
  const t = tonesOf(color, -0.1)
  const b = bone(t)
  const m = metal(t)
  // 机翼：比机身亮（附肢规则）
  for (const s of [1, -1]) {
    solid(
      ctx,
      r,
      [[0.3, 0.3 * s], [-0.5, 1.08 * s], [-1.0, 1.0 * s], [-0.64, 0.3 * s]],
      b,
      { line: 1.1, flip: s < 0 },
    )
  }
  // 炮管
  solid(ctx, r, [[0.7, -0.11], [1.5, -0.11], [1.5, 0.11], [0.7, 0.11]], m, { line: 1 })
  // 机身
  soft(ctx, r, [[1.02, 0], [0.4, -0.4], [-0.5, -0.42], [-1.0, -0.24], [-1.0, 0.24], [-0.5, 0.42], [0.4, 0.4]], t, { line: 1.2 }, 0.9)
  // 座舱
  ctx.beginPath()
  ctx.ellipse(r * 0.2, 0, r * 0.36, r * 0.2, 0, 0, TAU)
  ctx.fillStyle = ink(0.88)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(r * 0.12, -r * 0.05, r * 0.15, r * 0.07, 0, 0, TAU)
  ctx.fillStyle = rgba(lighten(color, 0.5), 0.8)
  ctx.fill()
  // 尾喷口 + 翼尖灯
  lamp(ctx, -r * 1.02, 0, r * 0.16, color, 1)
  lamp(ctx, -r * 0.9, r * 0.98, r * 0.1, color, 0.8)
  lamp(ctx, -r * 0.9, -r * 0.98, r * 0.1, color, 0.8)
}

/** 地雷：六根尖刺的圆盘，中心一盏信号灯。基准 r=7 */
export function paintMine(ctx: Ctx, r: number, color: string): void {
  const t = tonesOf(color, -0.05)
  const m = metal(tonesOf(color))
  const N = 6
  const prongs: Trace = () => {
    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const a = (i * TAU) / N + TAU / 12
      ctx.moveTo(Math.cos(a - 0.3) * r * 0.8, Math.sin(a - 0.3) * r * 0.8)
      ctx.lineTo(Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5)
      ctx.lineTo(Math.cos(a + 0.3) * r * 0.8, Math.sin(a + 0.3) * r * 0.8)
      ctx.closePath()
    }
  }
  hull(ctx, prongs, r * 1.5, m, { radial: true, line: 1.2, light: -2.3 })
  hull(ctx, circle(ctx, 0, 0, r), r, t, { radial: true, line: 1.3, light: -2.3, facets: 6, phase: 0.3, facetK: 0.8 })
  groove(ctx, circle(ctx, 0, 0, r * 0.68), 0.8)
  // 灯座 + 信号灯
  plate(ctx, circle(ctx, 0, 0, r * 0.4), r * 0.4, mixHex(t.deep, '#000000', 0.3), '#05070d', { raised: false, line: 0.9 })
  lamp(ctx, 0, 0, r * 0.24, color, 1)
}

/** 脉冲弹：尖头的金属弹丸，尾部渐亮；朝 +x，约 20×7。基准 r=5（碰撞半径） */
export function paintBolt(ctx: Ctx, color: string): void {
  const body: Trace = () => {
    ctx.beginPath()
    ctx.moveTo(10.5, 0)
    ctx.quadraticCurveTo(6, -3.4, 0, -3.5)
    ctx.lineTo(-8.5, -2.4)
    ctx.lineTo(-10, 0)
    ctx.lineTo(-8.5, 2.4)
    ctx.lineTo(0, 3.5)
    ctx.quadraticCurveTo(6, 3.4, 10.5, 0)
    ctx.closePath()
  }
  body()
  ctx.lineWidth = 2.4
  ctx.strokeStyle = ink(0.9)
  ctx.stroke()
  const g = ctx.createLinearGradient(-10, 0, 10.5, 0)
  g.addColorStop(0, mixHex(color, '#0a0c14', 0.45))
  g.addColorStop(0.45, color)
  g.addColorStop(1, lighten(color, 0.7))
  ctx.fillStyle = g
  body()
  ctx.fill()
  // 弹芯：一条白热的线
  ctx.beginPath()
  ctx.moveTo(-6, 0)
  ctx.lineTo(8.5, 0)
  ctx.lineWidth = 1.7
  ctx.strokeStyle = rgba('#ffffff', 0.95)
  ctx.stroke()
  // 上缘高光
  ctx.beginPath()
  ctx.moveTo(-4, -2.4)
  ctx.quadraticCurveTo(3, -2.8, 7, -1.3)
  ctx.lineWidth = 0.8
  ctx.strokeStyle = rgba('#ffffff', 0.5)
  ctx.stroke()
}

/** 等离子球：旋涡状的能量球（叠加混合用，无描边）。基准半径 16 */
export function paintPlasma(ctx: Ctx, color: string): void {
  const R = 16
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.22, rgba(lighten(color, 0.6), 0.95))
  g.addColorStop(0.55, rgba(color, 0.5))
  g.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, R, 0, TAU)
  ctx.fill()
  // 三条旋臂：先垫一层宽而淡的，再画亮线，旋转起来像漩涡
  for (const [w, c, al] of [[4.2, color, 0.3], [1.7, lighten(color, 0.75), 0.9]] as [number, string, number][]) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * R * 0.12, Math.sin(a) * R * 0.12)
      ctx.bezierCurveTo(
        Math.cos(a + 0.5) * R * 0.5, Math.sin(a + 0.5) * R * 0.5,
        Math.cos(a + 1.3) * R * 0.74, Math.sin(a + 1.3) * R * 0.74,
        Math.cos(a + 1.9) * R * 0.86, Math.sin(a + 1.9) * R * 0.86,
      )
      ctx.lineWidth = w
      ctx.strokeStyle = rgba(c, al)
      ctx.stroke()
    }
  }
}
/**
 * 榴弹炮的炮弹：钢制弹体 + 涂装弹头 + 一圈弹带，尾部收成船尾形。朝 +x，约 25×9。
 * 圆柱的明暗是"上亮下暗"（垂直于弹轴），不是沿弹轴的渐变，所以不走 hull()。
 */
export function paintShell(ctx: Ctx, color: string): void {
  const steel = steelTones('#9fb0c8')
  const paint = tonesOf(color, -0.1)
  const body: Trace = () => {
    ctx.beginPath()
    ctx.moveTo(-11.4, -2.5)
    ctx.lineTo(-7.2, -4)
    ctx.lineTo(3.2, -4.4)
    ctx.quadraticCurveTo(8.4, -4.1, 12.6, 0)
    ctx.quadraticCurveTo(8.4, 4.1, 3.2, 4.4)
    ctx.lineTo(-7.2, 4)
    ctx.lineTo(-11.4, 2.5)
    ctx.closePath()
  }
  const across = (a: string, b: string, c: string): CanvasGradient => {
    const g = ctx.createLinearGradient(0, -4.5, 0, 4.5)
    g.addColorStop(0, a)
    g.addColorStop(0.34, b)
    g.addColorStop(1, c)
    return g
  }
  // 墨线
  body()
  ctx.lineWidth = 2.6
  ctx.strokeStyle = ink(0.95)
  ctx.stroke()
  // 弹体：钢色
  body()
  ctx.fillStyle = across(steel.hi, steel.mid, steel.lo)
  ctx.fill()
  ctx.save()
  body()
  ctx.clip()
  // 弹头涂装 + 接缝
  ctx.fillStyle = across(paint.hi, paint.mid, paint.lo)
  ctx.fillRect(3.2, -6, 11, 12)
  ctx.fillStyle = ink(0.85)
  ctx.fillRect(2.9, -6, 0.9, 12)
  // 弹带
  ctx.fillStyle = across(lighten(color, 0.5), color, mixHex(color, '#0a0c14', 0.5))
  ctx.fillRect(-5.3, -6, 2.5, 12)
  ctx.fillStyle = ink(0.8)
  ctx.fillRect(-5.5, -6, 0.6, 12)
  ctx.fillRect(-2.9, -6, 0.6, 12)
  // 尾部环槽
  ctx.fillRect(-8.6, -6, 0.7, 12)
  // 上缘高光
  ctx.beginPath()
  ctx.moveTo(-9.4, -3.1)
  ctx.lineTo(2.2, -3.5)
  ctx.lineWidth = 0.9
  ctx.strokeStyle = rgba('#ffffff', 0.4)
  ctx.stroke()
  ctx.restore()
  // 弹尖
  ctx.beginPath()
  ctx.arc(12, 0, 0.9, 0, TAU)
  ctx.fillStyle = steel.hi
  ctx.fill()
}

/** 虹吸索的夹爪：两片钢制 C 形卡爪扣在目标身上，缺口处各一盏灯。基准 r=10，没有朝向（渲染时自转） */
export function paintClamp(ctx: Ctx, r: number, color: string): void {
  const steel = steelTones(color)
  const w = r * 0.46
  for (let s = 0; s < 2; s++) {
    const a0 = s * Math.PI + 0.4
    const a1 = s * Math.PI + Math.PI - 0.4
    const arc = (rad: number): void => {
      ctx.beginPath()
      ctx.arc(0, 0, rad, a0, a1)
    }
    arc(r)
    ctx.lineWidth = w + 2.4
    ctx.strokeStyle = ink(0.95)
    ctx.lineCap = 'round'
    ctx.stroke()
    const g = ctx.createLinearGradient(-r, -r, r, r)
    g.addColorStop(0, steel.hi)
    g.addColorStop(0.5, steel.mid)
    g.addColorStop(1, steel.lo)
    arc(r)
    ctx.lineWidth = w
    ctx.strokeStyle = g
    ctx.stroke()
    // 外缘一道高光 + 中段的铆钉
    arc(r + w * 0.3)
    ctx.lineWidth = 0.8
    ctx.strokeStyle = rgba('#ffffff', 0.34)
    ctx.stroke()
    const m = (a0 + a1) / 2
    rivet(ctx, Math.cos(m) * r, Math.sin(m) * r, r * 0.07)
  }
  for (const a of [0, Math.PI]) lamp(ctx, Math.cos(a) * r, Math.sin(a) * r, r * 0.17, color, 1)
}
