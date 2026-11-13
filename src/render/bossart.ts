import type { BossId } from '../data/ids'
import { TAU, clamp01 } from '../engine/math'
import type { Boss } from '../game/entities'
import { groove, hull, ink, lamp, plate, rivet, tonesOf, type Tones, type Trace } from './matte'
import { lighten, mixHex, rgba } from './palette'
import { bone, bounds, metal, solid } from './parts'
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
  private readonly ovClaws: Sprite
  private readonly ovHull: Sprite
  private readonly ovRing: Sprite
  private readonly ovIris: Sprite
  private readonly ovPupil: Sprite
  private readonly frBlades: Sprite
  private readonly frBlades2: Sprite
  private readonly frHub: Sprite
  private readonly frCore: Sprite
  private readonly frOrbit: Sprite
  private readonly mwHorns: Sprite
  private readonly mwBody: Sprite
  private readonly mwArcs: Sprite

  constructor(ss: number) {
    // ── 监察者：机械之眼 ──
    // 六条带钳的机械臂：一层压在最下面，慢慢反向转动
    this.ovClaws = make(210, 210, ss, (ctx) => {
      const t = tonesOf(OV, -0.02)
      const mt = metal(t)
      const bn = bone(t)
      for (let i = 0; i < 6; i++) {
        ctx.save()
        ctx.rotate(Math.PI / 6 + (i / 6) * TAU)
        // 上臂
        solid(ctx, 1, [[28, -10], [58, -7.5], [58, 7.5], [28, 10]], mt, { line: 2.2, rim: 0.9 })
        groove(ctx, () => { ctx.beginPath(); ctx.moveTo(41, -9); ctx.lineTo(41, 9) }, 1.2)
        // 肘关节
        hull(ctx, () => { ctx.beginPath(); ctx.arc(60, 0, 8.5, 0, TAU) }, 8.5, mt, { radial: true, line: 2, cx: 60 })
        lamp(ctx, 60, 0, 2.5, OV, 0.9)
        // 前臂向外折一下
        ctx.translate(60, 0)
        ctx.rotate(0.5)
        solid(ctx, 1, [[0, -6.5], [20, -5], [20, 5], [0, 6.5]], mt, { line: 2, rim: 0.8 })
        // 钳：两根向内弯的骨白尖爪
        ctx.translate(20, 0)
        solid(ctx, 1, [[-2, -5.5], [10, -15], [23, -12], [28, -2.5], [17, -7], [7, -3]], bn, { line: 1.9, rim: 0.9 })
        solid(ctx, 1, [[-2, 5.5], [10, 15], [23, 12], [28, 2.5], [17, 7], [7, 3]], bn, { line: 1.9, rim: 0.9, flip: true })
        ctx.restore()
      }
    })
    // 机体：八片虹膜叶片拧成的光圈，中间是眼眶
    this.ovHull = make(180, 180, ss, (ctx) => {
      const r = 58
      const t = tonesOf(OV, -0.04)
      const mt = metal(t)
      const P = (rad: number, a: number): [number, number] => [Math.cos(a) * rad, Math.sin(a) * rad]
      // 底盘圆环
      hull(ctx, () => { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU) }, r, t, { radial: true, line: 3, rim: 1 })
      // 叶片：每片都压住上一片的边，拧出一圈光圈的旋涡
      const N = 8
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU
        const leaf: [number, number][] = [P(r - 3, a), P(r - 3, a + 0.92), P(31, a + 1.5), P(31, a + 0.62)]
        const b = bounds(leaf, 1)
        hull(ctx, () => { ctx.beginPath(); leaf.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))); ctx.closePath() }, b.r, t, { line: 1.8, rim: 1, cx: b.cx, cy: b.cy, light: a + 0.5 })
        // 叶片上的刻线和铆钉
        const m = P(r * 0.78, a + 0.55)
        rivet(ctx, m[0], m[1], 2)
        groove(ctx, () => { ctx.beginPath(); const q = P(r - 8, a + 0.5); const w = P(36, a + 0.95); ctx.moveTo(q[0], q[1]); ctx.lineTo(w[0], w[1]) }, 1.1)
      }
      // 眼眶：深色的凹口 + 金属圈
      ctx.beginPath()
      ctx.arc(0, 0, 33, 0, TAU)
      ctx.fillStyle = ink(0.97)
      ctx.fill()
      hull(ctx, () => { ctx.beginPath(); ctx.arc(0, 0, 33, 0, TAU); ctx.arc(0, 0, 29, 0, TAU, true) }, 33, mt, { line: 1.2, rim: 0.9 })
      // 外圈的灯
      for (let i = 0; i < N; i++) lamp(ctx, ...P(r - 1, (i / N) * TAU + 0.2), 2.2, OV, 0.85)
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

    // ── 分形核心：水晶蜂巢 ──
    // 一根晶柱：尖头、刻面一半亮一半暗（默认从 x=16 起，根部被中央底座盖住）
    const crystal = (ctx: CanvasRenderingContext2D, len: number, w: number, t: Tones, base = 16): void => {
      const half: [number, number][] = [[len, 0], [len * 0.52, w], [base, w * 0.8], [base, 0]]
      const full: [number, number][] = [...half, ...half.slice(1, -1).reverse().map(([x, y]): [number, number] => [x, -y])]
      solid(ctx, 1, full, t, { line: 2, rim: 0.6 })
      ctx.save()
      ctx.beginPath()
      full.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      ctx.clip()
      ctx.beginPath()
      half.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = rgba('#ffffff', 0.36)
      ctx.fill()
      ctx.beginPath()
      half.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, -y) : ctx.lineTo(x, -y)))
      ctx.closePath()
      ctx.fillStyle = rgba('#000000', 0.32)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(len, 0)
      ctx.lineTo(len * 0.52, w)
      ctx.lineTo(len * 0.52 - w * 0.9, w)
      ctx.lineTo(len * 0.64, 0)
      ctx.closePath()
      ctx.fillStyle = rgba('#ffffff', 0.3)
      ctx.fill()
      ctx.restore()
      groove(ctx, () => { ctx.beginPath(); ctx.moveTo(len * 0.52, w); ctx.lineTo(len * 0.52, -w) }, 0.9)
    }
    this.frBlades = make(160, 160, ss, (ctx) => {
      const t = tonesOf(FR, -0.04)
      for (let i = 0; i < 6; i++) {
        ctx.save()
        ctx.rotate((i / 6) * TAU)
        crystal(ctx, 68, 16, t)
        ctx.restore()
      }
    })
    this.frBlades2 = make(120, 120, ss, (ctx) => {
      const t = tonesOf('#d9ff4d', -0.02)
      for (let i = 0; i < 6; i++) {
        ctx.save()
        ctx.rotate((i / 6) * TAU + Math.PI / 6)
        crystal(ctx, 46, 11, t)
        ctx.restore()
      }
    })
    this.frHub = make(80, 80, ss, (ctx) => {
      const t = tonesOf(FR, -0.04)
      const hex = (k: number): Trace => () => {
        ctx.beginPath()
        polygon(ctx, 6, 30 * k, Math.PI / 6)
      }
      hull(ctx, hex(1), 30, t, { radial: true, facets: 6, phase: Math.PI / 6, line: 2.4, facetK: 1.1 })
      plate(ctx, hex(0.7), 30, mixHex(t.lo, t.mid, 0.3), t.deep, { line: 1.3 })
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i / 6) * TAU
        rivet(ctx, Math.cos(a) * 27, Math.sin(a) * 27, 1.8)
      }
    })
    this.frCore = make(60, 60, ss, (ctx) => {
      const hex: Trace = () => {
        ctx.beginPath()
        polygon(ctx, 6, 14, Math.PI / 6)
      }
      hull(ctx, hex, 14, tonesOf(FR, -0.1), { radial: true, facets: 6, phase: Math.PI / 6, line: 1.6 })
      lamp(ctx, 0, 0, 7, FR, 1.4)
    })
    this.frOrbit = make(40, 40, ss, (ctx) => {
      ctx.rotate(Math.PI / 2)
      crystal(ctx, 14, 6, tonesOf('#d9ff4d', -0.02), -9)
    })

    // ── 虚空之喉：吞噬一切的黑洞 ──
    // 外圈一圈弯曲的长角（像日冕 / 触须），慢慢反向旋转
    this.mwHorns = make(240, 240, ss, (ctx) => {
      const t = tonesOf(MW, 0.02)
      const P = (rad: number, a: number): [number, number] => [Math.cos(a) * rad, Math.sin(a) * rad]
      const N = 8
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU
        const horn = (): void => {
          ctx.beginPath()
          const b0 = P(58, a - 0.2)
          const tip = P(104, a + 0.95)
          const c0 = P(84, a + 0.06)
          const c1 = P(80, a + 0.58)
          const b1 = P(62, a + 0.24)
          ctx.moveTo(b0[0], b0[1])
          ctx.quadraticCurveTo(c0[0], c0[1], tip[0], tip[1])
          ctx.quadraticCurveTo(c1[0], c1[1], b1[0], b1[1])
          ctx.closePath()
        }
        horn()
        ctx.lineWidth = 6
        ctx.strokeStyle = ink(0.95)
        ctx.stroke()
        const s0 = P(60, a)
        const s1 = P(104, a + 0.95)
        const g = ctx.createLinearGradient(s0[0], s0[1], s1[0], s1[1])
        g.addColorStop(0, t.lo)
        g.addColorStop(0.5, t.mid)
        g.addColorStop(1, lighten(MW, 0.6))
        horn()
        ctx.fillStyle = g
        ctx.fill()
        // 受光的一条棱
        ctx.beginPath()
        const e0 = P(64, a - 0.12)
        const ec = P(84, a + 0.08)
        ctx.moveTo(e0[0], e0[1])
        ctx.quadraticCurveTo(ec[0], ec[1], s1[0], s1[1])
        ctx.lineWidth = 1.2
        ctx.strokeStyle = rgba('#ffffff', 0.45)
        ctx.stroke()
      }
    })
    this.mwBody = make(190, 190, ss, (ctx) => {
      const r = 64
      const t = tonesOf(MW, 0.04)
      const disc = (k: number): Trace => () => {
        ctx.beginPath()
        ctx.arc(0, 0, r * k, 0, TAU)
      }
      // 金属外圈
      hull(ctx, disc(1), r, t, { radial: true, line: 2.8, rim: 1 })
      // 外圈上的齿龈板缝
      for (let i = 0; i < 12; i++) {
        const a = ((i + 0.5) / 12) * TAU
        groove(ctx, () => { ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8); ctx.lineTo(Math.cos(a) * r * 0.99, Math.sin(a) * r * 0.99) }, 1)
      }
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
      // 两排獠牙：12 根大牙，之间夹 12 根小牙
      for (let i = 0; i < 24; i++) {
        const big = i % 2 === 0
        const a = (i / 24) * TAU
        const ax = Math.cos(a)
        const ay = Math.sin(a)
        const hw = big ? 6.5 : 4
        const tipK = big ? 0.58 : 0.74
        const fang: Trace = () => {
          ctx.beginPath()
          ctx.moveTo(ax * r * 0.97 - ay * hw, ay * r * 0.97 + ax * hw)
          ctx.lineTo(ax * r * tipK, ay * r * tipK)
          ctx.lineTo(ax * r * 0.97 + ay * hw, ay * r * 0.97 - ax * hw)
          ctx.closePath()
        }
        fang()
        ctx.lineWidth = big ? 3.2 : 2.4
        ctx.strokeStyle = ink(0.95)
        ctx.stroke()
        const fg = ctx.createLinearGradient(ax * r * 0.97, ay * r * 0.97, ax * r * tipK, ay * r * tipK)
        fg.addColorStop(0, t.lo)
        fg.addColorStop(0.5, t.mid)
        fg.addColorStop(1, lighten(MW, big ? 0.6 : 0.45))
        fang()
        ctx.fillStyle = fg
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(ax * r * 0.95 - ay * (hw - 1.3), ay * r * 0.95 + ax * (hw - 1.3))
        ctx.lineTo(ax * r * (tipK + 0.04), ay * r * (tipK + 0.04))
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
        // 机械臂在最下面，蓄力时向外张开一点
        const open = 1 + (b.state === 2 ? 0.08 : 0.025 * Math.sin(vt * 2.2))
        this.rot(ctx, this.ovClaws, -b.ang * 0.2 - vt * 0.08, open)
        this.rot(ctx, this.ovHull, b.ang * 0.35 + vt * 0.1)
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
        // 两层反向旋转的晶柱，中间是六角底座和一颗跳动的核
        this.rot(ctx, this.frBlades, t * 0.9, 1)
        this.rot(ctx, this.frBlades2, -t * 1.5, 1)
        this.rot(ctx, this.frHub, t * 0.4, 1)
        const cs = 1 + 0.18 * Math.sin(vt * 5)
        this.rot(ctx, this.frCore, vt * 0.8, cs)
        // 环绕的小晶体
        const n = 3 + b.phase
        for (let i = 0; i < n; i++) {
          const a = t * 1.9 + (i / n) * TAU
          ctx.save()
          ctx.translate(Math.cos(a) * (b.r + 22), Math.sin(a) * (b.r + 22))
          ctx.rotate(a * 2)
          ctx.drawImage(this.frOrbit.c, -this.frOrbit.w / 2, -this.frOrbit.h / 2, this.frOrbit.w, this.frOrbit.h)
          ctx.restore()
        }
        break
      }
      case 'maw': {
        const bs = 1 + 0.018 * Math.sin(vt * 3.2)
        this.rot(ctx, this.mwHorns, -b.ang * 0.9, 1 + 0.03 * Math.sin(vt * 2.4))
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
