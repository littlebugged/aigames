import { TAU } from '../engine/math'
import { rgba } from './palette'
import type { SpriteBank } from './sprites'

/** 粒子类型 */
const SPARK = 0
const DOT = 1
const RING = 2
const SHARD = 3

/**
 * 池化粒子系统（结构数组，零分配）。
 * 全部用叠加混合绘制，所以顺序无关，死亡粒子用"与末尾交换"的方式 O(1) 移除。
 */
export class Particles {
  n = 0
  private readonly kind: Uint8Array
  private readonly x: Float32Array
  private readonly y: Float32Array
  private readonly vx: Float32Array
  private readonly vy: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly size: Float32Array
  private readonly rot: Float32Array
  private readonly spin: Float32Array
  /** 环形粒子的终止半径 */
  private readonly size2: Float32Array
  private readonly col: Uint16Array
  private readonly colors: string[] = []
  private readonly colorIdx = new Map<string, number>()

  /** 全局数量倍率（画质档位），0~1 */
  density = 1
  /** 0~1：越接近池满，新粒子越稀疏 */
  private get pressure(): number {
    return 1 - Math.min(1, this.n / this.cap) * 0.85
  }

  constructor(readonly cap: number) {
    this.kind = new Uint8Array(cap)
    this.x = new Float32Array(cap)
    this.y = new Float32Array(cap)
    this.vx = new Float32Array(cap)
    this.vy = new Float32Array(cap)
    this.life = new Float32Array(cap)
    this.maxLife = new Float32Array(cap)
    this.size = new Float32Array(cap)
    this.rot = new Float32Array(cap)
    this.spin = new Float32Array(cap)
    this.size2 = new Float32Array(cap)
    this.col = new Uint16Array(cap)
  }

  clear(): void {
    this.n = 0
  }

  private colorId(c: string): number {
    let id = this.colorIdx.get(c)
    if (id === undefined) {
      id = this.colors.length
      this.colors.push(c)
      this.colorIdx.set(c, id)
    }
    return id
  }

  private add(
    kind: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    color: string,
    rot = 0,
    spin = 0,
    size2 = 0,
  ): void {
    if (this.n >= this.cap) return
    const i = this.n++
    this.kind[i] = kind
    this.x[i] = x
    this.y[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.life[i] = life
    this.maxLife[i] = life
    this.size[i] = size
    this.rot[i] = rot
    this.spin[i] = spin
    this.size2[i] = size2
    this.col[i] = this.colorId(color)
  }

  /** 按密度与池压力缩放数量（至少保留 1 个） */
  private count(n: number): number {
    const c = n * this.density * this.pressure
    return c < 1 ? (Math.random() < c ? 1 : 0) : Math.round(c)
  }

  spark(x: number, y: number, color: string, n: number, speed: number, life = 0.35, size = 1.8): void {
    const c = this.count(n)
    for (let i = 0; i < c; i++) {
      const a = Math.random() * TAU
      const s = speed * (0.35 + Math.random() * 0.75)
      this.add(SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size, color)
    }
  }

  /** 朝某个方向的锥形火花 */
  sparkCone(x: number, y: number, ang: number, spread: number, color: string, n: number, speed: number, life = 0.3): void {
    const c = this.count(n)
    for (let i = 0; i < c; i++) {
      const a = ang + (Math.random() - 0.5) * spread
      const s = speed * (0.4 + Math.random() * 0.7)
      this.add(SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), 1.6, color)
    }
  }

  dot(x: number, y: number, vx: number, vy: number, color: string, size: number, life: number): void {
    this.add(DOT, x, y, vx, vy, life, size, color)
  }

  /** 爆散的光点 */
  burst(x: number, y: number, color: string, n: number, speed: number, size = 7, life = 0.5): void {
    const c = this.count(n)
    for (let i = 0; i < c; i++) {
      const a = Math.random() * TAU
      const s = speed * (0.2 + Math.random() * 0.85)
      this.add(DOT, x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.55 + Math.random() * 0.7), size * (0.5 + Math.random() * 0.7), color)
    }
  }

  shards(x: number, y: number, color: string, n: number, speed: number, size = 4, life = 0.6): void {
    const c = this.count(n)
    for (let i = 0; i < c; i++) {
      const a = Math.random() * TAU
      const s = speed * (0.3 + Math.random() * 0.8)
      this.add(
        SHARD,
        x,
        y,
        Math.cos(a) * s,
        Math.sin(a) * s,
        life * (0.6 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.8),
        color,
        Math.random() * TAU,
        (Math.random() - 0.5) * 14,
      )
    }
  }

  ring(x: number, y: number, r0: number, r1: number, color: string, life = 0.45, width = 3): void {
    // 圆环辨识度高，不随密度缩减
    this.add(RING, x, y, 0, 0, life, width, color, r0, 0, r1)
  }

  update(dt: number): void {
    const drag = Math.exp(-3.2 * dt)
    let i = 0
    while (i < this.n) {
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        const l = --this.n
        if (i !== l) {
          this.kind[i] = this.kind[l]
          this.x[i] = this.x[l]
          this.y[i] = this.y[l]
          this.vx[i] = this.vx[l]
          this.vy[i] = this.vy[l]
          this.life[i] = this.life[l]
          this.maxLife[i] = this.maxLife[l]
          this.size[i] = this.size[l]
          this.rot[i] = this.rot[l]
          this.spin[i] = this.spin[l]
          this.size2[i] = this.size2[l]
          this.col[i] = this.col[l]
        }
        continue
      }
      if (this.kind[i] !== RING) {
        this.x[i] += this.vx[i] * dt
        this.y[i] += this.vy[i] * dt
        this.vx[i] *= drag
        this.vy[i] *= drag
        this.rot[i] += this.spin[i] * dt
      }
      i++
    }
  }

  /** 叠加混合绘制；调用方需已设置好世界坐标变换 */
  draw(ctx: CanvasRenderingContext2D, bank: SpriteBank): void {
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < this.n; i++) {
      const t = 1 - this.life[i] / this.maxLife[i]
      const color = this.colors[this.col[i]]
      switch (this.kind[i]) {
        case SPARK: {
          const a = 1 - t
          ctx.strokeStyle = rgba(color, a)
          ctx.lineWidth = this.size[i] * (1 - t * 0.5)
          ctx.beginPath()
          ctx.moveTo(this.x[i], this.y[i])
          ctx.lineTo(this.x[i] - this.vx[i] * 0.055, this.y[i] - this.vy[i] * 0.055)
          ctx.stroke()
          break
        }
        case DOT: {
          const s = bank.glow(color)
          const k = this.size[i] * (1 - t * 0.55) * 2.2
          ctx.globalAlpha = Math.min(1, (1 - t) * 1.4)
          ctx.drawImage(s.c, this.x[i] - k / 2, this.y[i] - k / 2, k, k)
          break
        }
        case RING: {
          const e = 1 - (1 - t) * (1 - t)
          const r = this.rot[i] + (this.size2[i] - this.rot[i]) * e
          ctx.globalAlpha = 1
          ctx.strokeStyle = rgba(color, (1 - t) * 0.9)
          ctx.lineWidth = this.size[i] * (1 - t * 0.75)
          ctx.beginPath()
          ctx.arc(this.x[i], this.y[i], r, 0, TAU)
          ctx.stroke()
          break
        }
        case SHARD: {
          const s = this.size[i] * (1 - t * 0.6)
          const c = Math.cos(this.rot[i])
          const sn = Math.sin(this.rot[i])
          ctx.fillStyle = rgba(color, (1 - t) * 0.9)
          ctx.beginPath()
          ctx.moveTo(this.x[i] + c * s * 1.6, this.y[i] + sn * s * 1.6)
          ctx.lineTo(this.x[i] - c * s * 0.8 - sn * s, this.y[i] - sn * s * 0.8 + c * s)
          ctx.lineTo(this.x[i] - c * s * 0.8 + sn * s, this.y[i] - sn * s * 0.8 - c * s)
          ctx.closePath()
          ctx.fill()
          break
        }
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
}
