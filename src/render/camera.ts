import { clamp } from '../engine/math'

/**
 * 镜头：平滑跟随 + 前瞻 + 创伤式震屏。
 * 震屏用 trauma²：轻微的冲击几乎无感，连续重击才会明显晃动，手感更自然。
 */
export class Camera {
  x = 0
  y = 0
  /** 当前震屏偏移（世界单位） */
  sx = 0
  sy = 0
  private trauma = 0
  private t = 0

  reset(x: number, y: number): void {
    this.x = x
    this.y = y
    this.trauma = 0
    this.sx = this.sy = 0
  }

  addTrauma(a: number): void {
    this.trauma = Math.min(1, this.trauma + a)
  }

  update(dt: number, px: number, py: number, vx: number, vy: number, shake: boolean): void {
    this.t += dt
    const lx = px + vx * 0.22
    const ly = py + vy * 0.22
    const k = 1 - Math.exp(-7 * dt)
    this.x += (lx - this.x) * k
    this.y += (ly - this.y) * k
    this.trauma = Math.max(0, this.trauma - 1.5 * dt)
    if (shake && this.trauma > 0) {
      const m = this.trauma * this.trauma * 15
      this.sx = (Math.sin(this.t * 61) + Math.sin(this.t * 37 + 1.3)) * 0.5 * m
      this.sy = (Math.sin(this.t * 53 + 2.1) + Math.sin(this.t * 29 + 0.4)) * 0.5 * m
    } else {
      this.sx = this.sy = 0
    }
  }

  /** 视口缩放：以 1280×720 为 1.0，按面积开方缩放，夹在合理范围 */
  static scaleFor(w: number, h: number): number {
    return clamp(Math.sqrt((w * h) / 921600), 0.62, 1.6)
  }
}
