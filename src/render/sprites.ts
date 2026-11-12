import { ENEMIES, type EnemyDef } from '../data/enemies'
import { ENEMY_IDS, SHIP_IDS, type EnemyId, type ShipId } from '../data/ids'
import { SHIPS } from '../data/ships'
import { TAU } from '../engine/math'
import type { PickupKind } from '../game/events'
import { lighten, rgba } from './palette'
import { detailEnemy, polygon, traceEnemy } from './shapes'

/**
 * 预渲染的霓虹精灵。
 * 辉光（shadowBlur）很贵，所以只在启动时画一次，运行时只做 drawImage。
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

/** 带辉光的描边：外层彩色粗线 + 内层白色细线，像一根霓虹灯管 */
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
  const p = (pts: number[][]): void => {
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * r, y * r) : ctx.lineTo(x * r, y * r)))
    ctx.closePath()
  }
  switch (id) {
    case 'vanguard':
      p([
        [1, 0],
        [-0.7, 0.92],
        [-0.38, 0.3],
        [-0.58, 0],
        [-0.38, -0.3],
        [-0.7, -0.92],
      ])
      break
    case 'phantom':
      p([
        [1.18, 0],
        [0.15, 0.4],
        [-0.55, 1.02],
        [-0.34, 0.28],
        [-0.72, 0],
        [-0.34, -0.28],
        [-0.55, -1.02],
        [0.15, -0.4],
      ])
      break
    case 'bulwark':
      p([
        [0.95, 0],
        [0.55, 0.62],
        [-0.15, 0.98],
        [-0.82, 0.62],
        [-0.9, 0],
        [-0.82, -0.62],
        [-0.15, -0.98],
        [0.55, -0.62],
      ])
      break
    case 'reaper':
      p([
        [1.2, 0],
        [0.3, 0.3],
        [0.55, 0.98],
        [-0.28, 0.56],
        [-0.98, 0.3],
        [-0.6, 0],
        [-0.98, -0.3],
        [-0.28, -0.56],
        [0.55, -0.98],
        [0.3, -0.3],
      ])
      break
  }
}

function shipSprite(id: ShipId, ss: number, flash: boolean): Sprite {
  const def = SHIPS[id]
  const r = SHIP_R
  const size = (r + 16) * 2
  return make(size, size, ss, (ctx) => {
    const col = flash ? '#ffffff' : def.color
    traceShip(ctx, id, r)
    const g = ctx.createRadialGradient(r * 0.2, 0, 1, 0, 0, r * 1.2)
    g.addColorStop(0, rgba(col, flash ? 0.9 : 0.5))
    g.addColorStop(1, rgba(col, flash ? 0.7 : 0.12))
    ctx.fillStyle = g
    ctx.fill()
    neon(ctx, col, ss, 2.6, 14, 0.85)
    // 座舱
    ctx.beginPath()
    ctx.moveTo(r * 0.5, 0)
    ctx.lineTo(r * 0.05, r * 0.2)
    ctx.lineTo(-r * 0.2, 0)
    ctx.lineTo(r * 0.05, -r * 0.2)
    ctx.closePath()
    ctx.fillStyle = rgba(def.accent, flash ? 1 : 0.9)
    ctx.shadowColor = col
    ctx.shadowBlur = 8 * ss
    ctx.fill()
    ctx.shadowBlur = 0
    // 机身中线
    ctx.beginPath()
    ctx.moveTo(-r * 0.5, 0)
    ctx.lineTo(r * 0.15, 0)
    ctx.strokeStyle = rgba(def.accent, 0.5)
    ctx.lineWidth = 1
    ctx.stroke()
  })
}

// ───────────────────────── 敌人 ─────────────────────────

function enemySprite(def: EnemyDef, ss: number, flash: boolean): Sprite {
  const r = def.radius
  const size = (r + 16) * 2
  return make(size, size, ss, (ctx) => {
    const col = flash ? '#ffffff' : def.color
    traceEnemy(ctx, def.shape, r)
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 1.15)
    g.addColorStop(0, rgba(col, flash ? 0.95 : 0.45))
    g.addColorStop(1, rgba(col, flash ? 0.8 : 0.1))
    ctx.fillStyle = g
    ctx.fill()
    neon(ctx, col, ss, 2.4, 12, flash ? 1 : 0.7)
    detailEnemy(ctx, def.shape, r)
    ctx.strokeStyle = rgba(flash ? '#ffffff' : lighten(def.color, 0.55), 0.85)
    ctx.lineWidth = 1.2
    ctx.stroke()
  })
}

// ───────────────────────── 宝石 / 拾取物 ─────────────────────────

export const GEM_COLORS = ['#3df2ff', '#6dff8a', '#ffd84a', '#ff5ccf'] as const
const GEM_R = [5, 6.6, 8.6, 11.5]

function gemSprite(tier: number, ss: number): Sprite {
  const r = GEM_R[tier]
  const col = GEM_COLORS[tier]
  const size = (r + 12) * 2
  return make(size, size, ss, (ctx) => {
    ctx.beginPath()
    ctx.moveTo(0, -r * 1.25)
    ctx.lineTo(r * 0.85, 0)
    ctx.lineTo(0, r * 1.25)
    ctx.lineTo(-r * 0.85, 0)
    ctx.closePath()
    ctx.fillStyle = rgba(col, 0.55)
    ctx.shadowColor = col
    ctx.shadowBlur = 10 * ss
    ctx.fill()
    neon(ctx, col, ss, 1.8, 8, 0.9)
    ctx.beginPath()
    ctx.moveTo(0, -r * 1.25)
    ctx.lineTo(0, r * 1.25)
    ctx.moveTo(-r * 0.85, 0)
    ctx.lineTo(r * 0.85, 0)
    ctx.strokeStyle = rgba('#ffffff', 0.5)
    ctx.lineWidth = 0.8
    ctx.stroke()
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
  const size = (r + 14) * 2
  return make(size, size, ss, (ctx) => {
    ctx.beginPath()
    switch (kind) {
      case 'heal':
        ctx.arc(0, 0, r, 0, TAU)
        break
      case 'magnet':
        ctx.arc(0, 0, r, 0, TAU)
        break
      case 'bomb':
        polygon(ctx, 8, r, 0)
        break
      case 'chest':
        ctx.rect(-r * 0.95, -r * 0.75, r * 1.9, r * 1.5)
        break
      case 'cache':
        ctx.moveTo(0, -r * 1.2)
        ctx.lineTo(r * 0.95, 0)
        ctx.lineTo(0, r * 1.2)
        ctx.lineTo(-r * 0.95, 0)
        ctx.closePath()
        break
    }
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 1.2)
    g.addColorStop(0, rgba(col, 0.55))
    g.addColorStop(1, rgba(col, 0.14))
    ctx.fillStyle = g
    ctx.fill()
    neon(ctx, col, ss, 2.2, 12, 0.8)

    ctx.strokeStyle = rgba('#ffffff', 0.95)
    ctx.lineWidth = 2.2
    ctx.beginPath()
    switch (kind) {
      case 'heal':
        ctx.moveTo(-r * 0.5, 0)
        ctx.lineTo(r * 0.5, 0)
        ctx.moveTo(0, -r * 0.5)
        ctx.lineTo(0, r * 0.5)
        break
      case 'magnet':
        ctx.arc(0, -r * 0.05, r * 0.5, Math.PI, 0)
        ctx.moveTo(-r * 0.5, -r * 0.05)
        ctx.lineTo(-r * 0.5, r * 0.5)
        ctx.moveTo(r * 0.5, -r * 0.05)
        ctx.lineTo(r * 0.5, r * 0.5)
        break
      case 'bomb':
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + Math.PI / 4
          ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2)
          ctx.lineTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62)
        }
        break
      case 'chest':
        ctx.moveTo(-r * 0.95, -r * 0.2)
        ctx.lineTo(r * 0.95, -r * 0.2)
        ctx.moveTo(0, -r * 0.2)
        ctx.lineTo(0, r * 0.25)
        break
      case 'cache':
        ctx.moveTo(0, -r * 0.65)
        ctx.lineTo(0, r * 0.65)
        ctx.moveTo(-r * 0.5, 0)
        ctx.lineTo(r * 0.5, 0)
        break
    }
    ctx.stroke()
  })
}

// ───────────────────────── 武器小件 ─────────────────────────

/** 环绕刃：一片锋利的菱形光刃 */
function bladeSprite(color: string, ss: number): Sprite {
  const r = 20
  const size = (r + 14) * 2
  return make(size, size, ss, (ctx) => {
    ctx.beginPath()
    ctx.moveTo(r, 0)
    ctx.lineTo(0, r * 0.38)
    ctx.lineTo(-r * 0.75, 0)
    ctx.lineTo(0, -r * 0.38)
    ctx.closePath()
    ctx.fillStyle = rgba(color, 0.55)
    ctx.shadowColor = color
    ctx.shadowBlur = 12 * ss
    ctx.fill()
    neon(ctx, color, ss, 2, 10, 0.9)
  })
}

/** 僚机：小三角 */
function droneSprite(color: string, ss: number): Sprite {
  const r = 8
  const size = (r + 12) * 2
  return make(size, size, ss, (ctx) => {
    ctx.beginPath()
    ctx.moveTo(r, 0)
    ctx.lineTo(-r * 0.8, r * 0.75)
    ctx.lineTo(-r * 0.4, 0)
    ctx.lineTo(-r * 0.8, -r * 0.75)
    ctx.closePath()
    ctx.fillStyle = rgba(color, 0.6)
    ctx.shadowColor = color
    ctx.shadowBlur = 10 * ss
    ctx.fill()
    neon(ctx, color, ss, 1.8, 8, 0.9)
  })
}

/** 径向辉光点：白芯 → 颜色 → 透明。粒子、子弹、爆炸闪光都用它 */
function glowSprite(color: string, ss: number): Sprite {
  const size = 64
  return make(size, size, Math.max(1, ss * 0.5), (ctx) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.18, rgba(lighten(color, 0.5), 0.95))
    g.addColorStop(0.45, rgba(color, 0.45))
    g.addColorStop(1, rgba(color, 0))
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
  private readonly glows = new Map<string, Sprite>()
  private readonly blades = new Map<string, Sprite>()
  private readonly drones = new Map<string, Sprite>()

  constructor(ss: number) {
    this.ss = ss
    for (const id of ENEMY_IDS) {
      const def = ENEMIES[id]
      this.enemy[id] = { n: enemySprite(def, ss, false), f: enemySprite(def, ss, true) }
    }
    for (const id of SHIP_IDS) this.ship[id] = { n: shipSprite(id, ss, false), f: shipSprite(id, ss, true) }
    for (let i = 0; i < 4; i++) this.gem.push(gemSprite(i, ss))
    for (const k of Object.keys(PICKUP_COLOR) as PickupKind[]) this.pickup[k] = pickupSprite(k, ss)
  }

  glow(color: string): Sprite {
    let s = this.glows.get(color)
    if (!s) {
      s = glowSprite(color, this.ss)
      this.glows.set(color, s)
    }
    return s
  }

  blade(color: string): Sprite {
    let s = this.blades.get(color)
    if (!s) {
      s = bladeSprite(color, this.ss)
      this.blades.set(color, s)
    }
    return s
  }

  drone(color: string): Sprite {
    let s = this.drones.get(color)
    if (!s) {
      s = droneSprite(color, this.ss)
      this.drones.set(color, s)
    }
    return s
  }
}

export { PICKUP_COLOR, SHIP_R }
