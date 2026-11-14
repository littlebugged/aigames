import { TAU } from '../engine/math'
import type { SpriteBank } from './sprites'

/**
 * 地面痕迹与烟团：榴弹炮落地之后留下的东西。
 *
 * 爆炸本身是加色的闪光（blast / 粒子），但"炸过了"应该有实物的痕迹——
 * 地上一块焦黑的弹坑、一团向上飘散的灰烟。这两样都是哑光的，用普通混合画，所以是"脏"的而不是"亮"的：
 * 闪光负责冲击，焦痕和烟负责分量。数量有硬上限，满了就不再添。
 */

interface Mark {
  x: number
  y: number
  r: number
  rot: number
  t: number
  T: number
}

interface Puff {
  x: number
  y: number
  vx: number
  vy: number
  r0: number
  r1: number
  t: number
  T: number
  a: number
}

export const MAX_MARKS = 16
export const MAX_PUFFS = 64
/** 焦痕前这一段时间保持全浓，之后淡出（占总时长的比例） */
const MARK_HOLD = 0.35
/** 烟团的减速（每秒保留的速度比例的自然对数） */
const PUFF_DRAG = 2.4
/** 烟向屏幕上方的漂移加速度（世界单位 / 秒²） */
const PUFF_RISE = 16

const smooth = (u: number): number => 1 - (1 - u) * (1 - u)

export class GroundFx {
  private readonly marks: Mark[] = []
  private readonly puffs: Puff[] = []

  get markCount(): number {
    return this.marks.length
  }

  get puffCount(): number {
    return this.puffs.length
  }

  clear(): void {
    this.marks.length = 0
    this.puffs.length = 0
  }

  /** 弹坑焦痕：半径 r 是爆炸半径，痕迹比它略大一点；满了就顶掉最老的 */
  scorch(x: number, y: number, r: number, life = 2.6): void {
    if (this.marks.length >= MAX_MARKS) this.marks.shift()
    this.marks.push({ x, y, r, rot: Math.random() * TAU, t: 0, T: life })
  }

  /** 一团烟：半径从 r0 长到 r1，同时变淡；满了就丢弃（烟是点缀） */
  smoke(x: number, y: number, vx: number, vy: number, r0: number, r1: number, life: number, alpha = 0.5): void {
    if (this.puffs.length >= MAX_PUFFS) return
    this.puffs.push({ x, y, vx, vy, r0, r1, t: 0, T: life, a: alpha })
  }

  update(dt: number): void {
    if (dt <= 0) return
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i]
      m.t += dt
      // 焦痕最多 MAX_MARKS 个：用 splice 保持"从老到新"的顺序，满了顶掉的才是最老的
      if (m.t >= m.T) this.marks.splice(i, 1)
    }
    const drag = Math.exp(-PUFF_DRAG * dt)
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]
      p.t += dt
      if (p.t >= p.T) {
        this.puffs[i] = this.puffs[this.puffs.length - 1]
        this.puffs.pop()
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= drag
      p.vy = p.vy * drag - PUFF_RISE * dt
    }
  }

  /** 焦痕的当前浓度 0..1（测试 / 调试用） */
  markAlpha(i: number): number {
    const m = this.marks[i]
    if (!m) return 0
    const u = m.t / m.T
    return u < MARK_HOLD ? 1 : Math.max(0, 1 - (u - MARK_HOLD) / (1 - MARK_HOLD))
  }

  /** 画焦痕（地面层：在敌人下面）。调用方已设好世界坐标变换与 source-over。 */
  drawMarks(ctx: CanvasRenderingContext2D, bank: SpriteBank, inView: (x: number, y: number, m: number) => boolean): void {
    const spr = bank.scorch
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i]
      if (!inView(m.x, m.y, m.r * 1.5)) continue
      const a = this.markAlpha(i)
      if (a <= 0.01) continue
      // 精灵里的斑块半径约 54（盒子 128），按爆炸半径缩放
      const k = (m.r * 1.15) / 54
      ctx.save()
      ctx.translate(m.x, m.y)
      ctx.rotate(m.rot)
      ctx.globalAlpha = 0.72 * a
      ctx.drawImage(spr.c, (-spr.w * k) / 2, (-spr.h * k) / 2, spr.w * k, spr.h * k)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  /** 画烟团（在敌人上面、玩家下面）。调用方已设好世界坐标变换与 source-over。 */
  drawSmoke(ctx: CanvasRenderingContext2D, bank: SpriteBank, inView: (x: number, y: number, m: number) => boolean): void {
    const spr = bank.puff
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i]
      if (!inView(p.x, p.y, p.r1 * 1.2)) continue
      const u = p.t / p.T
      const r = p.r0 + (p.r1 - p.r0) * smooth(u)
      const a = p.a * Math.pow(1 - u, 1.35) * Math.min(1, u / 0.07)
      if (a <= 0.01) continue
      ctx.globalAlpha = a
      ctx.drawImage(spr.c, p.x - r, p.y - r, r * 2, r * 2)
    }
    ctx.globalAlpha = 1
  }
}
