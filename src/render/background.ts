import type { SectorPalette } from '../data/sectors'
import { TAU } from '../engine/math'
import { mixHex, rgba } from './palette'

const TILE = 768

function tile(draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = TILE
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  draw(ctx)
  return c
}

/** 伪随机（保证每次启动背景一致，不依赖 Math.random） */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 视差星尘层：越远的层越暗越小、移动越慢 */
function dustTile(pal: SectorPalette, seed: number, count: number, sizeMul: number, bright: number): HTMLCanvasElement {
  return tile((ctx) => {
    const r = lcg(seed)
    for (let i = 0; i < count; i++) {
      const x = r() * TILE
      const y = r() * TILE
      const s = (0.6 + r() * 1.5) * sizeMul
      const a = (0.25 + r() * 0.75) * bright
      ctx.fillStyle = rgba(r() < 0.25 ? '#ffffff' : pal.dust, a)
      ctx.beginPath()
      ctx.arc(x, y, s, 0, TAU)
      ctx.fill()
      if (s > 1.7 * sizeMul && r() < 0.5) {
        ctx.strokeStyle = rgba(pal.dust, a * 0.6)
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.moveTo(x - s * 3.2, y)
        ctx.lineTo(x + s * 3.2, y)
        ctx.moveTo(x, y - s * 3.2)
        ctx.lineTo(x, y + s * 3.2)
        ctx.stroke()
      }
    }
  })
}

function nebulaTile(pal: SectorPalette): HTMLCanvasElement {
  return tile((ctx) => {
    const r = lcg(7)
    for (let i = 0; i < 9; i++) {
      const x = r() * TILE
      const y = r() * TILE
      const rad = 170 + r() * 230
      const col = mixHex(pal.accent, pal.gridMajor, 0.35 + r() * 0.65)
      // 在四个方向各画一份，保证平铺无缝
      for (const ox of [-TILE, 0, TILE]) {
        for (const oy of [-TILE, 0, TILE]) {
          const cx = x + ox
          const cy = y + oy
          if (cx < -rad || cx > TILE + rad || cy < -rad || cy > TILE + rad) continue
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
          g.addColorStop(0, rgba(col, 0.055 + r() * 0.025))
          g.addColorStop(1, rgba(col, 0))
          ctx.fillStyle = g
          ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
        }
      }
    }
  })
}

export class Background {
  private pal: SectorPalette | null = null
  private nebula: HTMLCanvasElement | null = null
  private dust: { c: HTMLCanvasElement; par: number }[] = []
  private vignette: HTMLCanvasElement
  private bossVig: HTMLCanvasElement
  private gradKey = ''
  private grad: CanvasGradient | null = null
  private poolKey = ''
  private pool: CanvasGradient | null = null
  /** 低画质关闭星云 */
  nebulaOn = true

  constructor() {
    this.vignette = this.makeVignette('#02020c', 0.82)
    this.bossVig = this.makeVignette('#9c1235', 0.8)
  }

  private makeVignette(color: string, edge: number): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 182)
    g.addColorStop(0, rgba(color, 0))
    g.addColorStop(0.55, rgba(color, edge * 0.12))
    g.addColorStop(1, rgba(color, edge))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
    return c
  }

  setPalette(pal: SectorPalette): void {
    if (this.pal === pal) return
    this.pal = pal
    this.nebula = nebulaTile(pal)
    this.dust = [
      { c: dustTile(pal, 11, 70, 0.8, 0.5), par: 0.12 },
      { c: dustTile(pal, 23, 46, 1, 0.75), par: 0.28 },
      { c: dustTile(pal, 37, 26, 1.3, 1), par: 0.5 },
    ]
    this.gradKey = ''
  }

  /**
   * 在屏幕空间绘制整个背景。
   * W/H 为画布像素尺寸，k 为 世界单位→像素 的缩放。
   */
  draw(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    W: number,
    H: number,
    k: number,
    time: number,
    bossMix: number,
  ): void {
    const pal = this.pal
    if (!pal) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    const key = `${H}|${pal.bg0}`
    if (key !== this.gradKey || !this.grad) {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, pal.bg0)
      g.addColorStop(1, pal.bg1)
      this.grad = g
      this.gradKey = key
    }
    ctx.fillStyle = this.grad
    ctx.fillRect(0, 0, W, H)

    // 玩家脚下的一片微光：在深色背景上托出主角，也让画面有纵深（比整体加亮要克制得多）
    const pk = `${W}x${H}|${pal.accent}`
    if (pk !== this.poolKey || !this.pool) {
      const R = Math.hypot(W, H) * 0.42
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R)
      g.addColorStop(0, rgba(pal.accent, 0.075))
      g.addColorStop(0.55, rgba(pal.accent, 0.025))
      g.addColorStop(1, rgba(pal.accent, 0))
      this.pool = g
      this.poolKey = pk
    }
    ctx.fillStyle = this.pool
    ctx.fillRect(0, 0, W, H)

    // 星云（极慢视差）
    if (this.nebulaOn && this.nebula) {
      this.drawTiled(ctx, this.nebula, camX, camY, W, H, k, 0.06, 1)
    }
    // 星尘
    for (const d of this.dust) this.drawTiled(ctx, d.c, camX, camY, W, H, k, d.par, 0.55 + 0.45 * Math.sin(time * 0.7 + d.par * 9))

    this.drawGrid(ctx, pal, camX, camY, W, H, k, time)

    // 暗角
    ctx.globalAlpha = 1
    ctx.drawImage(this.vignette, 0, 0, W, H)
    if (bossMix > 0.01) {
      ctx.globalAlpha = bossMix * (0.44 + 0.14 * Math.sin(time * 3))
      ctx.drawImage(this.bossVig, 0, 0, W, H)
      ctx.globalAlpha = 1
    }
  }

  private drawTiled(
    ctx: CanvasRenderingContext2D,
    img: HTMLCanvasElement,
    camX: number,
    camY: number,
    W: number,
    H: number,
    k: number,
    par: number,
    alpha: number,
  ): void {
    const size = TILE * k * (0.7 + par * 0.6)
    const ox = -(((camX * par * k) % size) + size) % size
    const oy = -(((camY * par * k) % size) + size) % size
    ctx.globalAlpha = alpha
    for (let x = ox - size; x < W; x += size) {
      for (let y = oy - size; y < H; y += size) {
        ctx.drawImage(img, x, y, size, size)
      }
    }
    ctx.globalAlpha = 1
  }

  /**
   * 点阵地面：每格一个小点，每 4 格一个十字标记，像工程蓝图。
   * 旧版是整张霓虹网格线，满屏发亮很"复古合成波"，还会和战斗特效抢眼；
   * 点阵安静得多，但依然能清楚看出自己在移动。
   */
  private drawGrid(
    ctx: CanvasRenderingContext2D,
    pal: SectorPalette,
    camX: number,
    camY: number,
    W: number,
    H: number,
    k: number,
    _time: number,
  ): void {
    const minor = 64
    const halfW = W / (2 * k)
    const halfH = H / (2 * k)
    const x0 = Math.floor((camX - halfW) / minor) * minor
    const y0 = Math.floor((camY - halfH) / minor) * minor
    const x1 = camX + halfW + minor
    const y1 = camY + halfH + minor

    // 大格接缝：极淡的细线，给地面一点"拼板"的结构感
    ctx.lineWidth = 1
    ctx.strokeStyle = rgba(pal.gridMajor, 0.07)
    ctx.beginPath()
    for (let gx = x0; gx < x1; gx += minor) {
      if (Math.round(gx / minor) % 4 !== 0) continue
      const sx = Math.round((gx - camX) * k + W / 2) + 0.5
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, H)
    }
    for (let gy = y0; gy < y1; gy += minor) {
      if (Math.round(gy / minor) % 4 !== 0) continue
      const sy = Math.round((gy - camY) * k + H / 2) + 0.5
      ctx.moveTo(0, sy)
      ctx.lineTo(W, sy)
    }
    ctx.stroke()

    // 小点
    const dot = Math.max(1.5, k * 1.4)
    ctx.fillStyle = rgba(pal.grid, 0.95)
    ctx.beginPath()
    for (let gx = x0; gx < x1; gx += minor) {
      const ix = Math.round(gx / minor)
      const sx = Math.round((gx - camX) * k + W / 2)
      for (let gy = y0; gy < y1; gy += minor) {
        if (ix % 4 === 0 && Math.round(gy / minor) % 4 === 0) continue
        const sy = Math.round((gy - camY) * k + H / 2)
        ctx.rect(sx - dot / 2, sy - dot / 2, dot, dot)
      }
    }
    ctx.fill()

    // 十字标记
    const arm = 5.5 * k
    ctx.lineWidth = Math.max(1, k * 1.1)
    ctx.strokeStyle = rgba(pal.gridMajor, 0.75)
    ctx.beginPath()
    for (let gx = x0; gx < x1; gx += minor) {
      if (Math.round(gx / minor) % 4 !== 0) continue
      const sx = Math.round((gx - camX) * k + W / 2) + 0.5
      for (let gy = y0; gy < y1; gy += minor) {
        if (Math.round(gy / minor) % 4 !== 0) continue
        const sy = Math.round((gy - camY) * k + H / 2) + 0.5
        ctx.moveTo(sx - arm, sy)
        ctx.lineTo(sx + arm, sy)
        ctx.moveTo(sx, sy - arm)
        ctx.lineTo(sx, sy + arm)
      }
    }
    ctx.stroke()
  }
}
