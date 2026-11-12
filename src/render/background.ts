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
      const col = mixHex(pal.accent, pal.gridMajor, r())
      // 在四个方向各画一份，保证平铺无缝
      for (const ox of [-TILE, 0, TILE]) {
        for (const oy of [-TILE, 0, TILE]) {
          const cx = x + ox
          const cy = y + oy
          if (cx < -rad || cx > TILE + rad || cy < -rad || cy > TILE + rad) continue
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
          g.addColorStop(0, rgba(col, 0.1 + r() * 0.03))
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
  /** 低画质关闭星云 */
  nebulaOn = true

  constructor() {
    this.vignette = this.makeVignette('#02020c', 0.82)
    this.bossVig = this.makeVignette('#ff2b4e', 0.9)
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
      ctx.globalAlpha = bossMix * (0.55 + 0.25 * Math.sin(time * 3))
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

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    pal: SectorPalette,
    camX: number,
    camY: number,
    W: number,
    H: number,
    k: number,
    time: number,
  ): void {
    const minor = 64
    const halfW = W / (2 * k)
    const halfH = H / (2 * k)
    const x0 = Math.floor((camX - halfW) / minor) * minor
    const y0 = Math.floor((camY - halfH) / minor) * minor
    const breathe = 0.85 + 0.15 * Math.sin(time * 1.4)

    // 细网格
    ctx.lineWidth = Math.max(1, k * 0.9)
    ctx.strokeStyle = rgba(pal.grid, 0.5 * breathe)
    ctx.beginPath()
    for (let gx = x0; gx < camX + halfW + minor; gx += minor) {
      if (Math.round(gx / minor) % 4 === 0) continue
      const sx = Math.round((gx - camX) * k + W / 2) + 0.5
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, H)
    }
    for (let gy = y0; gy < camY + halfH + minor; gy += minor) {
      if (Math.round(gy / minor) % 4 === 0) continue
      const sy = Math.round((gy - camY) * k + H / 2) + 0.5
      ctx.moveTo(0, sy)
      ctx.lineTo(W, sy)
    }
    ctx.stroke()

    // 粗网格
    ctx.lineWidth = Math.max(1.4, k * 1.5)
    ctx.strokeStyle = rgba(pal.gridMajor, 0.62 * breathe)
    ctx.beginPath()
    for (let gx = x0; gx < camX + halfW + minor; gx += minor) {
      if (Math.round(gx / minor) % 4 !== 0) continue
      const sx = Math.round((gx - camX) * k + W / 2) + 0.5
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, H)
    }
    for (let gy = y0; gy < camY + halfH + minor; gy += minor) {
      if (Math.round(gy / minor) % 4 !== 0) continue
      const sy = Math.round((gy - camY) * k + H / 2) + 0.5
      ctx.moveTo(0, sy)
      ctx.lineTo(W, sy)
    }
    ctx.stroke()
  }
}
