import type { BossId } from '../data/ids'
import { TAU, clamp01 } from '../engine/math'
import type { Boss } from '../game/entities'
import { lighten, rgba } from './palette'
import { polygon } from './shapes'
import { make, neon, type Sprite, type SpriteBank } from './sprites'

/** 三个 Boss 的预渲染美术 + 绘制。每个 Boss 只有十来次 drawImage，所以直接用 save/restore。 */

const PHASE_COLOR: Record<BossId, [string, string, string]> = {
  overseer: ['#ff4d6d', '#ff8a3d', '#ff2a2a'],
  fractal: ['#9dff4d', '#d9ff4d', '#fff04d'],
  maw: ['#c9a0ff', '#e07bff', '#ff6ad5'],
}

const OV = '#ff4d6d'
const FR = '#9dff4d'
const MW = '#c9a0ff'

export class BossArt {
  private readonly ovFrame: Sprite
  private readonly ovRing: Sprite
  private readonly ovIris: Sprite
  private readonly ovPupil: Sprite
  private readonly frTri: Sprite
  private readonly frCore: Sprite
  private readonly mwBody: Sprite
  private readonly mwArcs: Sprite

  constructor(ss: number) {
    // ── 监察者：机械之眼 ──
    this.ovFrame = make(180, 180, ss, (ctx) => {
      const r = 58
      ctx.beginPath()
      polygon(ctx, 6, r, Math.PI / 6)
      ctx.fillStyle = rgba(OV, 0.1)
      ctx.fill()
      neon(ctx, OV, ss, 3.4, 18, 0.8)
      ctx.beginPath()
      polygon(ctx, 6, r * 0.8, Math.PI / 6)
      ctx.strokeStyle = rgba(OV, 0.55)
      ctx.lineWidth = 1.6
      ctx.stroke()
      // 顶点外侧的尖刺
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i / 6) * TAU
        const ax = Math.cos(a)
        const ay = Math.sin(a)
        ctx.beginPath()
        ctx.moveTo(ax * r * 0.98 - ay * 7, ay * r * 0.98 + ax * 7)
        ctx.lineTo(ax * (r + 15), ay * (r + 15))
        ctx.lineTo(ax * r * 0.98 + ay * 7, ay * r * 0.98 - ax * 7)
        ctx.closePath()
        ctx.fillStyle = rgba(OV, 0.5)
        ctx.shadowColor = OV
        ctx.shadowBlur = 10 * ss
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.strokeStyle = rgba('#ffffff', 0.7)
        ctx.lineWidth = 1
        ctx.stroke()
        // 连向中心的支撑线
        ctx.beginPath()
        ctx.moveTo(ax * r * 0.8, ay * r * 0.8)
        ctx.lineTo(ax * r * 0.5, ay * r * 0.5)
        ctx.strokeStyle = rgba(OV, 0.4)
        ctx.lineWidth = 1.4
        ctx.stroke()
      }
    })
    this.ovRing = make(140, 140, ss, (ctx) => {
      ctx.beginPath()
      ctx.arc(0, 0, 40, 0, TAU)
      ctx.setLineDash([9, 7])
      neon(ctx, lighten(OV, 0.25), ss, 2, 8, 0.6)
      ctx.setLineDash([])
    })
    this.ovIris = make(80, 80, ss, (ctx) => {
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26)
      g.addColorStop(0, '#2a0510')
      g.addColorStop(0.55, rgba(OV, 0.55))
      g.addColorStop(1, rgba(OV, 0.95))
      ctx.beginPath()
      ctx.arc(0, 0, 26, 0, TAU)
      ctx.fillStyle = g
      ctx.fill()
      neon(ctx, OV, ss, 2.4, 14, 0.8)
    })
    this.ovPupil = make(40, 50, ss, (ctx) => {
      ctx.beginPath()
      ctx.ellipse(0, 0, 5.5, 15, 0, 0, TAU)
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = '#ffb3c0'
      ctx.shadowBlur = 14 * ss
      ctx.fill()
      ctx.shadowBlur = 0
    })

    // ── 分形核心：嵌套谢尔宾斯基三角 ──
    this.frTri = make(130, 130, ss, (ctx) => {
      const r = 50
      const v = (i: number, rad: number): [number, number] => [
        Math.cos((i / 3) * TAU - Math.PI / 2) * rad,
        Math.sin((i / 3) * TAU - Math.PI / 2) * rad,
      ]
      ctx.beginPath()
      for (let i = 0; i < 3; i++) {
        const [x, y] = v(i, r)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = rgba(FR, 0.08)
      ctx.fill()
      neon(ctx, FR, ss, 3, 16, 0.75)
      // 内部倒三角（中点连线）
      const mid = (i: number): [number, number] => {
        const [x1, y1] = v(i, r)
        const [x2, y2] = v((i + 1) % 3, r)
        return [(x1 + x2) / 2, (y1 + y2) / 2]
      }
      ctx.beginPath()
      for (let i = 0; i < 3; i++) {
        const [x, y] = mid(i)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.strokeStyle = rgba(FR, 0.7)
      ctx.lineWidth = 1.8
      ctx.stroke()
      // 三个角各自再细分一层
      for (let i = 0; i < 3; i++) {
        const [cx, cy] = v(i, r)
        const a = mid(i)
        const b = mid((i + 2) % 3)
        const m1: [number, number] = [(cx + a[0]) / 2, (cy + a[1]) / 2]
        const m2: [number, number] = [(cx + b[0]) / 2, (cy + b[1]) / 2]
        const m3: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        ctx.beginPath()
        ctx.moveTo(m1[0], m1[1])
        ctx.lineTo(m2[0], m2[1])
        ctx.lineTo(m3[0], m3[1])
        ctx.closePath()
        ctx.strokeStyle = rgba(FR, 0.5)
        ctx.lineWidth = 1.2
        ctx.stroke()
      }
    })
    this.frCore = make(60, 60, ss, (ctx) => {
      ctx.beginPath()
      polygon(ctx, 6, 11, Math.PI / 6)
      ctx.fillStyle = rgba('#ffffff', 0.9)
      ctx.shadowColor = FR
      ctx.shadowBlur = 18 * ss
      ctx.fill()
      ctx.shadowBlur = 0
      neon(ctx, FR, ss, 2, 10, 0.6)
    })

    // ── 虚空之喉：吞噬一切的黑洞 ──
    this.mwBody = make(190, 190, ss, (ctx) => {
      const r = 64
      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, r)
      g.addColorStop(0, '#000000')
      g.addColorStop(0.6, 'rgba(6,0,18,0.97)')
      g.addColorStop(0.88, 'rgba(46,16,90,0.8)')
      g.addColorStop(1, 'rgba(120,70,200,0.55)')
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, TAU)
      ctx.fillStyle = g
      ctx.fill()
      neon(ctx, MW, ss, 3.2, 20, 0.7)
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.74, 0, TAU)
      ctx.strokeStyle = rgba(MW, 0.35)
      ctx.lineWidth = 1.4
      ctx.stroke()
      // 内指的獠牙
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU
        const ax = Math.cos(a)
        const ay = Math.sin(a)
        ctx.beginPath()
        ctx.moveTo(ax * r * 0.97 - ay * 6, ay * r * 0.97 + ax * 6)
        ctx.lineTo(ax * r * 0.62, ay * r * 0.62)
        ctx.lineTo(ax * r * 0.97 + ay * 6, ay * r * 0.97 - ax * 6)
        ctx.closePath()
        ctx.fillStyle = rgba(MW, 0.22)
        ctx.fill()
        ctx.strokeStyle = rgba(lighten(MW, 0.4), 0.75)
        ctx.lineWidth = 1.1
        ctx.stroke()
      }
    })
    this.mwArcs = make(230, 230, ss, (ctx) => {
      ctx.lineCap = 'round'
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU
        ctx.beginPath()
        ctx.arc(0, 0, 78, a, a + 1.05)
        neon(ctx, MW, ss, 3, 14, 0.6)
      }
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.5
        ctx.beginPath()
        ctx.arc(0, 0, 94, a, a + 0.62)
        ctx.strokeStyle = rgba(lighten(MW, 0.3), 0.55)
        ctx.lineWidth = 2
        ctx.stroke()
      }
    })
  }

  /** 在当前（世界）坐标系下绘制 Boss */
  draw(ctx: CanvasRenderingContext2D, b: Boss, px: number, py: number, vt: number, bank: SpriteBank): void {
    const cols = PHASE_COLOR[b.id]
    const col = cols[Math.min(2, b.phase)]
    const fade = b.age < 2.4 ? clamp01(b.age / 1.6) : 1
    const pulse = 0.5 + 0.5 * Math.sin(vt * 4 + b.phase)
    const charging = b.id === 'overseer' && b.state === 2
    const dashing = b.id === 'overseer' && b.state === 3
    const intro = b.intro > 0 && b.age > 2.4 // 阶段转换中

    ctx.save()
    ctx.translate(b.x, b.y)
    ctx.globalAlpha = fade

    // 底部辉光
    ctx.globalCompositeOperation = 'lighter'
    const glow = bank.glow(col)
    const gs = b.r * (charging ? 5 : 4) * (1 + pulse * 0.08)
    ctx.globalAlpha = fade * (0.5 + pulse * 0.2 + (charging ? 0.3 : 0))
    ctx.drawImage(glow.c, -gs / 2, -gs / 2, gs, gs)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = fade

    // 冲锋残影
    if (dashing) {
      ctx.globalAlpha = 0.25 * fade
      for (let i = 1; i <= 3; i++) {
        ctx.save()
        ctx.translate(-b.tx * 28 * i, -b.ty * 28 * i)
        ctx.globalAlpha = 0.22 * fade * (1 - i / 4)
        this.drawBody(ctx, b, px, py, vt, bank)
        ctx.restore()
      }
      ctx.globalAlpha = fade
    }

    const s = 0.88 + 0.12 * fade
    ctx.scale(s, s)
    this.drawBody(ctx, b, px, py, vt, bank)

    // 受击 / 阶段转换闪白
    const hot = b.flash > 0 ? 0.5 : intro ? 0.25 + 0.25 * Math.sin(vt * 30) : 0
    if (hot > 0) {
      ctx.globalCompositeOperation = 'lighter'
      const w = bank.glow('#ffffff')
      const ws = b.r * 2.8
      ctx.globalAlpha = hot
      ctx.drawImage(w.c, -ws / 2, -ws / 2, ws, ws)
    }
    ctx.restore()
  }

  private drawBody(ctx: CanvasRenderingContext2D, b: Boss, px: number, py: number, vt: number, bank: SpriteBank): void {
    switch (b.id) {
      case 'overseer': {
        this.rot(ctx, this.ovFrame, b.ang * 0.35 + vt * 0.1)
        this.rot(ctx, this.ovRing, -vt * 0.9 - b.phase * 0.2)
        this.rot(ctx, this.ovIris, 0)
        const dx = px - b.x
        const dy = py - b.y
        const d = Math.hypot(dx, dy) || 1
        const off = Math.min(11, d * 0.05)
        ctx.save()
        ctx.translate((dx / d) * off, (dy / d) * off)
        ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2)
        const p = this.ovPupil
        ctx.drawImage(p.c, -p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
        // 护盾球
        for (const o of b.orbs) {
          const g = bank.glow('#ff9aa8')
          const gs = o.r * 4.2
          ctx.save()
          ctx.translate(o.x - b.x, o.y - b.y)
          ctx.globalCompositeOperation = 'lighter'
          ctx.drawImage(g.c, -gs / 2, -gs / 2, gs, gs)
          ctx.restore()
        }
        break
      }
      case 'fractal': {
        const t = b.ang
        ctx.globalAlpha *= 0.95
        this.rot(ctx, this.frTri, t * 1.1, 1)
        this.rot(ctx, this.frTri, -t * 1.7 + 0.5, 0.66)
        this.rot(ctx, this.frTri, t * 2.4, 0.36)
        const c = this.frCore
        const cs = 1 + 0.18 * Math.sin(vt * 5)
        this.rot(ctx, c, vt * 0.8, cs)
        // 环绕的小三角
        for (let i = 0; i < 3 + b.phase; i++) {
          const a = t * 1.9 + (i / (3 + b.phase)) * TAU
          ctx.save()
          ctx.translate(Math.cos(a) * (b.r + 18), Math.sin(a) * (b.r + 18))
          ctx.rotate(a * 2)
          const s = 0.2
          ctx.scale(s, s)
          ctx.drawImage(this.frTri.c, -this.frTri.w / 2, -this.frTri.h / 2, this.frTri.w, this.frTri.h)
          ctx.restore()
        }
        break
      }
      case 'maw': {
        const bs = 1 + 0.018 * Math.sin(vt * 3.2)
        this.rot(ctx, this.mwArcs, b.ang * 2.4, 1)
        this.rot(ctx, this.mwArcs, -b.ang * 1.5, 0.86)
        this.rot(ctx, this.mwBody, b.ang * 0.5, bs)
        break
      }
    }
  }

  private rot(ctx: CanvasRenderingContext2D, s: Sprite, ang: number, scale = 1): void {
    ctx.save()
    ctx.rotate(ang)
    if (scale !== 1) ctx.scale(scale, scale)
    ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h)
    ctx.restore()
  }
}
