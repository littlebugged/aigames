import { TAU } from '../engine/math'
import { ink } from './matte'
import { lighten, mixHex, rgba } from './palette'
import { cut, type Ctx, type Pt } from './parts'
import type { EBulletKind } from '../data/ids'

/**
 * 敌方子弹的造型。
 *
 * 旧版所有敌人的子弹都是同一颗"彩球"（外加一种线段针弹），弹幕一密就只剩颜色可以区分。
 * 现在每一类弹幕都有自己的剪影：炮手吐出带尾的唾液团，监察者的镜片弹中间是个瞳孔，
 * 分形核心打出棱形晶片，虚空之喉的是弯钩獠牙，所有 Boss 的瞄准弹是带尾翼的飞镖。
 *
 * 约定（和碰撞对齐）：
 * - 画在精灵中心，朝 +x（沿弹道方向），设计基准是"碰撞半径 6"，渲染时按 b.r / 6 缩放；
 * - 弹体的重心落在原点（碰撞圆心），前端伸出不超过 ≈1.6 倍碰撞半径，拖尾放在后面；
 * - 全是不透明的实心件 + 深色墨线描边，不用加色混合：描边的东西是危险的，和玩家那种"加色光弹"一眼分得开。
 */

/** 精灵画布尺寸（设计单位）：所有朝向弹丸共用，保证渲染端的缩放逻辑一致 */
export const EBULLET_BOX = { w: 40, h: 26 }

/** 墨线打底：先用同一条路径描一圈深色，再填色，边缘在任何背景上都分得清 */
function body(ctx: Ctx, trace: () => void, w = 2.4): void {
  trace()
  ctx.lineWidth = w
  ctx.strokeStyle = ink(0.92)
  ctx.stroke()
}

/** 镜片弹（监察者）：彩色的虹膜环 + 深色瞳孔 + 一点高光——像一只小眼睛 */
function paintLens(ctx: Ctx, color: string): void {
  const R = 7.8
  ctx.beginPath()
  ctx.arc(0, 0, R + 1.2, 0, TAU)
  ctx.fillStyle = ink(0.92)
  ctx.fill()
  // 虹膜：从边缘的深色到内圈的亮色，内圈比外圈亮，看起来是凹进去的
  const g = ctx.createRadialGradient(0, 0, R * 0.3, 0, 0, R)
  g.addColorStop(0, lighten(color, 0.55))
  g.addColorStop(0.55, color)
  g.addColorStop(1, mixHex(color, '#080a12', 0.45))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, R, 0, TAU)
  ctx.fill()
  // 瞳孔
  ctx.beginPath()
  ctx.arc(0, 0, R * 0.42, 0, TAU)
  ctx.fillStyle = ink(0.95)
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = rgba(lighten(color, 0.8), 0.85)
  ctx.stroke()
  // 高光
  ctx.beginPath()
  ctx.arc(-R * 0.36, -R * 0.4, R * 0.17, 0, TAU)
  ctx.fillStyle = rgba('#ffffff', 0.92)
  ctx.fill()
}

/** 唾液团（炮手）：圆头 + 拖在后面的尾巴 + 一滴甩出去的小水珠 */
function paintGlob(ctx: Ctx, color: string): void {
  const trace = (): void => {
    ctx.beginPath()
    ctx.moveTo(-11.5, 0)
    ctx.bezierCurveTo(-7, -1.2, -4.2, -6.9, 0.5, -6.9)
    ctx.bezierCurveTo(5, -6.9, 7.6, -3.6, 7.6, 0)
    ctx.bezierCurveTo(7.6, 3.6, 5, 6.9, 0.5, 6.9)
    ctx.bezierCurveTo(-4.2, 6.9, -7, 1.2, -11.5, 0)
    ctx.closePath()
  }
  // 水珠
  ctx.beginPath()
  ctx.arc(-14.8, 0.3, 1.7, 0, TAU)
  ctx.lineWidth = 2.2
  ctx.strokeStyle = ink(0.9)
  ctx.stroke()
  ctx.fillStyle = mixHex(color, '#080a12', 0.12)
  ctx.fill()
  body(ctx, trace)
  const g = ctx.createRadialGradient(2, -2.6, 0.5, 0, 0, 9)
  g.addColorStop(0, lighten(color, 0.62))
  g.addColorStop(0.45, color)
  g.addColorStop(1, mixHex(color, '#080a12', 0.5))
  ctx.fillStyle = g
  trace()
  ctx.fill()
  // 尾巴上的暗面（让它看起来是黏稠的一团，而不是一个带尖的圆）
  ctx.save()
  trace()
  ctx.clip()
  const tail = ctx.createLinearGradient(-11.5, 0, 0, 0)
  tail.addColorStop(0, rgba(mixHex(color, '#080a12', 0.5), 0.75))
  tail.addColorStop(1, rgba(mixHex(color, '#080a12', 0.5), 0))
  ctx.fillStyle = tail
  ctx.fillRect(-12, -8, 12, 16)
  ctx.restore()
  // 高光
  ctx.beginPath()
  ctx.ellipse(0.8, -3.2, 2.7, 1.5, -0.3, 0, TAU)
  ctx.fillStyle = rgba('#ffffff', 0.85)
  ctx.fill()
}

/** 飞镖（所有 Boss 的瞄准弹）：带倒刺的箭头 + 细杆 + 两片后掠的尾羽 */
function paintDart(ctx: Ctx, color: string): void {
  const head = (): void => {
    ctx.beginPath()
    ctx.moveTo(11.5, 0)
    ctx.lineTo(3.4, -4.2)
    ctx.lineTo(5.2, -0.1)
    ctx.lineTo(5.2, 0.1)
    ctx.lineTo(3.4, 4.2)
    ctx.closePath()
  }
  const vane = (s: number): void => {
    ctx.beginPath()
    ctx.moveTo(-5.8, 0)
    ctx.lineTo(-9.6, -4.8 * s)
    ctx.lineTo(-14.2, -4.8 * s)
    ctx.lineTo(-11.6, 0)
    ctx.closePath()
  }
  const dim = mixHex(color, '#0a0c14', 0.5)
  // 墨线打底：尾羽、杆、箭头
  for (const s of [1, -1]) body(ctx, () => vane(s))
  ctx.beginPath()
  ctx.moveTo(-13, 0)
  ctx.lineTo(4, 0)
  ctx.lineWidth = 4.2
  ctx.strokeStyle = ink(0.92)
  ctx.stroke()
  body(ctx, head)
  // 尾羽
  for (const s of [1, -1]) {
    vane(s)
    ctx.fillStyle = dim
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-7, -0.6 * s)
    ctx.lineTo(-11.6, -4.2 * s)
    ctx.lineWidth = 0.8
    ctx.strokeStyle = rgba(color, 0.9)
    ctx.stroke()
  }
  // 杆
  ctx.beginPath()
  ctx.moveTo(-12.4, 0)
  ctx.lineTo(4.4, 0)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#b4bed2'
  ctx.stroke()
  // 箭头：上半亮、下半暗两个斜面，中间一道棱
  ctx.save()
  head()
  ctx.clip()
  ctx.fillStyle = mixHex(color, '#080a12', 0.32)
  ctx.fillRect(0, 0, 14, 6)
  ctx.fillStyle = lighten(color, 0.3)
  ctx.fillRect(0, -6, 14, 6)
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(4.2, 0)
  ctx.lineTo(10.6, 0)
  ctx.lineWidth = 0.9
  ctx.strokeStyle = rgba('#ffffff', 0.9)
  ctx.stroke()
}

/** 晶片（分形核心）：拉长的刻面六棱晶，尖端朝前 */
function paintShard(ctx: Ctx, color: string): void {
  const pts: Pt[] = [
    [10.5, 0],
    [3, 5],
    [-5.5, 3.8],
    [-10.5, 0],
    [-5.5, -3.8],
    [3, -5],
  ]
  cut(ctx, pts, [0.8, 0], color)
}

/** 獠牙（虚空之喉）：弯钩的尖牙，牙尖朝前，根部圆钝而暗 */
function paintFang(ctx: Ctx, color: string): void {
  const trace = (): void => {
    ctx.beginPath()
    ctx.moveTo(11, 3.6)
    ctx.bezierCurveTo(6, -4.2, -2, -7.6, -8, -5.8)
    ctx.quadraticCurveTo(-12.4, 0, -8.4, 5.4)
    ctx.bezierCurveTo(-2, 4, 5, 3, 11, 3.6)
    ctx.closePath()
  }
  body(ctx, trace)
  const g = ctx.createLinearGradient(-10, 0, 11, 0)
  g.addColorStop(0, mixHex(color, '#080a12', 0.62))
  g.addColorStop(0.38, mixHex(color, '#080a12', 0.12))
  g.addColorStop(0.72, lighten(color, 0.42))
  g.addColorStop(1, lighten(color, 0.9))
  ctx.fillStyle = g
  trace()
  ctx.fill()
  // 牙面的高光：沿外弧的一道亮线
  ctx.beginPath()
  ctx.moveTo(9.4, 2.2)
  ctx.bezierCurveTo(5, -3, -1.5, -5.6, -5.6, -4.6)
  ctx.lineWidth = 1.1
  ctx.strokeStyle = rgba('#ffffff', 0.75)
  ctx.stroke()
  // 牙根：一圈深色的"牙龈线"
  ctx.beginPath()
  ctx.moveTo(-5.4, -5.1)
  ctx.quadraticCurveTo(-7.6, 0, -5.8, 4.7)
  ctx.lineWidth = 1.2
  ctx.strokeStyle = ink(0.6)
  ctx.stroke()
}

/**
 * 熔渣块（熔炉巨像）：一块有棱有角的暗色岩渣，裂缝里透出熔融的橙光，迎着前进方向的一侧被烤得发亮，
 * 身后甩着几点火星。裂缝是实色的粗线 + 白热的细芯——不靠光晕，轮廓一眼就是"一块烧红的石头"。
 */
function paintEmber(ctx: Ctx, color: string): void {
  const crust: Pt[] = [
    [8.8, -0.8],
    [5.6, -6.2],
    [-0.8, -7.8],
    [-6.8, -5],
    [-8.6, 1.6],
    [-4.6, 6.8],
    [2.8, 7],
  ]
  const trace = (): void => {
    ctx.beginPath()
    crust.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
  }
  // 火星：甩在身后的三点
  for (const [x, y, r] of [
    [-12.4, -3, 1.6],
    [-15.2, 1.8, 1.2],
    [-17.6, -1.2, 0.9],
  ] as const) {
    ctx.beginPath()
    ctx.arc(x, y, r + 0.9, 0, TAU)
    ctx.fillStyle = ink(0.85)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fillStyle = lighten(color, 0.35)
    ctx.fill()
  }
  body(ctx, trace)
  // 岩壳：背着热的一侧近乎黑褐，迎着热的一侧泛暖
  const g = ctx.createLinearGradient(-8.6, 0, 8.8, 0)
  g.addColorStop(0, mixHex(color, '#07090f', 0.9))
  g.addColorStop(0.55, mixHex(color, '#07090f', 0.78))
  g.addColorStop(1, mixHex(color, '#07090f', 0.5))
  ctx.fillStyle = g
  trace()
  ctx.fill()
  ctx.save()
  trace()
  ctx.clip()
  // 熔融的裂缝：橙色的粗底 + 白热的细芯
  const seams: Pt[][] = [
    [[8, -1.6], [3.4, -0.8], [0.6, 2.4], [-3.6, 1.8], [-8, 4]],
    [[3.4, -0.8], [2.2, -5.4], [-1.2, -7.4]],
    [[0.6, 2.4], [2.8, 6.4]],
  ]
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const [w, c] of [
    [2.5, color],
    [1, lighten(color, 0.78)],
  ] as const) {
    ctx.lineWidth = w
    ctx.strokeStyle = c
    for (const s of seams) {
      ctx.beginPath()
      s.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.stroke()
    }
  }
  ctx.restore()
  // 迎热面的边缘高光
  ctx.beginPath()
  ctx.moveTo(5.6, -6.2)
  ctx.lineTo(8.8, -0.8)
  ctx.lineTo(2.8, 7)
  ctx.lineWidth = 1.2
  ctx.strokeStyle = rgba(lighten(color, 0.7), 0.85)
  ctx.stroke()
}

/** 各类子弹的绘制函数（'orb' 仍是原来的实心球，由 sprites.ts 的 beadSprite 负责） */
export const EBULLET_PAINT: Partial<Record<EBulletKind, (ctx: Ctx, color: string) => void>> = {
  lens: paintLens,
  glob: paintGlob,
  needle: paintDart,
  shard: paintShard,
  fang: paintFang,
  ember: paintEmber,
}
