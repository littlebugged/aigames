import { ENEMIES, type EnemyDef, type EnemyShape } from '../data/enemies'
import { ENEMY_IDS, SHIP_IDS, type EnemyId, type ShipId } from '../data/ids'
import { SHIPS } from '../data/ships'
import { TAU } from '../engine/math'
import type { PickupKind } from '../game/events'
import { flatTones, groove, hull, ink, lamp, plate, rivet, roundRect, tonesOf, type Tones, type Trace } from './matte'
import { lighten, mixHex, rgba } from './palette'
import { SHIP_POLY, polygon, traceEnemy } from './shapes'

/**
 * 预渲染精灵（哑光硬表面风格，工具见 matte.ts）。
 * 复杂的渐变、刻面、光效全部只在启动时画一次，运行时只做 drawImage。
 * 坐标单位是"世界单位"，内部按 ss 倍超采样，高分屏上依然锐利。
 */
export interface Sprite {
  c: HTMLCanvasElement
  /** 世界单位下的宽高 */
  w: number
  h: number
}

type Draw = (ctx: CanvasRenderingContext2D) => void

export function make(w: number, h: number, ss: number, draw: Draw): Sprite {
  const c = document.createElement('canvas')
  c.width = Math.ceil(w * ss)
  c.height = Math.ceil(h * ss)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.scale(ss, ss)
  ctx.translate(w / 2, h / 2)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  draw(ctx)
  return { c, w, h }
}

/** 带辉光的描边（只剩 Boss 的少量部件还在用）：外层彩色粗线 + 内层白色细线 */
export function neon(ctx: CanvasRenderingContext2D, color: string, ss: number, width = 2.4, glow = 12, white = 0.75): void {
  ctx.shadowColor = color
  ctx.shadowBlur = glow * ss
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.strokeStyle = rgba('#ffffff', white)
  ctx.lineWidth = Math.max(0.8, width * 0.4)
  ctx.stroke()
}

// ───────────────────────── 飞船 ─────────────────────────

const SHIP_R = 17

function traceShip(ctx: CanvasRenderingContext2D, id: ShipId, r: number): void {
  ctx.beginPath()
  SHIP_POLY[id].forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * r, y * r) : ctx.lineTo(x * r, y * r)))
  ctx.closePath()
}

/** 每艘飞船的细节布局（单位半径，y 为正的一侧，另一侧镜像） */
interface ShipLayout {
  /** 涂装板缩放 / 中心 x */
  plate: number
  plateX: number
  cockpit: { x: number; rx: number; ry: number }
  /** 喷口 */
  engines: [number, number][]
  /** 翼尖灯 */
  lights: [number, number][]
  /** 面板线 [x0, y0, x1, y1] */
  lines: [number, number, number, number][]
}

const SHIP_LAYOUT: Record<ShipId, ShipLayout> = {
  vanguard: {
    plate: 0.6,
    plateX: -0.08,
    cockpit: { x: 0.3, rx: 0.3, ry: 0.14 },
    engines: [[-0.47, 0.17]],
    lights: [[-0.7, 0.92]],
    lines: [
      [0.2, 0.12, -0.46, 0.7],
      [-0.12, 0.14, -0.6, 0.84],
    ],
  },
  phantom: {
    plate: 0.56,
    plateX: -0.02,
    cockpit: { x: 0.44, rx: 0.36, ry: 0.11 },
    engines: [[-0.5, 0.15]],
    lights: [[-0.55, 1.02]],
    lines: [
      [0.12, 0.3, -0.4, 0.9],
      [-0.1, 0.22, -0.48, 0.62],
    ],
  },
  bulwark: {
    plate: 0.66,
    plateX: -0.1,
    cockpit: { x: 0.28, rx: 0.3, ry: 0.17 },
    engines: [[-0.84, 0.3]],
    lights: [[0.55, 0.62]],
    lines: [
      [0.1, 0.2, 0.52, 0.58],
      [-0.2, 0.3, -0.3, 0.9],
    ],
  },
  reaper: {
    plate: 0.54,
    plateX: -0.08,
    cockpit: { x: 0.44, rx: 0.3, ry: 0.1 },
    engines: [[-0.8, 0.16]],
    lights: [[0.55, 0.98]],
    lines: [
      [0.22, 0.28, 0.48, 0.78],
      [-0.1, 0.4, -0.7, 0.34],
    ],
  },
}

/** 飞船船体用的"拉丝钢"色阶，带一点涂装色的倾向 */
function steelTones(tint: string): Tones {
  return {
    hi: mixHex('#eef3fa', tint, 0.16),
    mid: mixHex('#7d8aa3', tint, 0.22),
    lo: mixHex('#2f384e', tint, 0.14),
    deep: mixHex('#121726', tint, 0.1),
    accent: tint,
    glow: lighten(tint, 0.5),
  }
}

/** 喷口位置（世界单位，机体局部坐标，已镜像）：尾焰从这里喷出 */
export function engineMounts(id: ShipId): [number, number][] {
  const out: [number, number][] = []
  for (const [ex, ey] of SHIP_LAYOUT[id].engines) {
    const x = ex * SHIP_R - SHIP_R * 0.1
    out.push([x, ey * SHIP_R], [x, -ey * SHIP_R])
  }
  return out
}

function shipSprite(id: ShipId, ss: number, flash: boolean): Sprite {
  const def = SHIPS[id]
  const r = SHIP_R
  const size = (r + 9) * 2
  const L = SHIP_LAYOUT[id]
  return make(size, size, ss, (ctx) => {
    const trace: Trace = () => traceShip(ctx, id, r)
    if (flash) {
      trace()
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.lineWidth = 1.8
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      return
    }
    const steel = steelTones(def.color)
    const paint = tonesOf(def.color, -0.12)
    const mirror = (draw: (s: number) => void): void => {
      draw(1)
      draw(-1)
    }
    // 机体：钢灰底色 + 刻面
    hull(ctx, trace, r, steel, { facets: 8, phase: 0.2, facetK: 0.8, line: 1.5 })
    // 涂装板：整艘船最饱和的颜色，压在机体上
    const plateTrace: Trace = () => {
      ctx.save()
      ctx.translate(L.plateX * r, 0)
      ctx.scale(L.plate, L.plate)
      traceShip(ctx, id, r)
      ctx.restore()
    }
    plate(ctx, plateTrace, r, paint.hi, paint.lo, { raised: true, line: 0.9 })
    // 面板线
    mirror((s) => {
      for (const [x0, y0, x1, y1] of L.lines) {
        groove(
          ctx,
          () => {
            ctx.beginPath()
            ctx.moveTo(x0 * r, y0 * r * s)
            ctx.lineTo(x1 * r, y1 * r * s)
          },
          0.8,
        )
      }
    })
    // 机身中脊
    ctx.beginPath()
    ctx.moveTo(r * 0.92, 0)
    ctx.lineTo(-r * 0.42, 0)
    ctx.lineWidth = r * 0.17
    ctx.strokeStyle = rgba(steel.hi, 0.42)
    ctx.stroke()
    // 座舱：深色玻璃 + 一道高光
    const cp = L.cockpit
    ctx.beginPath()
    ctx.ellipse(cp.x * r, 0, cp.rx * r, cp.ry * r, 0, 0, TAU)
    ctx.fillStyle = ink(0.9)
    ctx.fill()
    const gl = ctx.createLinearGradient(0, -cp.ry * r, 0, cp.ry * r)
    gl.addColorStop(0, mixHex(def.color, '#050b16', 0.55))
    gl.addColorStop(1, mixHex(def.color, '#050b16', 0.88))
    ctx.beginPath()
    ctx.ellipse(cp.x * r, 0, cp.rx * r * 0.88, cp.ry * r * 0.8, 0, 0, TAU)
    ctx.fillStyle = gl
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(cp.x * r + cp.rx * r * 0.18, -cp.ry * r * 0.32, cp.rx * r * 0.5, cp.ry * r * 0.2, 0, 0, TAU)
    ctx.fillStyle = rgba('#ffffff', 0.5)
    ctx.fill()
    // 喷口：暗色喷管 + 蓝白色火舌根部
    mirror((s) => {
      for (const [ex, ey] of L.engines) {
        ctx.beginPath()
        roundRect(ctx, ex * r - r * 0.16, ey * r * s - r * 0.085, r * 0.2, r * 0.17, 1)
        ctx.fillStyle = ink(0.92)
        ctx.fill()
        lamp(ctx, ex * r - r * 0.1, ey * r * s, r * 0.075, def.color, 0.9)
      }
    })
    // 翼尖航行灯
    mirror((s) => {
      for (const [lx, ly] of L.lights) lamp(ctx, lx * r * 0.94, ly * r * 0.94 * s, r * 0.06, def.color, 0.75)
    })
  })
}

// ───────────────────────── 敌人 ─────────────────────────

/** 每种外形的哑光画法：刻面参数 + 机体下方的部件 + 机体上的细节与发光件 */
interface EnemyArt {
  facets: number
  phase: number
  radial?: boolean
  facetK?: number
  /** 画在机体下面（炮管等伸出轮廓外的部件） */
  under?: (ctx: CanvasRenderingContext2D, r: number, t: Tones) => void
  /** 机体上的细节与发光件 */
  over: (ctx: CanvasRenderingContext2D, r: number, t: Tones) => void
}

const line = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void => {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
}

const darkPlate = (t: Tones): [string, string] => [mixHex(t.lo, t.mid, 0.35), t.deep]

const ENEMY_ART: Record<EnemyShape, EnemyArt> = {
  // 无人机：飞镖
  tri: {
    facets: 6,
    phase: 0,
    over(ctx, r, t) {
      const [a, b] = darkPlate(t)
      plate(
        ctx,
        () => {
          ctx.beginPath()
          ctx.moveTo(r * 0.64, 0)
          ctx.lineTo(-r * 0.12, r * 0.27)
          ctx.lineTo(-r * 0.34, 0)
          ctx.lineTo(-r * 0.12, -r * 0.27)
          ctx.closePath()
        },
        r,
        a,
        b,
        { line: 0.7 },
      )
      // 翼前缘高光
      for (const s of [1, -1]) {
        line(ctx, r * 0.8, r * 0.08 * s, -r * 0.62, r * 0.76 * s)
        ctx.lineWidth = 0.8
        ctx.strokeStyle = rgba('#ffffff', 0.3)
        ctx.stroke()
      }
      lamp(ctx, r * 0.14, 0, r * 0.15, t.accent)
    },
  },
  // 虫群：小菱形
  diamond: {
    facets: 4,
    phase: 0,
    over(ctx, r, t) {
      line(ctx, -r * 0.46, 0, r * 0.5, 0)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = ink(0.75)
      ctx.stroke()
      lamp(ctx, r * 0.1, 0, r * 0.2, t.accent)
    },
  },
  // 重装：六边形装甲块
  hex: {
    facets: 6,
    phase: 0,
    over(ctx, r, t) {
      // 板缝：从内板顶点连向外板顶点
      groove(
        ctx,
        () => {
          ctx.beginPath()
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU
            ctx.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62)
            ctx.lineTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97)
          }
        },
        1,
      )
      const [a, b] = darkPlate(t)
      plate(
        ctx,
        () => {
          ctx.beginPath()
          polygon(ctx, 6, r * 0.62, 0)
        },
        r,
        a,
        b,
        { line: 1 },
      )
      for (let i = 0; i < 6; i++) {
        const an = ((i + 0.5) / 6) * TAU
        rivet(ctx, Math.cos(an) * r * 0.79, Math.sin(an) * r * 0.79, r * 0.05)
      }
      lamp(ctx, 0, 0, r * 0.2, t.accent)
    },
  },
  // 炮台：圆盘 + 炮管
  ring: {
    facets: 0,
    phase: 0,
    radial: true,
    under(ctx, r, t) {
      const x0 = r * 0.4
      const x1 = r * 1.14
      const hy = r * 0.18
      ctx.beginPath()
      roundRect(ctx, x0, -hy, x1 - x0, hy * 2, 1)
      ctx.lineWidth = 2.6
      ctx.strokeStyle = ink(0.95)
      ctx.stroke()
      const g = ctx.createLinearGradient(0, -hy, 0, hy)
      g.addColorStop(0, mixHex(t.hi, '#ffffff', 0.15))
      g.addColorStop(0.5, t.mid)
      g.addColorStop(1, t.lo)
      ctx.fillStyle = g
      ctx.fill()
      // 炮口
      ctx.fillStyle = t.accent
      ctx.fillRect(r * 1.0, -hy * 0.7, r * 0.14, hy * 1.4)
    },
    over(ctx, r, t) {
      const [a, b] = darkPlate(t)
      plate(
        ctx,
        () => {
          ctx.beginPath()
          ctx.arc(0, 0, r * 0.7, 0, TAU)
        },
        r,
        a,
        b,
        { line: 1 },
      )
      for (let i = 0; i < 4; i++) {
        const an = (i / 4) * TAU + Math.PI / 4
        rivet(ctx, Math.cos(an) * r * 0.86, Math.sin(an) * r * 0.86, r * 0.045)
      }
      lamp(ctx, r * 0.1, 0, r * 0.3, t.accent)
    },
  },
  // 分裂体：方块
  square: {
    facets: 4,
    phase: Math.PI / 4,
    over(ctx, r, t) {
      const R = r * 1.2
      groove(
        ctx,
        () => {
          ctx.beginPath()
          ctx.moveTo(-R * 0.76, 0)
          ctx.lineTo(R * 0.76, 0)
          ctx.moveTo(0, -R * 0.76)
          ctx.lineTo(0, R * 0.76)
        },
        1,
      )
      const [a, b] = darkPlate(t)
      plate(
        ctx,
        () => {
          ctx.beginPath()
          polygon(ctx, 4, R * 0.6, Math.PI / 4)
        },
        R,
        a,
        b,
        { line: 1 },
      )
      for (let i = 0; i < 4; i++) {
        const an = (i / 4) * TAU + Math.PI / 4
        rivet(ctx, Math.cos(an) * R * 0.8, Math.sin(an) * R * 0.8, r * 0.055)
      }
      lamp(ctx, 0, 0, r * 0.18, t.accent)
    },
  },
  // 冲锋者：V 形
  chevron: {
    facets: 6,
    phase: 0,
    over(ctx, r, t) {
      const [a, b] = darkPlate(t)
      plate(
        ctx,
        () => {
          ctx.beginPath()
          ctx.moveTo(r * 0.64, 0)
          ctx.lineTo(-r * 0.2, r * 0.48)
          ctx.lineTo(-r * 0.04, 0)
          ctx.lineTo(-r * 0.2, -r * 0.48)
          ctx.closePath()
        },
        r,
        a,
        b,
        { line: 0.8 },
      )
      for (const s of [1, -1]) {
        line(ctx, r * 0.84, r * 0.06 * s, -r * 0.44, r * 0.86 * s)
        ctx.lineWidth = 0.8
        ctx.strokeStyle = rgba('#ffffff', 0.3)
        ctx.stroke()
        lamp(ctx, -r * 0.42, r * 0.8 * s, r * 0.1, t.accent, 0.9)
      }
      lamp(ctx, r * 0.18, 0, r * 0.12, t.accent, 0.8)
    },
  },
  // 炸弹兵：带引信核心的球
  orb: {
    facets: 0,
    phase: 0,
    radial: true,
    over(ctx, r, t) {
      // 经纬线
      groove(
        ctx,
        () => {
          ctx.beginPath()
          ctx.ellipse(0, 0, r * 0.94, r * 0.38, 0, 0, TAU)
          ctx.moveTo(r * 0.38, 0)
          ctx.ellipse(0, 0, r * 0.38, r * 0.94, 0, 0, TAU)
        },
        0.9,
      )
      const [a, b] = darkPlate(t)
      plate(
        ctx,
        () => {
          ctx.beginPath()
          ctx.arc(0, 0, r * 0.46, 0, TAU)
        },
        r,
        a,
        b,
        { line: 0.9 },
      )
      lamp(ctx, 0, 0, r * 0.3, t.accent, 1.15)
    },
  },
  // 护盾兵：八边形
  oct: {
    facets: 8,
    phase: Math.PI / 8,
    over(ctx, r, t) {
      const [a, b] = darkPlate(t)
      plate(
        ctx,
        () => {
          ctx.beginPath()
          polygon(ctx, 8, r * 0.62, Math.PI / 8)
        },
        r,
        a,
        b,
        { line: 1 },
      )
      groove(
        ctx,
        () => {
          ctx.beginPath()
          ctx.arc(0, 0, r * 0.4, 0, TAU)
        },
        0.8,
      )
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * TAU
        lamp(ctx, Math.cos(an) * r * 0.79, Math.sin(an) * r * 0.79, r * 0.055, t.accent, 0.7)
      }
      lamp(ctx, 0, 0, r * 0.2, t.accent)
    },
  },
  // 幽灵：新月
  crescent: {
    facets: 6,
    phase: 0,
    over(ctx, r, t) {
      // 内弧高光
      ctx.beginPath()
      ctx.arc(-r * 0.45, 0, r * 0.76, -Math.PI * 0.42, Math.PI * 0.42)
      ctx.lineWidth = 0.9
      ctx.strokeStyle = rgba('#ffffff', 0.36)
      ctx.stroke()
      lamp(ctx, r * 0.24, 0, r * 0.18, t.accent)
    },
  },
  // 碎片：细长的晶体
  shard: {
    facets: 4,
    phase: 0,
    over(ctx, r, t) {
      line(ctx, -r * 0.5, 0, r * 0.8, 0)
      ctx.lineWidth = 0.8
      ctx.strokeStyle = rgba('#ffffff', 0.4)
      ctx.stroke()
      lamp(ctx, r * 0.3, 0, r * 0.15, t.accent, 0.8)
    },
  },
}

function enemySprite(def: EnemyDef, ss: number, flash: boolean): Sprite {
  const r = def.radius
  const size = (r + 9) * 2
  const art = ENEMY_ART[def.shape]
  return make(size, size, ss, (ctx) => {
    const trace: Trace = () => traceEnemy(ctx, def.shape, r)
    if (flash) {
      // 受击闪白：整个剪影变白（包括炮管），保持和本体同样的轮廓
      art.under?.(ctx, r, flatTones('#ffffff'))
      trace()
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.lineWidth = Math.max(1.3, r * 0.12)
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      return
    }
    const t = tonesOf(def.color)
    art.under?.(ctx, r, t)
    hull(ctx, trace, r, t, { facets: art.facets, phase: art.phase, radial: art.radial, facetK: art.facetK })
    art.over(ctx, r, t)
  })
}

// ───────────────────────── 宝石 / 拾取物 ─────────────────────────

export const GEM_COLORS = ['#3df2ff', '#6dff8a', '#ffd84a', '#ff5ccf'] as const
const GEM_R = [5, 6.6, 8.6, 11.5]

function gemSprite(tier: number, ss: number): Sprite {
  const r = GEM_R[tier]
  const col = GEM_COLORS[tier]
  const size = (r + 11) * 2
  return make(size, size, ss, (ctx) => {
    // 一圈很淡的光：乱战里掉落物要能被一眼找到，但不能糊成一片
    const hr = r * 2.2
    const hg = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, hr)
    hg.addColorStop(0, rgba(col, 0.3))
    hg.addColorStop(1, rgba(col, 0))
    ctx.fillStyle = hg
    ctx.beginPath()
    ctx.arc(0, 0, hr, 0, TAU)
    ctx.fill()
    const top: [number, number] = [0, -r * 1.25]
    const right: [number, number] = [r * 0.85, 0]
    const bottom: [number, number] = [0, r * 1.25]
    const left: [number, number] = [-r * 0.85, 0]
    const kite: Trace = () => {
      ctx.beginPath()
      ctx.moveTo(...top)
      ctx.lineTo(...right)
      ctx.lineTo(...bottom)
      ctx.lineTo(...left)
      ctx.closePath()
    }
    kite()
    ctx.lineWidth = 2.2
    ctx.strokeStyle = ink(0.92)
    ctx.stroke()
    // 四个刻面，光从左上来
    const tri = (a: [number, number], b: [number, number], fill: string): void => {
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
    }
    tri(left, top, lighten(col, 0.66))
    tri(top, right, lighten(col, 0.3))
    tri(right, bottom, mixHex(col, '#0a0c14', 0.5))
    tri(bottom, left, mixHex(col, '#0a0c14', 0.2))
    // 刻面棱线
    ctx.beginPath()
    ctx.moveTo(...top)
    ctx.lineTo(0, 0)
    ctx.lineTo(...bottom)
    ctx.moveTo(...left)
    ctx.lineTo(...right)
    ctx.lineWidth = 0.6
    ctx.strokeStyle = rgba('#ffffff', 0.35)
    ctx.stroke()
    kite()
    ctx.lineWidth = 1
    ctx.strokeStyle = ink(0.85)
    ctx.stroke()
    // 高光
    ctx.save()
    ctx.translate(-r * 0.24, -r * 0.46)
    ctx.rotate(-0.55)
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 0.1, r * 0.3, 0, 0, TAU)
    ctx.fillStyle = rgba('#ffffff', 0.85)
    ctx.fill()
    ctx.restore()
  })
}

const PICKUP_COLOR: Record<PickupKind, string> = {
  heal: '#6dff8a',
  magnet: '#5dd0ff',
  bomb: '#ff6a4d',
  chest: '#ffd84a',
  cache: '#d58bff',
}
export const PICKUP_R = 13

function pickupSprite(kind: PickupKind, ss: number): Sprite {
  const r = PICKUP_R
  const col = PICKUP_COLOR[kind]
  const size = (r + 11) * 2
  return make(size, size, ss, (ctx) => {
    // 淡光，让它在乱战里依然醒目
    const hr = r * 2
    const hg = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, hr)
    hg.addColorStop(0, rgba(col, 0.22))
    hg.addColorStop(1, rgba(col, 0))
    ctx.fillStyle = hg
    ctx.beginPath()
    ctx.arc(0, 0, hr, 0, TAU)
    ctx.fill()

    const trace: Trace = () => {
      ctx.beginPath()
      switch (kind) {
        case 'heal':
        case 'magnet':
          ctx.arc(0, 0, r, 0, TAU)
          break
        case 'bomb':
          polygon(ctx, 8, r, Math.PI / 8)
          break
        case 'chest':
          roundRect(ctx, -r * 0.98, -r * 0.78, r * 1.96, r * 1.56, 3)
          break
        case 'cache':
          ctx.moveTo(0, -r * 1.2)
          ctx.lineTo(r * 0.95, 0)
          ctx.lineTo(0, r * 1.2)
          ctx.lineTo(-r * 0.95, 0)
          ctx.closePath()
          break
      }
    }
    // 金属外圈：亮色，像拉丝的金属边
    const ring = tonesOf(col, -0.3)
    hull(ctx, trace, r, { ...ring, hi: lighten(col, 0.55), mid: col, lo: mixHex(col, '#0a0c14', 0.45) }, { radial: true, line: 1.5 })
    // 内嵌深色玻璃：让白色图标压得住
    const inner = (k: number): Trace => () => {
      ctx.save()
      ctx.scale(k, k)
      trace()
      ctx.restore()
    }
    plate(ctx, inner(0.72), r, mixHex(col, '#05070d', 0.82), mixHex(col, '#05070d', 0.62), { line: 0.9 })
    // 图标：亮色 + 墨色衬底，保证任何背景上都清楚
    const icon = (): void => {
      ctx.beginPath()
      switch (kind) {
        case 'heal':
          ctx.moveTo(-r * 0.4, 0)
          ctx.lineTo(r * 0.4, 0)
          ctx.moveTo(0, -r * 0.4)
          ctx.lineTo(0, r * 0.4)
          break
        case 'magnet':
          ctx.arc(0, -r * 0.04, r * 0.36, Math.PI, 0)
          ctx.moveTo(-r * 0.36, -r * 0.04)
          ctx.lineTo(-r * 0.36, r * 0.38)
          ctx.moveTo(r * 0.36, -r * 0.04)
          ctx.lineTo(r * 0.36, r * 0.38)
          break
        case 'bomb':
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * TAU + Math.PI / 4
            ctx.moveTo(Math.cos(a) * r * 0.14, Math.sin(a) * r * 0.14)
            ctx.lineTo(Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46)
          }
          break
        case 'chest':
          ctx.moveTo(-r * 0.7, -r * 0.14)
          ctx.lineTo(r * 0.7, -r * 0.14)
          ctx.moveTo(0, -r * 0.14)
          ctx.lineTo(0, r * 0.3)
          break
        case 'cache':
          ctx.moveTo(0, -r * 0.46)
          ctx.lineTo(0, r * 0.46)
          ctx.moveTo(-r * 0.36, 0)
          ctx.lineTo(r * 0.36, 0)
          break
      }
    }
    icon()
    ctx.lineWidth = 3.6
    ctx.strokeStyle = ink(0.7)
    ctx.stroke()
    icon()
    ctx.lineWidth = 2.1
    ctx.strokeStyle = lighten(col, 0.72)
    ctx.stroke()
  })
}

// ───────────────────────── 武器小件 ─────────────────────────

/** 环绕刃：一片锋利的双面刀锋 */
function bladeSprite(color: string, ss: number): Sprite {
  const r = 20
  const size = (r + 8) * 2
  return make(size, size, ss, (ctx) => {
    const t = tonesOf(color, -0.18)
    const blade: Trace = () => {
      ctx.beginPath()
      ctx.moveTo(r, 0)
      ctx.lineTo(0, r * 0.38)
      ctx.lineTo(-r * 0.75, 0)
      ctx.lineTo(0, -r * 0.38)
      ctx.closePath()
    }
    blade()
    ctx.lineWidth = 3.2
    ctx.strokeStyle = ink(0.92)
    ctx.stroke()
    // 上下两个斜面：上亮下暗，中间一道脊
    ctx.save()
    blade()
    ctx.clip()
    const up = ctx.createLinearGradient(r, 0, -r * 0.75, 0)
    up.addColorStop(0, '#ffffff')
    up.addColorStop(0.35, lighten(color, 0.5))
    up.addColorStop(1, t.mid)
    ctx.fillStyle = up
    ctx.fillRect(-r, -r, r * 2, r)
    const dn = ctx.createLinearGradient(r, 0, -r * 0.75, 0)
    dn.addColorStop(0, lighten(color, 0.2))
    dn.addColorStop(0.4, color)
    dn.addColorStop(1, t.lo)
    ctx.fillStyle = dn
    ctx.fillRect(-r, 0, r * 2, r)
    ctx.restore()
    // 脊线
    ctx.beginPath()
    ctx.moveTo(r * 0.94, 0)
    ctx.lineTo(-r * 0.6, 0)
    ctx.lineWidth = 0.9
    ctx.strokeStyle = rgba('#ffffff', 0.8)
    ctx.stroke()
    // 刃口
    blade()
    ctx.lineWidth = 1
    ctx.strokeStyle = rgba('#ffffff', 0.55)
    ctx.stroke()
    // 尾部固定孔
    rivet(ctx, -r * 0.42, 0, r * 0.07)
  })
}

/** 回旋飞轮：带四枚尖齿的金属环 */
function chakramSprite(color: string, ss: number): Sprite {
  const r = 14
  const size = (r + 12) * 2
  return make(size, size, ss, (ctx) => {
    const t = tonesOf(color, -0.15)
    const body: Trace = () => {
      ctx.beginPath()
      // 四枚尖齿
      for (let i = 0; i < 4; i++) {
        const a = (i * TAU) / 4
        ctx.moveTo(Math.cos(a - 0.6) * r * 0.78, Math.sin(a - 0.6) * r * 0.78)
        ctx.lineTo(Math.cos(a) * r * 1.42, Math.sin(a) * r * 1.42)
        ctx.lineTo(Math.cos(a + 0.6) * r * 0.78, Math.sin(a + 0.6) * r * 0.78)
        ctx.closePath()
      }
      // 外环
      ctx.moveTo(r * 0.9, 0)
      ctx.arc(0, 0, r * 0.9, 0, TAU)
    }
    const hole: Trace = () => {
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.34, 0, TAU)
    }
    body()
    ctx.lineWidth = 3
    ctx.strokeStyle = ink(0.92)
    ctx.stroke()
    // 环体：金属渐变；中心孔掏空
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.45)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.35, lighten(color, 0.4))
    g.addColorStop(0.7, t.mid)
    g.addColorStop(1, t.lo)
    ctx.fillStyle = g
    ctx.fill('nonzero')
    // 刻面：四个扇区明暗
    ctx.save()
    body()
    ctx.clip()
    for (let i = 0; i < 4; i++) {
      const a0 = (i * TAU) / 4 - Math.PI / 4
      const a1 = a0 + Math.PI / 2
      ctx.fillStyle = i % 2 === 0 ? rgba('#ffffff', 0.12) : rgba('#000000', 0.2)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(a0) * r * 2, Math.sin(a0) * r * 2)
      ctx.lineTo(Math.cos(a1) * r * 2, Math.sin(a1) * r * 2)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
    // 内圈凹槽 + 中心孔
    groove(
      ctx,
      () => {
        ctx.beginPath()
        ctx.arc(0, 0, r * 0.62, 0, TAU)
      },
      0.9,
    )
    hole()
    ctx.fillStyle = ink(0.95)
    ctx.fill()
    hole()
    ctx.lineWidth = 1
    ctx.strokeStyle = rgba('#ffffff', 0.3)
    ctx.stroke()
    // 齿尖高光
    for (let i = 0; i < 4; i++) {
      const a = (i * TAU) / 4
      line(ctx, Math.cos(a) * r * 1.0, Math.sin(a) * r * 1.0, Math.cos(a) * r * 1.34, Math.sin(a) * r * 1.34)
      ctx.lineWidth = 0.9
      ctx.strokeStyle = rgba('#ffffff', 0.6)
      ctx.stroke()
    }
  })
}

/** 僚机：小型战斗机 */
function droneSprite(color: string, ss: number): Sprite {
  const r = 8
  const size = (r + 8) * 2
  return make(size, size, ss, (ctx) => {
    const t = tonesOf(color, -0.1)
    const trace: Trace = () => {
      ctx.beginPath()
      ctx.moveTo(r, 0)
      ctx.lineTo(-r * 0.8, r * 0.75)
      ctx.lineTo(-r * 0.4, 0)
      ctx.lineTo(-r * 0.8, -r * 0.75)
      ctx.closePath()
    }
    hull(ctx, trace, r, t, { facets: 4, line: 1.2 })
    ctx.beginPath()
    ctx.ellipse(r * 0.12, 0, r * 0.3, r * 0.14, 0, 0, TAU)
    ctx.fillStyle = ink(0.85)
    ctx.fill()
    lamp(ctx, -r * 0.34, 0, r * 0.14, color, 0.9)
  })
}

/**
 * 圆点子弹：深色描边 + 实心彩色球体 + 白色高光。
 * 比纯辉光点锐利得多，弹幕再密也能数清每一颗（描边在亮背景上也能分辨）。
 */
function beadSprite(color: string, ss: number): Sprite {
  const r = 8
  const size = r * 2 + 10
  return make(size, size, ss, (ctx) => {
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    ctx.fillStyle = ink(0.85)
    ctx.fill()
    const g = ctx.createRadialGradient(-r * 0.25, -r * 0.3, 0, 0, 0, r * 0.88)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.32, lighten(color, 0.55))
    g.addColorStop(0.78, color)
    g.addColorStop(1, mixHex(color, '#080a12', 0.4))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.82, 0, TAU)
    ctx.fill()
  })
}

/** 导弹：金属弹体 + 彩色弹头带 + 尾翼，车头朝 +x */
function missileSprite(color: string, ss: number): Sprite {
  const w = 28
  const h = 20
  return make(w, h, ss, (ctx) => {
    // 尾翼
    for (const s of [1, -1]) {
      ctx.beginPath()
      ctx.moveTo(-3.5, 2.7 * s)
      ctx.lineTo(-8.2, 6.2 * s)
      ctx.lineTo(-6.4, 2.7 * s)
      ctx.closePath()
      ctx.lineWidth = 2.4
      ctx.strokeStyle = ink(0.92)
      ctx.stroke()
      ctx.fillStyle = mixHex(color, '#202638', 0.5)
      ctx.fill()
    }
    const body = (): void => {
      ctx.beginPath()
      ctx.moveTo(10, 0)
      ctx.quadraticCurveTo(6.2, 3.2, 1.5, 3.2)
      ctx.lineTo(-6.4, 3.2)
      ctx.lineTo(-6.4, -3.2)
      ctx.lineTo(1.5, -3.2)
      ctx.quadraticCurveTo(6.2, -3.2, 10, 0)
      ctx.closePath()
    }
    body()
    ctx.lineWidth = 2.6
    ctx.strokeStyle = ink(0.95)
    ctx.stroke()
    const g = ctx.createLinearGradient(0, -3.2, 0, 3.2)
    g.addColorStop(0, '#f1f5fb')
    g.addColorStop(0.5, '#8d99b0')
    g.addColorStop(1, '#2d3548')
    ctx.fillStyle = g
    ctx.fill()
    // 弹头色带
    ctx.save()
    body()
    ctx.clip()
    ctx.fillStyle = color
    ctx.fillRect(2.2, -4, 2.4, 8)
    const nose = ctx.createLinearGradient(5, 0, 10.5, 0)
    nose.addColorStop(0, mixHex(color, '#ffffff', 0.15))
    nose.addColorStop(1, mixHex(color, '#0a0c14', 0.35))
    ctx.fillStyle = nose
    ctx.fillRect(5, -4, 6, 8)
    ctx.restore()
    body()
    ctx.lineWidth = 0.9
    ctx.strokeStyle = ink(0.8)
    ctx.stroke()
  })
}

/** 引擎火焰：朝 -x 拖出的水滴，白芯 → 颜色 → 透明；用 'lighter' 叠画 */
function flameSprite(color: string, ss: number): Sprite {
  const w = 40
  const h = 20
  return make(w, h, ss, (ctx) => {
    // 局部坐标原点在精灵中心；火焰根部在 x=-w/2+4，尖端指向 +x 方向由绘制端翻转
    const x0 = -w / 2 + 3
    const x1 = w / 2 - 1
    const g = ctx.createLinearGradient(x0, 0, x1, 0)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.18, rgba(lighten(color, 0.55), 0.95))
    g.addColorStop(0.55, rgba(color, 0.55))
    g.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(x0, -h * 0.3)
    ctx.quadraticCurveTo((x0 + x1) * 0.42, -h * 0.34, x1, 0)
    ctx.quadraticCurveTo((x0 + x1) * 0.42, h * 0.34, x0, h * 0.3)
    ctx.closePath()
    ctx.fill()
  })
}

/** 径向光点：白芯 → 颜色 → 透明。只用在爆炸闪光、拖尾粒子这类"本来就该发光"的地方 */
function glowSprite(color: string, ss: number): Sprite {
  const size = 64
  return make(size, size, Math.max(1, ss * 0.5), (ctx) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.14, rgba(lighten(color, 0.5), 0.92))
    g.addColorStop(0.36, rgba(color, 0.4))
    g.addColorStop(0.62, rgba(color, 0.1))
    g.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = g
    ctx.fillRect(-size / 2, -size / 2, size, size)
  })
}

/** 接触阴影：一团柔和的暗斑，垫在地面上让单位"浮"在背景之上 */
function shadowSprite(ss: number): Sprite {
  const size = 64
  return make(size, size, Math.max(1, ss * 0.5), (ctx) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2)
    g.addColorStop(0, 'rgba(2,3,10,0.72)')
    g.addColorStop(0.55, 'rgba(2,3,10,0.38)')
    g.addColorStop(1, 'rgba(2,3,10,0)')
    ctx.fillStyle = g
    ctx.fillRect(-size / 2, -size / 2, size, size)
  })
}

// ───────────────────────── 精灵库 ─────────────────────────

export class SpriteBank {
  readonly ss: number
  readonly enemy = {} as Record<EnemyId, { n: Sprite; f: Sprite }>
  readonly ship = {} as Record<ShipId, { n: Sprite; f: Sprite }>
  readonly gem: Sprite[] = []
  readonly pickup = {} as Record<PickupKind, Sprite>
  readonly shadow: Sprite
  private readonly glows = new Map<string, Sprite>()
  private readonly blades = new Map<string, Sprite>()
  private readonly drones = new Map<string, Sprite>()
  private readonly chakrams = new Map<string, Sprite>()
  private readonly beads = new Map<string, Sprite>()
  private readonly flames = new Map<string, Sprite>()
  private readonly missiles = new Map<string, Sprite>()

  constructor(ss: number) {
    this.ss = ss
    for (const id of ENEMY_IDS) {
      const def = ENEMIES[id]
      this.enemy[id] = { n: enemySprite(def, ss, false), f: enemySprite(def, ss, true) }
    }
    for (const id of SHIP_IDS) this.ship[id] = { n: shipSprite(id, ss, false), f: shipSprite(id, ss, true) }
    for (let i = 0; i < 4; i++) this.gem.push(gemSprite(i, ss))
    for (const k of Object.keys(PICKUP_COLOR) as PickupKind[]) this.pickup[k] = pickupSprite(k, ss)
    this.shadow = shadowSprite(ss)
  }

  private cached(map: Map<string, Sprite>, color: string, build: (c: string, ss: number) => Sprite): Sprite {
    let s = map.get(color)
    if (!s) {
      s = build(color, this.ss)
      map.set(color, s)
    }
    return s
  }

  glow(color: string): Sprite {
    return this.cached(this.glows, color, glowSprite)
  }

  blade(color: string): Sprite {
    return this.cached(this.blades, color, bladeSprite)
  }

  drone(color: string): Sprite {
    return this.cached(this.drones, color, droneSprite)
  }

  chakram(color: string): Sprite {
    return this.cached(this.chakrams, color, chakramSprite)
  }

  /** 圆点子弹 */
  bead(color: string): Sprite {
    return this.cached(this.beads, color, beadSprite)
  }

  /** 引擎火焰 */
  flame(color: string): Sprite {
    return this.cached(this.flames, color, flameSprite)
  }

  /** 导弹 */
  missile(color: string): Sprite {
    return this.cached(this.missiles, color, missileSprite)
  }
}

export { PICKUP_COLOR, SHIP_R }
