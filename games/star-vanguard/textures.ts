// 星穹守卫 —— 程序化纹理生成（零外部素材，PRD 1.3 / A16）
// 全部纹理在 BootScene.create 中调用 createTextures 生成一次

import Phaser from 'phaser'
import { COLOR } from './config'

// 确定性扰动（无随机，保证每次生成形状一致）
const wob = (i: number, seed: number): number => Math.sin(i * 2.7 + seed) * 0.5 + 0.5

const vec = (x: number, y: number): Phaser.Math.Vector2 => new Phaser.Math.Vector2(x, y)

/** 绘制一颗小行星：n 个顶点的粗糙多边形 + 暗色描边 */
function drawAsteroid(g: Phaser.GameObjects.Graphics, size: number, seed: number): void {
  const r = size / 2
  const points: Phaser.Math.Vector2[] = []
  const n = 12
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2
    const rad = r * (0.72 + 0.28 * wob(i, seed))
    points.push(vec(r + Math.cos(a) * rad, r + Math.sin(a) * rad))
  }
  g.fillStyle(COLOR.asteroid, 1)
  g.fillPoints(points, true)
  g.lineStyle(3, COLOR.asteroidDark, 1)
  g.strokePoints(points, true, true)
  // 陨石坑
  g.fillStyle(COLOR.asteroidDark, 0.55)
  g.fillCircle(r * 0.7, size * 0.42, size * 0.1)
  g.fillCircle(r * 1.2, size * 0.68, size * 0.07)
}

/** 绘制道具图标：圆底 + 符号 */
function drawPower(
  g: Phaser.GameObjects.Graphics,
  kind: 'life' | 'double' | 'shield' | 'rapid',
): void {
  const c = 22
  const colors = { life: 0x7dff8f, double: 0x4cc9f0, shield: 0x6fa8ff, rapid: 0xff9f43 } as const
  const main = colors[kind]
  g.fillStyle(0x0b0d12, 0.92)
  g.fillCircle(c, c, 19)
  g.lineStyle(3, main, 1)
  g.strokeCircle(c, c, 19)
  g.fillStyle(main, 1)
  if (kind === 'life') {
    g.fillRect(c - 3, c - 11, 6, 22)
    g.fillRect(c - 11, c - 3, 22, 6)
  } else if (kind === 'double') {
    g.fillRoundedRect(11, 8, 6, 28, 3)
    g.fillRoundedRect(27, 8, 6, 28, 3)
  } else if (kind === 'shield') {
    g.fillPoints([
      vec(c, 7),
      vec(35, c),
      vec(c, 37),
      vec(9, c),
    ])
  } else {
    g.fillTriangle(12, 8, 12, 36, 24, 22)
    g.fillTriangle(24, 8, 24, 36, 36, 22)
  }
}

/**
 * 生成游戏全部纹理（幂等：已存在则跳过）
 * 纹理 key 汇总：player / asteroidL / asteroidS / ufo / dart / boss /
 *               bullet / ebullet / power-life / power-double / power-shield /
 *               power-rapid / glow
 */
export function createTextures(scene: Phaser.Scene): void {
  const t = scene.textures

  if (!t.exists('player')) {
    const g = scene.add.graphics()
    // 蓝色战机：机身 + 双翼 + 座舱 + 引擎口
    g.fillStyle(COLOR.playerDark, 1)
    g.fillPoints([
      vec(2, 46),
      vec(14, 52),
      vec(15, 30),
    ])
    g.fillPoints([
      vec(50, 46),
      vec(38, 52),
      vec(37, 30),
    ])
    g.fillStyle(COLOR.player, 1)
    g.fillPoints([
      vec(26, 2),
      vec(39, 30),
      vec(35, 48),
      vec(17, 48),
      vec(13, 30),
    ])
    g.fillStyle(0x1a2d3a, 1)
    g.fillRect(20, 44, 12, 7)
    g.fillStyle(0x9ff3ff, 1)
    g.fillCircle(26, 20, 5)
    g.generateTexture('player', 52, 56)
    g.destroy()
  }

  if (!t.exists('asteroidL')) {
    const g = scene.add.graphics()
    drawAsteroid(g, 64, 1.7)
    g.generateTexture('asteroidL', 64, 64)
    g.destroy()
  }

  if (!t.exists('asteroidS')) {
    const g = scene.add.graphics()
    drawAsteroid(g, 36, 4.2)
    g.generateTexture('asteroidS', 36, 36)
    g.destroy()
  }

  if (!t.exists('ufo')) {
    const g = scene.add.graphics()
    // 圆顶
    g.fillStyle(COLOR.ufoDome, 1)
    g.fillEllipse(32, 15, 26, 20)
    g.fillStyle(0xffffff, 0.4)
    g.fillEllipse(28, 12, 7, 6)
    // 机身
    g.fillStyle(COLOR.ufo, 1)
    g.fillEllipse(32, 24, 54, 22)
    // 底部灯光
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(16, 34, 3)
    g.fillCircle(32, 35, 3)
    g.fillCircle(48, 34, 3)
    g.generateTexture('ufo', 64, 40)
    g.destroy()
  }

  if (!t.exists('dart')) {
    const g = scene.add.graphics()
    // 橙色俯冲三角（尖朝下）
    g.fillStyle(COLOR.dart, 1)
    g.fillTriangle(22, 2, 41, 40, 3, 38)
    g.fillStyle(0xffe3c2, 1)
    g.fillTriangle(22, 14, 30, 30, 14, 29)
    g.generateTexture('dart', 44, 44)
    g.destroy()
  }

  if (!t.exists('boss')) {
    const g = scene.add.graphics()
    // 双翼
    g.fillStyle(COLOR.bossDark, 1)
    g.fillPoints([
      vec(4, 42),
      vec(52, 54),
      vec(40, 66),
    ])
    g.fillPoints([
      vec(164, 42),
      vec(116, 54),
      vec(128, 66),
    ])
    // 机身
    g.fillStyle(COLOR.boss, 1)
    g.fillEllipse(84, 46, 122, 62)
    // 座舱
    g.fillStyle(0xffd9e2, 1)
    g.fillEllipse(84, 30, 42, 24)
    // 底部炮口灯
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(56, 72, 4)
    g.fillCircle(84, 74, 4)
    g.fillCircle(112, 72, 4)
    g.generateTexture('boss', 168, 80)
    g.destroy()
  }

  if (!t.exists('bullet')) {
    const g = scene.add.graphics()
    g.fillStyle(COLOR.bullet, 1)
    g.fillRoundedRect(0, 0, 6, 16, 3)
    g.fillStyle(0xffffff, 1)
    g.fillRoundedRect(1.5, 1.5, 3, 8, 1.5)
    g.generateTexture('bullet', 6, 16)
    g.destroy()
  }

  if (!t.exists('ebullet')) {
    const g = scene.add.graphics()
    g.fillStyle(COLOR.enemyBullet, 1)
    g.fillCircle(6, 6, 5)
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(6, 6, 2.2)
    g.generateTexture('ebullet', 12, 12)
    g.destroy()
  }

  for (const kind of ['life', 'double', 'shield', 'rapid'] as const) {
    if (!t.exists(`power-${kind}`)) {
      const g = scene.add.graphics()
      drawPower(g, kind)
      g.generateTexture(`power-${kind}`, 44, 44)
      g.destroy()
    }
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
}