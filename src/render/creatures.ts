import type { EnemyShape } from '../data/enemies'
import { TAU } from '../engine/math'
import { groove, hull, ink, lamp, plate, rivet, type Tones } from './matte'
import { rgba } from './palette'
import { at, bone, dark, flipY, limb, line, metal, mirror, oval, poly, socket, soft, solid, type Ctx, type Pt } from './parts'

/**
 * 敌人的"生物设计"（v1.5）。
 *
 * v1.4 的敌人是三角形 / 圆 / 方 / 六边形外加几块装甲板，缩到游戏里的尺寸后根本分不出谁是谁。
 * 这一版改成"轮廓优先"：每种敌人是由若干部件拼成的、带突出物的非凸外形，
 * 只看剪影就能认出来——
 *   工蜂（后掠翅 + 尾刺）、螨（八字腿）、甲虫（巨钳 + 侧刺）、炮蛛（长炮管）、
 *   三叶荚（三瓣）、冲角兽（三叉角）、孢子雷（刺球）、盾卫（弧形盾 + 核心）、
 *   幽灵（破碎披风）、晶簇（放射晶体）。
 *
 * 配色规则：躯干用敌人的主色；附肢（翅 / 腿 / 角）用同色相的"骨白"，钳 / 炮管 / 喷口用冷灰金属。
 * 深色背景上，轮廓靠的是明度，所以附肢必须比躯干更亮，而不是更暗。
 *
 * 全部是启动时画一次的预渲染精灵，运行时仍然只有一次 drawImage，不增加任何帧开销。
 * 坐标约定：朝 +x，单位是"美术半径 R"（比碰撞半径略大一点，细长部件才看得清）。
 */

export interface Creature {
  /** 美术半径 / 碰撞半径 */
  scale: number
  /** 轮廓离中心最远是美术半径的多少倍（决定画布大小） */
  reach: number
  /** true = 朝运动方向；false = 缓慢自转（对称外形） */
  faces: boolean
  paint: (ctx: Ctx, R: number, t: Tones) => void
}

// ───────────────────────── 十种生物 ─────────────────────────

/** 工蜂（drone）：后掠的锯齿翅 + 分节腹部 + 尾刺 + 大颚，追着你飞 */
function wasp(ctx: Ctx, R: number, t: Tones): void {
  const wing = bone(t)
  const mt = metal(t)
  for (const s of [1, -1]) {
    const pts = flipY(
      [
        [0.32, 0.14],
        [0.06, 0.42],
        [-0.5, 0.84],
        [-1.04, 1.1],
        [-0.8, 0.64],
        [-1.0, 0.52],
        [-0.72, 0.36],
        [-0.5, 0.2],
      ],
      s,
    )
    solid(ctx, R, pts, wing, { rim: 0.6, line: 1.1 })
    groove(ctx, line(ctx, R, 0.14, 0.2 * s, -0.9, 1.0 * s), 0.7)
    groove(ctx, line(ctx, R, -0.2, 0.46 * s, -0.62, 0.46 * s), 0.6)
  }
  // 腹部 + 尾刺
  solid(
    ctx,
    R,
    mirror([
      [0.16, 0],
      [0.02, 0.3],
      [-0.45, 0.3],
      [-0.9, 0.13],
      [-1.34, 0],
    ]),
    t,
    { rim: 0.8, line: 1.2 },
  )
  groove(ctx, line(ctx, R, -0.28, -0.27, -0.28, 0.27), 0.9)
  groove(ctx, line(ctx, R, -0.6, -0.19, -0.6, 0.19), 0.8)
  // 大颚
  for (const s of [1, -1]) {
    solid(
      ctx,
      R,
      [
        [0.88, 0.1 * s],
        [1.24, 0.34 * s],
        [1.02, 0.08 * s],
      ],
      mt,
      { rim: 0.4, line: 0.9 },
    )
  }
  // 胸 + 头
  oval(ctx, 0.32 * R, 0, 0.4 * R, 0.31 * R, t)
  const [pa, pb] = dark(t)
  at(ctx, 0.3 * R, 0, 0, () => {
    plate(ctx, () => poly(ctx, R, [[0.22, 0], [0, 0.17], [-0.2, 0.1], [-0.2, -0.1], [0, -0.17]]), R, pa, pb, {
      raised: false,
      line: 0.8,
    })
  })
  oval(ctx, 0.74 * R, 0, 0.25 * R, 0.23 * R, t)
  for (const s of [1, -1]) lamp(ctx, 0.8 * R, 0.1 * R * s, 0.085 * R, t.glow, 1)
}

/** 螨（swarmer）：圆滚滚的小身子 + 六条细腿，成群爬过来 */
function mite(ctx: Ctx, R: number, t: Tones): void {
  const lt = bone(t)
  const legs: Pt[][] = [
    [[0.3, 0.2], [0.8, 0.58], [1.04, 0.36]],
    [[0.0, 0.32], [0.14, 0.92], [-0.12, 1.1]],
    [[-0.32, 0.26], [-0.82, 0.7], [-1.06, 0.5]],
  ]
  for (const s of [1, -1]) for (const l of legs) limb(ctx, R, flipY(l, s), R * 0.17, lt)
  oval(ctx, -0.12 * R, 0, 0.64 * R, 0.52 * R, t)
  // 背上的沙漏斑
  at(ctx, -0.16 * R, 0, 0, () => {
    poly(ctx, R, [[0.2, 0], [0, 0.14], [-0.2, 0], [0, -0.14]])
    ctx.fillStyle = rgba(t.glow, 0.85)
    ctx.fill()
  })
  oval(ctx, 0.56 * R, 0, 0.31 * R, 0.28 * R, t)
  for (const s of [1, -1]) lamp(ctx, 0.66 * R, 0.1 * R * s, 0.1 * R, t.glow, 0.9)
}

/** 甲虫（brute）：宽大的鞘翅 + 一对巨钳 + 侧刺 + 背上的反应堆，慢但是硬 */
function beetle(ctx: Ctx, R: number, t: Tones): void {
  const mt = metal(t)
  const bn = bone(t)
  const [pa, pb] = dark(t)
  // 侧刺（画在壳下面）
  for (const s of [1, -1]) {
    for (const [xb, yb] of [[0.5, 0.6], [0.1, 0.72], [-0.32, 0.68]]) {
      solid(
        ctx,
        R,
        [
          [xb + 0.18, yb * s],
          [xb - 0.1, (yb + 0.42) * s],
          [xb - 0.24, (yb - 0.02) * s],
        ],
        bn,
        { rim: 0.6, line: 1.2 },
      )
    }
  }
  // 巨钳
  for (const s of [1, -1]) {
    solid(
      ctx,
      R,
      flipY(
        [
          [0.5, 0.32],
          [0.74, 0.68],
          [1.12, 0.8],
          [1.42, 0.52],
          [1.34, 0.32],
          [1.1, 0.5],
          [0.92, 0.46],
          [0.7, 0.26],
        ],
        s,
      ),
      mt,
      { rim: 0.8, line: 1.5 },
    )
    groove(ctx, line(ctx, R, 0.7, 0.42 * s, 1.14, 0.62 * s), 1)
  }
  // 壳
  soft(
    ctx,
    R,
    mirror([
      [0.98, 0],
      [0.88, 0.34],
      [0.5, 0.68],
      [-0.05, 0.8],
      [-0.6, 0.66],
      [-0.92, 0.3],
      [-1.02, 0],
    ]),
    t,
    { rim: 1, line: 1.8 },
  )
  // 鞘翅分缝 + 两片翅鞘
  for (const s of [1, -1]) {
    plate(ctx, () => poly(ctx, R, flipY([[0.3, 0.08], [0.14, 0.5], [-0.5, 0.58], [-0.84, 0.26], [-0.88, 0.08]], s)), R, pa, pb, {
      raised: false,
      line: 1,
    })
  }
  groove(ctx, line(ctx, R, 0.36, 0, -0.98, 0), 1.2)
  // 头甲
  plate(ctx, () => poly(ctx, R, [[1.0, 0], [0.76, 0.3], [0.54, 0.2], [0.54, -0.2], [0.76, -0.3]]), R, mt.hi, mt.lo, {
    raised: true,
    line: 1,
  })
  for (const s of [1, -1]) lamp(ctx, 0.74 * R, 0.13 * R * s, 0.065 * R, t.glow, 1)
  // 背上的反应堆
  socket(ctx, -0.1 * R, 0, 0.3 * R, t, 1.15)
  for (const [x, y] of [[0.6, 0.5], [-0.2, 0.7], [-0.7, 0.5], [0.6, -0.5], [-0.2, -0.7], [-0.7, -0.5]]) rivet(ctx, x * R, y * R, 0.04 * R)
}

/** 炮蛛（shooter）：一根又长又粗的炮管，后面是球形身体和两片稳定翼 */
function spitter(ctx: Ctx, R: number, t: Tones): void {
  const mt = metal(t)
  const bn = bone(t)
  const [pa, pb] = dark(t)
  // 炮管 + 炮口制退器
  solid(ctx, R, [[0.3, 0.16], [1.46, 0.16], [1.46, -0.16], [0.3, -0.16]], mt, { rim: 0.9, line: 1.3 })
  groove(ctx, line(ctx, R, 0.6, -0.16, 0.6, 0.16), 0.9)
  solid(ctx, R, [[1.3, 0.27], [1.62, 0.27], [1.62, -0.27], [1.3, -0.27]], mt, { rim: 0.9, line: 1.3 })
  for (const x of [1.4, 1.5]) groove(ctx, line(ctx, R, x, -0.26, x, 0.26), 0.9)
  // 稳定翼
  for (const s of [1, -1]) {
    solid(ctx, R, flipY([[0.06, 0.5], [-0.5, 1.02], [-0.92, 0.94], [-0.64, 0.42]], s), bn, { rim: 0.6, line: 1.2 })
    lamp(ctx, -0.86 * R, 0.95 * R * s, 0.06 * R, t.glow, 0.9)
  }
  // 尾喷口
  solid(ctx, R, [[-0.7, 0.22], [-1.0, 0.28], [-1.0, -0.28], [-0.7, -0.22]], mt, { rim: 0.6, line: 1.1 })
  lamp(ctx, -0.98 * R, 0, 0.07 * R, t.glow, 0.9)
  // 身体
  soft(
    ctx,
    R,
    mirror([
      [0.64, 0],
      [0.5, 0.44],
      [0.0, 0.7],
      [-0.55, 0.54],
      [-0.8, 0],
    ]),
    t,
    { rim: 1, line: 1.6 },
  )
  plate(
    ctx,
    () => {
      ctx.beginPath()
      ctx.ellipse(-0.18 * R, 0, 0.42 * R, 0.4 * R, 0, 0, TAU)
    },
    R,
    pa,
    pb,
    { raised: true, line: 0.9 },
  )
  socket(ctx, 0.2 * R, 0, 0.32 * R, t, 1.1)
}

/** 三叶荚（splitter）：三瓣合拢的种荚，每一瓣里都封着一块晶体——死后会裂成三块碎晶 */
function twin(ctx: Ctx, R: number, t: Tones): void {
  const mt = metal(t)
  const [pa, pb] = dark(t)
  const rad = 0.56 * R
  const d = 0.5 * R
  const lobes = [-Math.PI / 2, -Math.PI / 2 + TAU / 3, -Math.PI / 2 + (TAU * 2) / 3]
  hull(
    ctx,
    () => {
      ctx.beginPath()
      for (const a of lobes) {
        const cx = Math.cos(a) * d
        const cy = Math.sin(a) * d
        ctx.moveTo(cx + rad, cy)
        ctx.arc(cx, cy, rad, 0, TAU)
      }
    },
    R,
    t,
    { radial: true, line: 1.6 },
  )
  // 瓣与瓣之间的合缝 + 卡扣
  for (let i = 0; i < 3; i++) {
    const a = lobes[i] + TAU / 6
    groove(ctx, line(ctx, R, Math.cos(a) * 0.18, Math.sin(a) * 0.18, Math.cos(a) * 0.8, Math.sin(a) * 0.8), 1.1)
    at(ctx, Math.cos(a) * 0.62 * R, Math.sin(a) * 0.62 * R, a, () => {
      plate(ctx, () => poly(ctx, R, [[0.08, 0.1], [-0.1, 0.1], [-0.1, -0.1], [0.08, -0.1]]), R, mt.hi, mt.lo, { raised: true, line: 0.8 })
    })
  }
  // 每瓣里的晶体
  for (const a of lobes) {
    at(ctx, Math.cos(a) * d, Math.sin(a) * d, a, () => {
      plate(ctx, () => poly(ctx, R, [[0.4, 0], [0, 0.22], [-0.3, 0], [0, -0.22]]), R, pa, pb, { raised: false, line: 0.9 })
      poly(ctx, R, [[0.3, 0], [0.02, 0.14], [-0.2, 0], [0.02, -0.14]])
      ctx.fillStyle = rgba(t.glow, 0.95)
      ctx.fill()
    })
  }
  // 中心
  at(ctx, 0, 0, 0, () => {
    ctx.beginPath()
    ctx.arc(0, 0, 0.2 * R, 0, TAU)
    ctx.fillStyle = ink(0.85)
    ctx.fill()
    lamp(ctx, 0, 0, 0.12 * R, t.glow, 1)
  })
}

/** 冲角兽（charger）：中间一根长矛 + 两侧象牙色弯角，像一头低头的公牛；后面两个助推器 */
function ram(ctx: Ctx, R: number, t: Tones): void {
  const mt = metal(t)
  const bn = bone(t)
  const [pa, pb] = dark(t)
  // 助推器
  for (const s of [1, -1]) {
    solid(ctx, R, [[-0.6, 0.38 * s], [-1.0, 0.34 * s], [-1.0, 0.16 * s], [-0.6, 0.16 * s]], mt, { rim: 0.5, line: 1.1 })
    lamp(ctx, -1.0 * R, 0.25 * R * s, 0.075 * R, t.glow, 0.9)
  }
  // 后掠翼
  for (const s of [1, -1]) {
    solid(ctx, R, flipY([[0.1, 0.42], [-0.62, 1.04], [-0.98, 0.88], [-0.76, 0.4]], s), t, { rim: 0.6, line: 1.2 })
    groove(ctx, line(ctx, R, -0.05, 0.5 * s, -0.7, 0.88 * s), 0.8)
  }
  // 弯角
  for (const s of [1, -1]) {
    solid(
      ctx,
      R,
      flipY(
        [
          [0.04, 0.34],
          [0.42, 0.76],
          [0.92, 0.86],
          [1.22, 0.62],
          [0.76, 0.58],
          [0.4, 0.42],
        ],
        s,
      ),
      bn,
      { rim: 0.8, line: 1.4 },
    )
  }
  // 矛身
  solid(
    ctx,
    R,
    mirror([
      [1.56, 0],
      [0.6, 0.3],
      [-0.3, 0.44],
      [-0.92, 0.3],
      [-1.0, 0],
    ]),
    t,
    { rim: 1, line: 1.5 },
  )
  plate(ctx, () => poly(ctx, R, [[1.1, 0], [0.4, 0.17], [-0.3, 0.26], [-0.5, 0], [-0.3, -0.26], [0.4, -0.17]]), R, pa, pb, { raised: true, line: 0.9 })
  groove(ctx, line(ctx, R, 0.9, 0, -0.5, 0), 0.9)
  for (const x of [0.2, -0.15]) groove(ctx, line(ctx, R, x, -0.3, x - 0.2, 0), 0.8)
  lamp(ctx, 0.46 * R, 0, 0.1 * R, t.glow, 1.1)
}

/** 孢子雷（bomber）：金属尖刺 + 一颗跳动的核，贴近就会爆 */
function mine(ctx: Ctx, R: number, t: Tones): void {
  const mt = metal(t)
  const N = 12
  const pts: Pt[] = []
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU
    const tip = i % 2 === 0 ? 1.3 : 1.08
    const w = (TAU / N) * 0.26
    pts.push([Math.cos(a - w) * 0.7, Math.sin(a - w) * 0.7], [Math.cos(a) * tip, Math.sin(a) * tip], [Math.cos(a + w) * 0.7, Math.sin(a + w) * 0.7])
  }
  // 尖刺（金属）
  hull(ctx, () => poly(ctx, R, pts), R, mt, { radial: true, line: 1.5, facets: 12, facetK: 0.8 })
  // 球体（主色）
  hull(
    ctx,
    () => {
      ctx.beginPath()
      ctx.arc(0, 0, 0.78 * R, 0, TAU)
    },
    0.78 * R,
    t,
    { radial: true, line: 1.5 },
  )
  groove(
    ctx,
    () => {
      ctx.beginPath()
      ctx.arc(0, 0, 0.62 * R, 0, TAU)
    },
    1.1,
  )
  socket(ctx, 0, 0, 0.46 * R, t, 1.3)
  for (let i = 0; i < N; i += 2) {
    const b = (i / N) * TAU + TAU / N
    rivet(ctx, Math.cos(b) * 0.7 * R, Math.sin(b) * 0.7 * R, 0.04 * R)
  }
}

/** 盾卫（shielder）：核心前面举着一块弧形盾，会给周围的敌人加护盾 */
function aegis(ctx: Ctx, R: number, t: Tones): void {
  const mt = metal(t)
  const a = (68 * Math.PI) / 180
  // 后翼
  for (const s of [1, -1]) {
    solid(ctx, R, flipY([[-0.4, 0.38], [-0.98, 0.72], [-0.82, 0.3]], s), mt, { rim: 0.5, line: 1.2 })
  }
  // 连杆
  for (const s of [1, -1]) limb(ctx, R, [[0.3, 0.2 * s], [0.78, 0.46 * s]], R * 0.12, mt)
  // 核心：切角八边形
  const core: Pt[] = []
  for (let i = 0; i < 8; i++) core.push([Math.cos((i / 8) * TAU + TAU / 16) * 0.62 - 0.1, Math.sin((i / 8) * TAU + TAU / 16) * 0.62])
  hull(ctx, () => poly(ctx, R, core), R * 0.62, t, { radial: true, line: 1.5, facets: 8, phase: TAU / 16, facetK: 0.8, cx: -0.1 * R })
  socket(ctx, -0.1 * R, 0, 0.38 * R, t, 1.1)
  // 弧形盾
  hull(
    ctx,
    () => {
      ctx.beginPath()
      ctx.arc(0, 0, 1.08 * R, -a, a)
      ctx.arc(0, 0, 0.82 * R, a, -a, true)
      ctx.closePath()
    },
    R * 0.5,
    mt,
    { rim: 0.9, line: 1.6, cx: 0.95 * R },
  )
  for (const k of [-0.5, 0, 0.5]) {
    groove(ctx, line(ctx, R, Math.cos(a * k) * 0.84, Math.sin(a * k) * 0.84, Math.cos(a * k) * 1.05, Math.sin(a * k) * 1.05), 1)
  }
  // 盾内侧的能量刃
  ctx.beginPath()
  ctx.arc(0, 0, 0.8 * R, -a * 0.94, a * 0.94)
  ctx.lineWidth = 1.6
  ctx.strokeStyle = rgba(t.glow, 0.95)
  ctx.stroke()
  for (const s of [1, -1]) lamp(ctx, Math.cos(a) * 0.95 * R, Math.sin(a) * 0.95 * R * s, 0.06 * R, t.glow, 1)
}

/** 幽灵（wraith）：破碎的披风式翅膀，两只发光的眼；会瞬移 */
function wraith(ctx: Ctx, R: number, t: Tones): void {
  const cape = bone(t)
  solid(
    ctx,
    R,
    mirror([
      [0.98, 0],
      [0.34, 0.3],
      [-0.16, 0.92],
      [-0.62, 1.12],
      [-0.42, 0.68],
      [-0.84, 0.82],
      [-0.6, 0.44],
      [-1.02, 0.5],
      [-0.62, 0.18],
      [-1.08, 0],
    ]),
    cape,
    { rim: 0.8, line: 1.3 },
  )
  groove(ctx, line(ctx, R, 0.2, 0.2, -0.6, 0.98), 0.7)
  groove(ctx, line(ctx, R, 0.2, -0.2, -0.6, -0.98), 0.7)
  // 身体：窄长的泪滴
  soft(
    ctx,
    R,
    mirror([
      [0.86, 0],
      [0.4, 0.2],
      [-0.3, 0.2],
      [-0.74, 0.07],
      [-0.92, 0],
    ]),
    t,
    { rim: 1, line: 1.2 },
  )
  oval(ctx, 0.56 * R, 0, 0.24 * R, 0.22 * R, t)
  for (const s of [1, -1]) lamp(ctx, 0.6 * R, 0.09 * R * s, 0.075 * R, '#ffffff', 1)
}

/** 晶簇（shard，splitter 的碎片）：几根六棱晶柱从同一点迸射出去，刻面一半亮一半暗 */
function crystal(ctx: Ctx, R: number, t: Tones): void {
  const spike = (len: number, w: number, ang: number, ox: number): void => {
    at(ctx, ox * R, 0, ang, () => {
      // 两头收尖的长六边形晶体
      const half: Pt[] = [[len, 0], [len * 0.46, w], [-len * 0.32, w], [-len * 0.78, 0]]
      const pts = mirror(half)
      solid(ctx, R, pts, t, { rim: 0.5, line: 1.15, facets: 0 })
      // 刻面：上半亮、下半暗，再加一条斜的高光面
      ctx.save()
      poly(ctx, R, pts)
      ctx.clip()
      poly(ctx, R, half)
      ctx.fillStyle = rgba('#ffffff', 0.38)
      ctx.fill()
      poly(ctx, R, flipY(half, -1))
      ctx.fillStyle = rgba('#000000', 0.34)
      ctx.fill()
      poly(ctx, R, [[len, 0], [len * 0.46, w], [len * 0.46 - w * 0.9, w], [len * 0.6, 0]])
      ctx.fillStyle = rgba('#ffffff', 0.28)
      ctx.fill()
      ctx.restore()
      groove(ctx, line(ctx, R, len * 0.46, w, len * 0.46, -w), 0.6)
    })
  }
  const d = Math.PI / 180
  spike(0.7, 0.2, 148 * d, 0.1)
  spike(0.7, 0.2, -148 * d, 0.1)
  spike(1.08, 0.27, 56 * d, 0.1)
  spike(1.08, 0.27, -56 * d, 0.1)
  spike(1.34, 0.33, 0, 0)
}

export const CREATURES: Record<EnemyShape, Creature> = {
  wasp: { scale: 1.2, reach: 1.34, faces: true, paint: wasp },
  mite: { scale: 1.3, reach: 1.14, faces: true, paint: mite },
  beetle: { scale: 1.15, reach: 1.45, faces: true, paint: beetle },
  spitter: { scale: 1.2, reach: 1.66, faces: true, paint: spitter },
  twin: { scale: 1.18, reach: 1.1, faces: false, paint: twin },
  ram: { scale: 1.2, reach: 1.6, faces: true, paint: ram },
  mine: { scale: 1.2, reach: 1.34, faces: false, paint: mine },
  aegis: { scale: 1.15, reach: 1.12, faces: true, paint: aegis },
  wraith: { scale: 1.25, reach: 1.14, faces: true, paint: wraith },
  crystal: { scale: 1.5, reach: 1.4, faces: true, paint: crystal },
}
