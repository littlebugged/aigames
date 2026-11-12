import type { EnemyShape } from '../data/enemies'
import { TAU } from '../engine/math'

/**
 * 霓虹风格的矢量形状。所有路径都以原点为中心、车头朝 +x。
 * 精灵生成和 Boss 绘制共用这里的路径。
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

/** 敌人外轮廓路径（只构建，不描边） */
export function traceEnemy(ctx: CanvasRenderingContext2D, shape: EnemyShape, r: number): void {
  ctx.beginPath()
  switch (shape) {
    case 'tri':
      ctx.moveTo(r, 0)
      ctx.lineTo(-r * 0.78, r * 0.86)
      ctx.lineTo(-r * 0.4, 0)
      ctx.lineTo(-r * 0.78, -r * 0.86)
      ctx.closePath()
      break
    case 'diamond':
      ctx.moveTo(r, 0)
      ctx.lineTo(0, r * 0.62)
      ctx.lineTo(-r, 0)
      ctx.lineTo(0, -r * 0.62)
      ctx.closePath()
      break
    case 'hex':
      polygon(ctx, 6, r, 0)
      break
    case 'ring':
      ctx.arc(0, 0, r, 0, TAU)
      break
    case 'square':
      polygon(ctx, 4, r * 1.2, Math.PI / 4)
      break
    case 'chevron':
      ctx.moveTo(r, 0)
      ctx.lineTo(-r * 0.55, r * 0.95)
      ctx.lineTo(-r * 0.2, 0)
      ctx.lineTo(-r * 0.55, -r * 0.95)
      ctx.closePath()
      break
    case 'orb':
      ctx.arc(0, 0, r, 0, TAU)
      break
    case 'oct':
      polygon(ctx, 8, r, Math.PI / 8)
      break
    case 'crescent':
      ctx.arc(0, 0, r, -Math.PI * 0.62, Math.PI * 0.62)
      ctx.arc(-r * 0.45, 0, r * 0.82, Math.PI * 0.5, -Math.PI * 0.5, true)
      ctx.closePath()
      break
    case 'shard':
      ctx.moveTo(r * 1.15, 0)
      ctx.lineTo(0, r * 0.4)
      ctx.lineTo(-r * 0.9, 0)
      ctx.lineTo(0, -r * 0.4)
      ctx.closePath()
      break
  }
}

/** 形状内部的细节线条（让每种敌人一眼可辨） */
export function detailEnemy(ctx: CanvasRenderingContext2D, shape: EnemyShape, r: number): void {
  ctx.beginPath()
  switch (shape) {
    case 'tri':
      ctx.arc(r * 0.05, 0, r * 0.22, 0, TAU)
      break
    case 'diamond':
      ctx.moveTo(-r * 0.4, 0)
      ctx.lineTo(r * 0.45, 0)
      break
    case 'hex':
      polygon(ctx, 6, r * 0.55, 0)
      ctx.moveTo(r * 0.18, 0)
      ctx.arc(0, 0, r * 0.18, 0, TAU)
      break
    case 'ring':
      ctx.arc(0, 0, r * 0.45, 0, TAU)
      ctx.moveTo(r * 0.45, 0)
      ctx.lineTo(r * 1.05, 0)
      break
    case 'square':
      polygon(ctx, 4, r * 0.62, Math.PI / 4)
      ctx.moveTo(-r * 0.85, 0)
      ctx.lineTo(r * 0.85, 0)
      ctx.moveTo(0, -r * 0.85)
      ctx.lineTo(0, r * 0.85)
      break
    case 'chevron':
      ctx.moveTo(r * 0.55, 0)
      ctx.lineTo(-r * 0.25, r * 0.55)
      ctx.moveTo(r * 0.55, 0)
      ctx.lineTo(-r * 0.25, -r * 0.55)
      break
    case 'orb':
      ctx.arc(0, 0, r * 0.55, 0, TAU)
      ctx.moveTo(r * 0.2, 0)
      ctx.arc(0, 0, r * 0.2, 0, TAU)
      break
    case 'oct':
      polygon(ctx, 8, r * 0.58, Math.PI / 8)
      break
    case 'crescent':
      ctx.moveTo(r * 0.2, -r * 0.2)
      ctx.arc(r * 0.2, 0, r * 0.2, -Math.PI / 2, Math.PI / 2)
      break
    case 'shard':
      ctx.moveTo(-r * 0.45, 0)
      ctx.lineTo(r * 0.7, 0)
      break
  }
}

/** 是否需要随运动方向旋转（false 的缓慢自转） */
export const FACES_MOTION: Record<EnemyShape, boolean> = {
  tri: true,
  diamond: true,
  hex: false,
  ring: false,
  square: false,
  chevron: true,
  orb: false,
  oct: false,
  crescent: true,
  shard: true,
}
