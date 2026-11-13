import { ENEMIES, type EnemyDef } from '../data/enemies'
import { ENEMY_IDS, SHIP_IDS, type EnemyId, type ShipId } from '../data/ids'
import { SHIPS } from '../data/ships'
import { TAU } from '../engine/math'
import type { PickupKind } from '../game/events'
import { flatTones, groove, hull, ink, lamp, plate, rivet, roundRect, tonesOf, type Tones, type Trace } from './matte'
import { lighten, mixHex, rgba } from './palette'
import { CREATURES } from './creatures'
import { SHIP_ART, steelTones } from './shipart'
import { polygon } from './shapes'

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

const SHIP_R = 15

/** 喷口位置（世界单位，机体局部坐标，含左右两侧）：尾焰从这里喷出 */
export function engineMounts(id: ShipId): [number, number][] {
  return SHIP_ART[id].engines.map(([x, y]) => [x * SHIP_R, y * SHIP_R])
}

/** 飞船精灵：外形由 shipart.ts 的部件拼成；受击闪白 = 在成品上用 source-atop 盖一层白 */
function shipSprite(id: ShipId, ss: number, flash: boolean): Sprite {
  const def = SHIPS[id]
  const art = SHIP_ART[id]
  const half = Math.ceil(SHIP_R * art.reach + 4)
  return make(half * 2, half * 2, ss, (ctx) => {
    art.paint(ctx, SHIP_R, steelTones(def.color), tonesOf(def.color, -0.12), def.color)
    if (flash) {
      ctx.globalCompositeOperation = 'source-atop'
      ctx.fillStyle = rgba('#ffffff', 0.9)
      ctx.fillRect(-half, -half, half * 2, half * 2)
    }
  })
}

/**
 * 机库 / 结算界面的飞船立绘：和局内同一套部件，机头朝上并带尾焰。
 * 独立画布（不依赖 SpriteBank，菜单阶段就能用）；px 是 CSS 像素边长，内部按设备像素比超采样。
 */
export function shipPortrait(id: ShipId, px: number): HTMLCanvasElement {
  const dpr = Math.min(3, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)))
  const spr = shipSprite(id, Math.max(2, dpr * 1.5), false)
  const flame = flameSprite(SHIPS[id].color, 2)
  const c = document.createElement('canvas')
  c.width = c.height = Math.round(px * dpr)
  c.style.width = c.style.height = `${px}px`
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.imageSmoothingQuality = 'high'
  ctx.scale(dpr, dpr)
  ctx.translate(px / 2, px / 2)
  ctx.rotate(-Math.PI / 2)
  const k = (px * 0.9) / spr.w
  ctx.scale(k, k)
  ctx.globalCompositeOperation = 'lighter'
  for (const [mx, my] of engineMounts(id)) {
    ctx.save()
    ctx.translate(mx, my)
    ctx.rotate(Math.PI)
    ctx.scale(12 / 36, 5 / 12)
    ctx.drawImage(flame.c, 17 - flame.w / 2, -flame.h / 2, flame.w, flame.h)
    ctx.restore()
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h)
  return c
}

// ───────────────────────── 敌人 ─────────────────────────

const line = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void => {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
}

/** 敌人精灵：外形由 creatures.ts 的部件拼成；受击闪白 = 在成品上用 source-atop 盖一层白 */
function enemySprite(def: EnemyDef, ss: number, flash: boolean): Sprite {
  const c = CREATURES[def.shape]
  const R = def.radius * c.scale
  const half = Math.ceil(R * c.reach + 4)
  return make(half * 2, half * 2, ss, (ctx) => {
    c.paint(ctx, R, tonesOf(def.color))
    if (flash) {
      // 保留一点墨线和刻面，闪的时候还看得出是谁，而不是一团白斑
      ctx.globalCompositeOperation = 'source-atop'
      ctx.fillStyle = rgba('#ffffff', 0.9)
      ctx.fillRect(-half, -half, half * 2, half * 2)
    }
  })
}

// ───────────────────────── 宝石 / 拾取物 ─────────────────────────

export const GEM_COLORS = ['#3df2ff', '#6dff8a', '#ffd84a', '#ff5ccf'] as const
const GEM_R = [5, 6.6, 8.6, 11.5]

type P2 = [number, number]

/**
 * 一颗刻面宝石：墨线底 → 按边的朝向给每个三角刻面上不同明暗（光从左上来）→ 棱线 → 外轮廓。
 * pts 是按顺时针排列的外轮廓；c 是刻面汇聚的中心点。
 */
function cut(ctx: CanvasRenderingContext2D, pts: P2[], c: P2, col: string): void {
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

/** 四档宝石四种切工：碎晶 → 祖母绿 → 明亮式 → 晶簇，除了颜色和大小，轮廓本身也一眼能分出档次 */
function gemSprite(tier: number, ss: number, halo = true): Sprite {
  const r = GEM_R[tier]
  const col = GEM_COLORS[tier]
  const size = (r + 11) * 2
  return make(size, size, ss, (ctx) => {
    // 一圈很淡的光：乱战里掉落物要能被一眼找到，但不能糊成一片
    if (halo) {
      const hr = r * 2.2
      const hg = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, hr)
      hg.addColorStop(0, rgba(col, 0.3))
      hg.addColorStop(1, rgba(col, 0))
      ctx.fillStyle = hg
      ctx.beginPath()
      ctx.arc(0, 0, hr, 0, TAU)
      ctx.fill()
    }

    if (tier === 0) {
      // 碎晶：细长的菱形棱柱
      cut(ctx, [[0, -r * 1.5], [r * 0.7, -r * 0.1], [0, r * 1.3], [-r * 0.7, -r * 0.1]], [0, -r * 0.1], col)
    } else if (tier === 1) {
      // 祖母绿：上下尖角的六边形
      cut(ctx, [[0, -r * 1.3], [r * 0.82, -r * 0.55], [r * 0.82, r * 0.55], [0, r * 1.3], [-r * 0.82, r * 0.55], [-r * 0.82, -r * 0.55]], [0, 0], col)
    } else if (tier === 2) {
      // 明亮式：平顶 + 宽腰 + 尖底，经典钻石轮廓
      cut(ctx, [[-r * 0.52, -r * 0.92], [r * 0.52, -r * 0.92], [r * 1.12, -r * 0.28], [0, r * 1.22], [-r * 1.12, -r * 0.28]], [0, -r * 0.28], col)
    } else {
      // 晶簇：三根晶柱，中间最高，两侧外倾；先画后排再画前排
      const prism = (rot: number, k: number, ox: number, oy: number): void => {
        ctx.save()
        ctx.translate(ox, oy)
        ctx.rotate(rot)
        const h = r * k
        cut(ctx, [[0, -h * 1.3], [h * 0.52, -h * 0.5], [h * 0.52, h * 0.55], [0, h * 0.85], [-h * 0.52, h * 0.55], [-h * 0.52, -h * 0.5]], [0, 0], col)
        ctx.restore()
      }
      prism(-0.5, 0.74, -r * 0.72, r * 0.22)
      prism(0.5, 0.74, r * 0.72, r * 0.22)
      prism(0, 0.98, 0, -r * 0.08)
    }

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

  /** 不带光晕的宝石（只给导出图标用，局内不走这里） */
  gemBare(tier: number): Sprite {
    return gemSprite(tier, this.ss, false)
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
