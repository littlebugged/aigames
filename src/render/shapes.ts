import { TAU } from '../engine/math'

/**
 * 通用矢量形状（原点为中心）。敌人的外形在 creatures.ts，飞船在 shipart.ts，Boss 在 bossart.ts；
 * 这里只剩一个正多边形路径工具。
 */

export function polygon(ctx: CanvasRenderingContext2D, n: number, r: number, rot = 0): void {
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}
