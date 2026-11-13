import type { ShipId } from '../data/ids'
import { TAU } from '../engine/math'
import { groove, ink, lamp, plate, rivet, tonesOf, type HullOpts, type Tones } from './matte'
import { lighten, mixHex, rgba } from './palette'
import { bounds, flipY, line, mirror, poly, solid, type Ctx, type Pt } from './parts'

/**
 * 飞船设计（v1.5）：四架飞船各有不同的剪影，而不是四个换了涂装的箭头。
 *
 *   先锋 vanguard — 均衡型战斗机：后掠三角翼 + 鸭翼 + 两侧发动机舱 + 尾翼
 *   幽影 phantom  — 隐身突击机：前掠翼 + 细长机身，薄而锋利
 *   堡垒 bulwark  — 重型炮艇：双侧装甲舱 + 向前伸出的双炮管，宽而厚
 *   收割者 reaper — 玻璃大炮：镰刀形的新月翼，翼尖朝前像两只爪
 *
 * 配色：机体是带一点涂装色倾向的拉丝钢，涂装板用飞船的主色压在上面，发光件（喷口 / 翼尖灯）最亮。
 * 单位是"美术半径 R"，车头朝 +x，左右对称。
 */

export interface ShipArt {
  /** 轮廓离中心最远是 R 的多少倍（决定画布大小） */
  reach: number
  /** 喷口位置（单位 R，含左右两侧）：尾焰从这里喷出 */
  engines: Pt[]
  paint: (ctx: Ctx, R: number, steel: Tones, paintT: Tones, color: string) => void
}

/** 飞船船体用的"拉丝钢"色阶，带一点涂装色的倾向 */
export function steelTones(tint: string): Tones {
  return {
    hi: mixHex('#eef3fa', tint, 0.16),
    mid: mixHex('#7d8aa3', tint, 0.22),
    lo: mixHex('#2f384e', tint, 0.14),
    deep: mixHex('#121726', tint, 0.1),
    accent: tint,
    glow: lighten(tint, 0.5),
  }
}

/** 比机体更暗的一套：发动机舱、炮管 */
const darkSteel = (t: Tones): Tones => ({ ...t, hi: t.mid, mid: t.lo, lo: t.deep })

/** 座舱：深色玻璃 + 一道高光 */
function canopy(ctx: Ctx, R: number, x: number, rx: number, ry: number, color: string): void {
  ctx.beginPath()
  ctx.ellipse(x * R, 0, rx * R, ry * R, 0, 0, TAU)
  ctx.fillStyle = ink(0.92)
  ctx.fill()
  const g = ctx.createLinearGradient(0, -ry * R, 0, ry * R)
  g.addColorStop(0, mixHex(color, '#050b16', 0.5))
  g.addColorStop(1, mixHex(color, '#050b16', 0.86))
  ctx.beginPath()
  ctx.ellipse(x * R, 0, rx * R * 0.86, ry * R * 0.78, 0, 0, TAU)
  ctx.fillStyle = g
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(x * R + rx * R * 0.2, -ry * R * 0.3, rx * R * 0.5, ry * R * 0.2, 0, 0, TAU)
  ctx.fillStyle = rgba('#ffffff', 0.55)
  ctx.fill()
}

/** 喷口：暗色喷管 + 发光的口 */
function nozzle(ctx: Ctx, R: number, x: number, y: number, w: number, h: number, color: string): void {
  const pts: Pt[] = [
    [x + w * 0.5, y - h * 0.5],
    [x - w * 0.5, y - h * 0.5],
    [x - w * 0.5, y + h * 0.5],
    [x + w * 0.5, y + h * 0.5],
  ]
  solid(ctx, R, pts, tonesOf('#6b7690', 0.1), { rim: 0.5, line: 1 })
  lamp(ctx, (x - w * 0.5) * R, y * R, h * R * 0.34, color, 0.95)
}

/**
 * 压在机体上的涂装板（整艘船最饱和的颜色）。
 * s=±1 表示左右两侧的那一块：明暗按"外缘受光"镜像，两侧才会一样亮；s=0 是中轴上的。
 */
function paintPlate(ctx: Ctx, R: number, pts: readonly Pt[], p: Tones, s = 0): void {
  const b = bounds(pts, R)
  plate(ctx, () => poly(ctx, R, pts), Math.max(b.hy, R * 0.12), p.hi, p.lo, { raised: true, line: 0.9, cy: b.cy, flip: s > 0 })
}

/** 一侧的部件：左右两侧用镜像的明暗（外缘受光），避免一边亮一边暗 */
function side(ctx: Ctx, R: number, pts: readonly Pt[], s: number, t: Tones, o: HullOpts = {}): void {
  solid(ctx, R, flipY(pts, s), t, { ...o, flip: s > 0, light: s > 0 ? 0.7 : -0.7 })
}

const vanguard: ShipArt = {
  reach: 1.2,
  engines: [[-1.12, 0.39], [-1.12, -0.39]],
  paint(ctx, R, st, p, color) {
    const dk = darkSteel(st)
    for (const s of [1, -1]) {
      // 尾翼
      side(ctx, R, [[-0.6, 0.44], [-0.98, 0.86], [-1.04, 0.5], [-0.9, 0.4]], s, dk, { rim: 0.5, line: 1.2 })
      // 发动机舱
      side(ctx, R, [[-0.3, 0.28], [-1.02, 0.28], [-1.02, 0.5], [-0.3, 0.5]], s, dk, { rim: 0.6, line: 1.2 })
      nozzle(ctx, R, -1.04, 0.39 * s, 0.16, 0.2, color)
      // 后掠三角翼 + 涂装
      side(ctx, R, [[0.46, 0.2], [0.0, 0.96], [-0.52, 1.04], [-0.66, 0.9], [-0.4, 0.36], [-0.46, 0.2]], s, st, { rim: 0.9, line: 1.5 })
      paintPlate(ctx, R, flipY([[0.3, 0.3], [0.0, 0.78], [-0.34, 0.84], [-0.28, 0.4]], s), p, s)
      groove(ctx, line(ctx, R, 0.08, 0.3 * s, -0.46, 0.76 * s), 0.8)
      // 鸭翼
      side(ctx, R, [[0.74, 0.08], [0.54, 0.52], [0.36, 0.52], [0.46, 0.08]], s, st, { rim: 0.8, line: 1.2 })
      lamp(ctx, -0.6 * R, 0.98 * R * s, 0.06 * R, color, 0.8)
    }
    // 机身
    solid(ctx, R, mirror([[1.14, 0], [0.74, 0.1], [0.24, 0.2], [-0.5, 0.27], [-0.88, 0.2], [-1.04, 0]]), st, { rim: 1, line: 1.6 })
    paintPlate(ctx, R, [[0.86, 0], [0.4, 0.08], [-0.62, 0.14], [-0.62, -0.14], [0.4, -0.08]], p)
    canopy(ctx, R, 0.36, 0.27, 0.1, color)
  },
}

const phantom: ShipArt = {
  reach: 1.34,
  engines: [[-1.17, 0.14], [-1.17, -0.14]],
  paint(ctx, R, st, p, color) {
    const dk = darkSteel(st)
    for (const s of [1, -1]) {
      // 后尾翼
      side(ctx, R, [[-0.5, 0.2], [-0.98, 0.68], [-1.06, 0.44], [-0.84, 0.2]], s, dk, { rim: 0.5, line: 1.2 })
      // 前掠翼：越往外越靠前，像一把反向的刀
      side(ctx, R, [[0.04, 0.2], [0.68, 1.06], [0.44, 1.1], [-0.74, 0.26]], s, st, { rim: 0.9, line: 1.5 })
      paintPlate(ctx, R, flipY([[0.0, 0.32], [0.5, 0.94], [0.36, 0.96], [-0.44, 0.34]], s), p, s)
      lamp(ctx, 0.62 * R, 1.04 * R * s, 0.065 * R, color, 0.85)
      // 进气口
      groove(ctx, line(ctx, R, 0.34, 0.27 * s, 0.1, 0.3 * s), 0.9)
    }
    // 机身
    solid(ctx, R, mirror([[1.34, 0], [0.96, 0.1], [0.2, 0.24], [-0.6, 0.24], [-0.96, 0.1], [-1.1, 0]]), st, { rim: 1, line: 1.6 })
    paintPlate(ctx, R, [[1.0, 0], [0.5, 0.08], [-0.8, 0.12], [-0.8, -0.12], [0.5, -0.08]], p)
    canopy(ctx, R, 0.56, 0.38, 0.1, color)
    for (const s of [1, -1]) nozzle(ctx, R, -1.1, 0.14 * s, 0.14, 0.18, color)
  },
}

const bulwark: ShipArt = {
  reach: 1.46,
  engines: [[-1.16, 0], [-0.96, 0.72], [-0.96, -0.72]],
  paint(ctx, R, st, p, color) {
    const dk = darkSteel(st)
    for (const s of [1, -1]) {
      // 炮管 + 炮口
      side(ctx, R, [[0.98, 0.66], [1.4, 0.66], [1.4, 0.84], [0.98, 0.84]], s, dk, { rim: 0.8, line: 1.2 })
      side(ctx, R, [[1.28, 0.6], [1.46, 0.6], [1.46, 0.9], [1.28, 0.9]], s, dk, { rim: 0.8, line: 1.2 })
      lamp(ctx, 1.46 * R, 0.75 * R * s, 0.07 * R, color, 0.9)
      // 侧舱 + 顶部装甲涂装
      side(ctx, R, [[0.98, 0.46], [0.98, 1.0], [0.62, 1.12], [-0.46, 1.12], [-0.82, 0.94], [-0.82, 0.46]], s, st, {
        rim: 0.9,
        line: 1.6,
        facets: 6,
        facetK: 0.6,
      })
      paintPlate(ctx, R, flipY([[0.78, 0.58], [0.78, 0.98], [0.56, 1.0], [-0.44, 1.0], [-0.68, 0.86], [-0.68, 0.58]], s), p, s)
      groove(ctx, line(ctx, R, 0.2, 0.6 * s, 0.2, 0.98 * s), 0.9)
      groove(ctx, line(ctx, R, -0.2, 0.6 * s, -0.2, 0.98 * s), 0.9)
      nozzle(ctx, R, -0.86, 0.72 * s, 0.2, 0.26, color)
      for (const [x, y] of [[0.88, 0.54], [-0.72, 0.54], [0.88, 0.94], [-0.7, 0.9]]) rivet(ctx, x * R, y * R * s, 0.035 * R)
    }
    // 中间的主机身
    solid(ctx, R, mirror([[0.88, 0], [0.62, 0.46], [-0.2, 0.56], [-0.9, 0.46], [-1.06, 0]]), st, { rim: 1, line: 1.7, facets: 6, facetK: 0.5 })
    paintPlate(ctx, R, [[0.62, 0], [0.32, 0.28], [-0.5, 0.32], [-0.84, 0.2], [-0.84, -0.2], [-0.5, -0.32], [0.32, -0.28]], p)
    canopy(ctx, R, 0.3, 0.26, 0.15, color)
    nozzle(ctx, R, -1.06, 0, 0.2, 0.34, color)
  },
}

const reaper: ShipArt = {
  reach: 1.42,
  engines: [[-1.09, 0.13], [-1.09, -0.13]],
  paint(ctx, R, st, p, color) {
    const dk = darkSteel(st)
    for (const s of [1, -1]) {
      // 镰刀形新月翼：翼尖朝前
      const wing = flipY(
        [
          [-0.7, 0.24],
          [-0.92, 0.68],
          [-0.52, 1.06],
          [0.14, 1.18],
          [0.9, 1.04],
          [0.26, 0.86],
          [-0.18, 0.62],
          [-0.34, 0.24],
        ],
        s,
      )
      solid(ctx, R, wing, st, { rim: 0.9, line: 1.5, flip: s > 0, light: s > 0 ? 0.7 : -0.7 })
      paintPlate(ctx, R, flipY([[-0.58, 0.4], [-0.7, 0.68], [-0.4, 0.94], [0.1, 1.04], [0.36, 0.98], [-0.04, 0.78], [-0.3, 0.54]], s), p, s)
      groove(ctx, line(ctx, R, -0.1, 0.5 * s, 0.6, 0.98 * s), 0.8)
      lamp(ctx, 0.88 * R, 1.03 * R * s, 0.07 * R, color, 0.9)
      // 机身两侧的小鳍
      side(ctx, R, [[0.2, 0.16], [0.0, 0.42], [-0.2, 0.2]], s, dk, { rim: 0.5, line: 1 })
    }
    // 机身
    solid(ctx, R, mirror([[1.4, 0], [0.62, 0.1], [-0.3, 0.2], [-0.9, 0.15], [-1.02, 0]]), st, { rim: 1, line: 1.5 })
    paintPlate(ctx, R, [[1.04, 0], [0.3, 0.07], [-0.72, 0.12], [-0.72, -0.12], [0.3, -0.07]], p)
    canopy(ctx, R, 0.46, 0.3, 0.09, color)
    for (const s of [1, -1]) nozzle(ctx, R, -1.02, 0.13 * s, 0.14, 0.17, color)
  },
}

export const SHIP_ART: Record<ShipId, ShipArt> = { vanguard, phantom, bulwark, reaper }
