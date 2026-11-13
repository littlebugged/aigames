import type { BossId } from '../data/ids'
import { TAU, clamp01 } from '../engine/math'
import type { Boss } from '../game/entities'
import { groove, hull, ink, lamp, plate, rivet, tonesOf, type Trace } from './matte'
import { lighten, mixHex, rgba } from './palette'
import { polygon } from './shapes'
import { make, type Sprite, type SpriteBank } from './sprites'

/**
 * 三个 Boss 的预渲染美术 + 绘制。
 * 和普通单位一样走「哑光硬表面」路线：不透明的金属机体 + 墨线描边，
 * 只有眼睛、核心这些真正该发光的部位才亮。每个 Boss 只有十来次 drawImage，所以直接用 save/restore。
 */

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
      const t = tonesOf(OV, -0.04)
      // 先画六根尖刺（压在机体下面，根部被机体盖住）
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i / 6) * TAU
        const ax = Math.cos(a)
        const ay = Math.sin(a)
        const spike: Trace = () => {
          ctx.beginPath()
          ctx.moveTo(ax * r * 0.9 - ay * 8, ay * r * 0.9 + ax * 8)
          ctx.lineTo(ax * (r + 16), ay * (r + 16))
          ctx.lineTo(ax * r * 0.9 + ay * 8, ay * r * 0.9 - ax * 8)
          ctx.closePath()
        }
        spike()
        ctx.lineWidth = 5
        ctx.strokeStyle = ink(0.95)
        ctx.stroke()
        const g = ctx.createLinearGradient(ax * r * 0.9, ay * r * 0.9, ax * (r + 16), ay * (r + 16))
        g.addColorStop(0, t.lo)
        g.addColorStop(0.6, t.mid)
        g.addColorStop(1, lighten(OV, 0.4))
        spike()
        ctx.fillStyle = g
        ctx.fill()
        // 尖刺一侧的受光棱
        ctx.beginPath()
        ctx.moveTo(ax * r * 0.9 - ay * 7, ay * r * 0.9 + ax * 7)
        ctx.lineTo(ax * (r + 14.5), ay * (r + 14.5))
        ctx.lineWidth = 0.9
        ctx.strokeStyle = rgba('#ffffff', 0.45)
        ctx.stroke()
      }
      const hex = (k: number): Trace => () => {
        ctx.beginPath()
        polygon(ctx, 6, r * k, Math.PI / 6)
      }
      hull(ctx, hex(1), r, t, { radial: true, facets: 6, phase: Math.PI / 6, line: 2.6, facetK: 1.1 })
      // 连向中心的支撑缝
      groove(
        ctx,
        () => {
          ctx.beginPath()
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + (i / 6) * TAU
            ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5)
            ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95)
          }
        },
        1.3,
      )
      // 内嵌的暗色装甲环
      plate(ctx, hex(0.8), r, mixHex(t.lo, t.mid, 0.3), t.deep, { line: 1.4 })
      plate(ctx, hex(0.58), r, t.deep, mixHex(t.deep, '#000000', 0.5), { line: 1.2 })
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i / 6) * TAU
        rivet(ctx, Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, 2.1)
        // 边中点的小灯
        const am = a + Math.PI / 6
        lamp(ctx, Math.cos(am) * r * 0.69, Math.sin(am) * r * 0.69, 2.2, OV, 0.8)
      }
    })
    this.ovRing = make(140, 140, ss, (ctx) => {
      const t = tonesOf(OV, 0.02)
      const R = 40
      const n = 10
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU + 0.09
        const a1 = ((i + 1) / n) * TAU - 0.09
        const seg = (): void => {
          ctx.beginPath()
          ctx.arc(0, 0, R, a0, a1)
        }
        seg()
        ctx.lineWidth = 8.4
        ctx.strokeStyle = ink(0.95)
        ctx.stroke()
        seg()
        ctx.lineWidth = 5.4
        ctx.strokeStyle = t.mid
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(0, 0, R + 1.6, a0 + 0.02, a1 - 0.02)
        ctx.lineWidth = 1.3
        ctx.strokeStyle = rgba(lighten(OV, 0.55), 0.7)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(0, 0, R - 1.7, a0 + 0.02, a1 - 0.02)
        ctx.lineWidth = 1.1
        ctx.strokeStyle = rgba('#000000', 0.4)
        ctx.stroke()
      }
    })
    this.ovIris = make(80, 80, ss, (ctx) => {
      const r = 26
      // 眼球：深红的球体，外圈带一道金属眼眶
      ctx.beginPath()
      ctx.arc(0, 0, r + 2.4, 0, TAU)
      ctx.fillStyle = ink(0.95)
      ctx.fill()
      const g = ctx.createRadialGradient(-r * 0.25, -r * 0.3, 1, 0, 0, r)
      g.addColorStop(0, '#7a1630')
      g.addColorStop(0.45, '#4a0c1e')
      g.addColorStop(0.85, '#1f0410')
      g.addColorStop(1, '#0d0207')
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, TAU)
      ctx.fillStyle = g
      ctx.fill()
      // 虹膜纹理：同心环 + 放射纤维
      ctx.save()
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, TAU)
      ctx.clip()
      ctx.lineWidth = 1.1
      ctx.strokeStyle = rgba(lighten(OV, 0.1), 0.16)
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU + 0.1
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42)
        ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9)
        ctx.stroke()
      }
      for (const k of [0.4, 0.88]) {
        ctx.beginPath()
        ctx.arc(0, 0, r * k, 0, TAU)
        ctx.lineWidth = k > 0.8 ? 2.2 : 1
        ctx.strokeStyle = rgba(OV, k > 0.8 ? 0.85 : 0.35)
        ctx.stroke()
      }
      // 受光的高光弧
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.9, Math.PI * 1.1, Math.PI * 1.55)
      ctx.lineWidth = 1.8
      ctx.strokeStyle = rgba('#ffffff', 0.4)
      ctx.stroke()
      ctx.restore()
    })
    this.ovPupil = make(40, 50, ss, (ctx) => {
      // 瞳孔：竖直的白热狭缝，只有它发光
      const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, 22)
      grad.addColorStop(0, rgba('#ff9aa8', 0.5))
      grad.addColorStop(1, rgba(OV, 0))
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(0, 0, 22, 0, TAU)
      ctx.fill()
      ctx.restore()
      ctx.beginPath()
      ctx.ellipse(0, 0, 7, 16.5, 0, 0, TAU)
      ctx.fillStyle = ink(0.9)
      ctx.fill()
      const sl = ctx.createLinearGradient(0, -15, 0, 15)
      sl.addColorStop(0, '#ffe3e8')
      sl.addColorStop(0.5, '#ffffff')
      sl.addColorStop(1, '#ffc2cc')
      ctx.beginPath()
      ctx.ellipse(0, 0, 5, 14.6, 0, 0, TAU)
      ctx.fillStyle = sl
      ctx.fill()
    })

    // ── 分形核心：嵌套谢尔宾斯基三角 ──
    this.frTri = make(130, 130, ss, (ctx) => {
      const r = 50
      const t = tonesOf(FR, -0.05)
      const v = (i: number, rad: number): [number, number] => [
        Math.cos((i / 3) * TAU - Math.PI / 2) * rad,
        Math.sin((i / 3) * TAU - Math.PI / 2) * rad,
      ]
      const tri = (rad: number): Trace => () => {
        ctx.beginPath()
        for (let i = 0; i < 3; i++) {
          const [x, y] = v(i, rad)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
      }
      hull(ctx, tri(r), r, t, { radial: true, facets: 3, phase: -Math.PI / 2, line: 2.6, facetK: 1.1 })
      const mid = (i: number): [number, number] => {
        const [x1, y1] = v(i, r)
        const [x2, y2] = v((i + 1) % 3, r)
        return [(x1 + x2) / 2, (y1 + y2) / 2]
      }
      // 中点连线构成的倒三角：向内凹陷的暗色底板
      const inv: Trace = () => {
        ctx.beginPath()
        for (let i = 0; i < 3; i++) {
          const [x, y] = mid(i)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
      }
      plate(ctx, inv, r, t.lo, t.deep, { line: 1.6 })
      // 三个角各自再细分一层：凸起的小三角板，中心一盏灯
      for (let i = 0; i < 3; i++) {
        const [cx, cy] = v(i, r)
        const a = mid(i)
        const b = mid((i + 2) % 3)
        const m1: [number, number] = [(cx + a[0]) / 2, (cy + a[1]) / 2]
        const m2: [number, number] = [(cx + b[0]) / 2, (cy + b[1]) / 2]
        const m3: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        // 这三个点围成的是中间的倒三角；真正的"角落小三角"用顶点 + 两个中点
        const corner: Trace = () => {
          ctx.beginPath()
          ctx.moveTo(cx * 0.86, cy * 0.86)
          ctx.lineTo(a[0], a[1])
          ctx.lineTo(b[0], b[1])
          ctx.closePath()
        }
        plate(ctx, corner, r, t.hi, t.mid, { raised: true, line: 1.2 })
        // 小三角里再嵌一个更小的凹槽
        const sub: Trace = () => {
          ctx.beginPath()
          ctx.moveTo(m1[0], m1[1])
          ctx.lineTo(m2[0], m2[1])
          ctx.lineTo(m3[0], m3[1])
          ctx.closePath()
        }
        groove(ctx, sub, 0.9)
        const gx = (cx + a[0] + b[0]) / 3
        const gy = (cy + a[1] + b[1]) / 3
        lamp(ctx, gx * 0.92, gy * 0.92, 2.4, FR, 0.9)
      }
    })
    this.frCore = make(60, 60, ss, (ctx) => {
      const hex: Trace = () => {
        ctx.beginPath()
        polygon(ctx, 6, 12, Math.PI / 6)
      }
      hull(ctx, hex, 12, tonesOf(FR, -0.1), { radial: true, facets: 6, phase: Math.PI / 6, line: 1.6 })
      lamp(ctx, 0, 0, 6.2, FR, 1.3)
    })

    // ── 虚空之喉：吞噬一切的黑洞 ──
    this.mwBody = make(190, 190, ss, (ctx) => {
      const r = 64
      const t = tonesOf(MW, 0.04)
      const disc = (k: number): Trace => () => {
        ctx.beginPath()
        ctx.arc(0, 0, r * k, 0, TAU)
      }
      // 金属外圈
      hull(ctx, disc(1), r, t, { radial: true, line: 2.8, rim: 1 })
      // 内部的虚空：近乎纯黑，只在边缘透出一点紫
      disc(0.76)()
      ctx.lineWidth = 3
      ctx.strokeStyle = ink(0.95)
      ctx.stroke()
      const g = ctx.createRadialGradient(0, 0, 3, 0, 0, r * 0.76)
      g.addColorStop(0, '#000000')
      g.addColorStop(0.62, '#04010c')
      g.addColorStop(0.9, '#1a0b38')
      g.addColorStop(1, '#3a1d72')
      disc(0.76)()
      ctx.fillStyle = g
      ctx.fill()
      // 吸积环：虚空边缘一圈细亮线
      disc(0.76)()
      ctx.lineWidth = 1.6
      ctx.strokeStyle = rgba(lighten(MW, 0.25), 0.75)
      ctx.stroke()
      disc(0.7)()
      ctx.lineWidth = 0.8
      ctx.strokeStyle = rgba('#ffffff', 0.25)
      ctx.stroke()
      // 内指的獠牙：金属尖牙，根部在外圈上
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU
        const ax = Math.cos(a)
        const ay = Math.sin(a)
        const fang: Trace = () => {
          ctx.beginPath()
          ctx.moveTo(ax * r * 0.97 - ay * 6.5, ay * r * 0.97 + ax * 6.5)
          ctx.lineTo(ax * r * 0.6, ay * r * 0.6)
          ctx.lineTo(ax * r * 0.97 + ay * 6.5, ay * r * 0.97 - ax * 6.5)
          ctx.closePath()
        }
        fang()
        ctx.lineWidth = 3.2
        ctx.strokeStyle = ink(0.95)
        ctx.stroke()
        const fg = ctx.createLinearGradient(ax * r * 0.97, ay * r * 0.97, ax * r * 0.6, ay * r * 0.6)
        fg.addColorStop(0, t.lo)
        fg.addColorStop(0.5, t.mid)
        fg.addColorStop(1, lighten(MW, 0.55))
        fang()
        ctx.fillStyle = fg
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(ax * r * 0.95 - ay * 5.2, ay * r * 0.95 + ax * 5.2)
        ctx.lineTo(ax * r * 0.62, ay * r * 0.62)
        ctx.lineWidth = 0.8
        ctx.strokeStyle = rgba('#ffffff', 0.45)
        ctx.stroke()
      }
    })
    this.mwArcs = make(230, 230, ss, (ctx) => {
      ctx.lineCap = 'round'
      const t = tonesOf(MW, 0.02)
      const plateArc = (R: number, a0: number, a1: number, w: number): void => {
        const seg = (): void => {
          ctx.beginPath()
          ctx.arc(0, 0, R, a0, a1)
        }
        seg()
        ctx.lineWidth = w + 3.2
        ctx.strokeStyle = ink(0.95)
        ctx.stroke()
        seg()
        ctx.lineWidth = w
        ctx.strokeStyle = t.mid
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(0, 0, R + w * 0.2, a0 + 0.04, a1 - 0.04)
        ctx.lineWidth = Math.max(0.9, w * 0.22)
        ctx.strokeStyle = rgba(lighten(MW, 0.55), 0.75)
        ctx.stroke()
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU
        plateArc(78, a, a + 1.05, 6.5)
        const e = a + 0.5
        lamp(ctx, Math.cos(e) * 78, Math.sin(e) * 78, 1.8, MW, 0.8)
      }
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.5
        plateArc(94, a, a + 0.62, 3.6)
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

    // 脚下的接触阴影：让庞然大物"压"在地面上
    const sh = bank.shadow
    const ss = b.r * 3.6
    ctx.globalAlpha = fade * 0.7
    ctx.drawImage(sh.c, -ss / 2 + b.r * 0.12, -ss / 2 + b.r * 0.3, ss, ss)

    // 阶段色的环境光：比旧版收得紧很多，只在机体周围一圈，蓄力时才明显
    ctx.globalCompositeOperation = 'lighter'
    const glow = bank.glow(col)
    const gs = b.r * (charging ? 3.8 : 2.7) * (1 + pulse * 0.06)
    ctx.globalAlpha = fade * (0.2 + pulse * 0.08 + (charging ? 0.3 : 0))
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
    const hot = b.flash > 0 ? 0.4 : intro ? 0.2 + 0.2 * Math.sin(vt * 30) : 0
    if (hot > 0) {
      ctx.globalCompositeOperation = 'lighter'
      const w = bank.glow('#ffffff')
      const ws = b.r * 2.3
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
        // 护盾球：实心的带描边球体（和玩家那种加色光弹一眼分得开）
        const bead = bank.bead('#ff9aa8')
        for (const o of b.orbs) {
          const bs = bead.w * ((o.r * 1.2) / 8)
          ctx.drawImage(bead.c, o.x - b.x - bs / 2, o.y - b.y - bs / 2, bs, bs)
        }
        break
      }
      case 'fractal': {
        const t = b.ang
        ctx.globalAlpha *= 0.97
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
