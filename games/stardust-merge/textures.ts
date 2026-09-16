// 星尘消消乐 —— 程序化纹理生成（零外部素材，PRD A-16）
// 全部纹理在 BootScene.create 中生成一次：tile-2 ~ tile-1024 / glow / spark

import Phaser from 'phaser'
import { CELL, TILE_COLORS } from './config'

/** 圆角矩形路径（兼容性辅助） */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * 绘制一枚数字方块：圆角矩形 + 线性渐变 + 内描边 + 顶部高光
 * 尺寸 CELL×CELL（Canvas 绘制，支持平滑渐变）
 */
function drawTile(
  scene: Phaser.Scene,
  value: number,
  size: number,
  [top, bottom]: readonly [number, number],
): void {
  const key = `tile-${value}`
  const t = scene.textures
  if (t.exists(key)) return
  const canvas = t.createCanvas(key, size, size)
  if (!canvas) return
  const ctx = canvas.context
  const hex = (v: number): string => '#' + v.toString(16).padStart(6, '0')
  const grad = ctx.createLinearGradient(0, 0, 0, size)
  grad.addColorStop(0, hex(top))
  grad.addColorStop(1, hex(bottom))
  ctx.fillStyle = grad
  roundRectPath(ctx, 0.5, 0.5, size - 1, size - 1, 9)
  ctx.fill()
  // 内描边
  ctx.strokeStyle = 'rgba(255,255,255,0.24)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  // 顶部高光
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  roundRectPath(ctx, 3, 3, size - 6, size * 0.3, 7)
  ctx.fill()
  canvas.refresh()
}

/**
 * 生成游戏全部纹理（幂等：已存在则跳过）
 * 纹理 key 汇总：tile-2 / tile-4 / ... / tile-1024 / glow / spark
 */
export function createTextures(scene: Phaser.Scene): void {
  const t = scene.textures

  // 数字方块（10 级渐变）
  for (const [value, colors] of Object.entries(TILE_COLORS)) {
    drawTile(scene, Number(value), CELL, colors)
  }

  // 径向光晕（canvas 渐变），用于粒子/发光效果
  if (!t.exists('glow')) {
    const canvas = t.createCanvas('glow', 64, 64)
    if (canvas) {
      const ctx = canvas.context
      const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(0.35, 'rgba(255,255,255,0.5)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 64, 64)
      canvas.refresh()
    }
  }

  // 四角星尘（消除粒子）
  if (!t.exists('spark')) {
    const g = scene.add.graphics()
    g.fillStyle(0xffffff, 1)
    const s = 10
    g.fillPoints(
      [
        new Phaser.Math.Vector2(s / 2, 0),
        new Phaser.Math.Vector2(s * 0.62, s * 0.38),
        new Phaser.Math.Vector2(s, s / 2),
        new Phaser.Math.Vector2(s * 0.62, s * 0.62),
        new Phaser.Math.Vector2(s / 2, s),
        new Phaser.Math.Vector2(s * 0.38, s * 0.62),
        new Phaser.Math.Vector2(0, s / 2),
        new Phaser.Math.Vector2(s * 0.38, s * 0.38),
      ],
      true,
    )
    g.generateTexture('spark', s, s)
    g.destroy()
  }
}