import type { EnemyDef } from '../data/enemies'
import type { BeamStyle, BossId, EBulletKind, PassiveId, WeaponId } from '../data/ids'
import type { WStats } from '../data/weapons'
import type { GridItem } from '../engine/grid'
import type { PickupKind } from './events'

/** 玩家的衍生数值：由飞船 + 机库升级 + 被动道具合成，升级时重算。 */
export interface PlayerStats {
  maxHp: number
  regen: number
  speed: number
  armor: number
  /** 拾取半径 */
  magnet: number
  dmg: number
  /** 冷却倍率（<1 更快） */
  cd: number
  area: number
  projSpeed: number
  duration: number
  xp: number
  crit: number
  critMul: number
  extraCount: number
  dashCd: number
  luck: number
  greed: number
  /** 受到伤害的最低保底比例 */
  minTaken: number
}

export interface InputState {
  /** 移动向量，模长 ≤ 1 */
  mx: number
  my: number
  /** 本帧请求冲刺 */
  dash: boolean
}

/** 武器随身的"小件"：光刃 / 无人机 / 飞轮 / 虹吸索。字段按武器各取所需。 */
export interface WeaponPt {
  x: number
  y: number
  a: number
  r: number
  cd: number
  /** 回旋飞轮：飞行方向（单位向量）、已飞距离（回程时为回程用时）、阶段（0 去程 / 1 回程） */
  vx: number
  vy: number
  d: number
  ph: number
  /** 回旋飞轮：本阶段（去程 / 回程）已经砍过的敌人 id，每个阶段每个敌人只砍一次 */
  hit: number[]
  /** 虹吸索：这根索扣住的目标；对象会被池复用，所以同时记录 id */
  tgt: Target | null
  tgtId: number
}

/** 新建一个小件（字段全部归零） */
export function newPt(): WeaponPt {
  return { x: 0, y: 0, a: 0, r: 0, cd: 0, vx: 0, vy: 0, d: 0, ph: 0, hit: [], tgt: null, tgtId: -1 }
}

export class WeaponInst {
  evolved = false
  level = 1
  timer = 0
  /** 连发/二段计数等 */
  pending = 0
  angle = 0
  /** 绘制用：当前位置列表（光刃/无人机/飞轮） */
  pts: WeaponPt[] = []
  s!: WStats

  constructor(
    readonly id: WeaponId,
    readonly slot: number,
  ) {}
}

export class Player {
  x = 0
  y = 0
  vx = 0
  vy = 0
  /** 受击判定半径（比视觉小，手感更宽容） */
  r = 8
  face = -Math.PI / 2
  hp = 100
  maxHp = 100
  invuln = 0
  dashT = 0
  dashCd = 0
  dashDx = 0
  dashDy = -1
  level = 1
  xp = 0
  xpNext = 8
  hurtFlash = 0
  noHit = 0
  /** 最近一次受击的方向（屏幕边缘红光用） */
  hitAng = 0
  st!: PlayerStats
  weapons: WeaponInst[] = []
  passives: Partial<Record<PassiveId, number>> = {}
}

export class Enemy implements GridItem {
  id = 0
  def!: EnemyDef
  alive = false
  x = 0
  y = 0
  r = 10
  qs = 0
  vx = 0
  vy = 0
  /** 击退速度，独立衰减 */
  kx = 0
  ky = 0
  hp = 1
  maxHp = 1
  speed = 0
  dmg = 0
  xp = 0
  flash = 0
  elite = false
  age = 0
  /** 出生渐显剩余时间：期间不可被打、不造成伤害 */
  spawnT = 0
  contactCd = 0
  angle = 0
  /** 渲染用的朝向：向 angle 平滑转过去（只给画面看，模拟不读它） */
  ra = 0
  // AI 通用状态
  state = 0
  timer = 0
  ax = 0
  ay = 0
  aux = 0
  slow = 0
  stun = 0
  shielded = 0
  /** 护盾者的光环半径（仅 shielder 使用） */
  readonly isBoss = false
  /** 每个武器槽位下次可受击的时间（持续伤害类武器的单体冷却） */
  hitAt = new Float64Array(8)
  lastRing = 0
}

export class Projectile {
  alive = false
  x = 0
  y = 0
  px = 0
  py = 0
  vx = 0
  vy = 0
  r = 4
  damage = 0
  pierce = 0
  life = 0
  knock = 0
  homing = 0
  blast = 0
  cluster = 0
  stun = 0
  /** 视觉风格 */
  kind: 'bolt' | 'plasma' | 'missile' | 'drone' | 'shard' = 'bolt'
  color = '#fff'
  weapon: WeaponId = 'pulse'
  slot = 0
  /** 追踪目标；对象会被池复用，所以同时记录 id 防止认错 */
  target: Target | null = null
  targetId = -1
  retarget = 0
  hit: number[] = []
}

export class EnemyBullet {
  alive = false
  x = 0
  y = 0
  vx = 0
  vy = 0
  r = 6
  dmg = 8
  life = 0
  color = '#ff3ea5'
  /** 轻微加速（弹幕用） */
  accel = 0
  kind: EBulletKind = 'orb'
}

export class Gem {
  alive = false
  x = 0
  y = 0
  vx = 0
  vy = 0
  value = 1
  /** 0 小 1 中 2 大 3 巨 */
  tier = 0
  mag = false
  /** 被吸附后经过的时间：吸力随它增长，保证怎么跑都能被追上 */
  magT = 0
  age = 0
}

export class Pickup {
  alive = false
  kind: PickupKind = 'heal'
  x = 0
  y = 0
  vx = 0
  vy = 0
  age = 0
  value = 0
  mag = false
  /** 被吸附后经过的时间 */
  magT = 0
}

// ---- 世界内的持续性效果 ----

export class Beam {
  alive = false
  ang = 0
  /** 绕自身旋转的角速度（日冕光矛） */
  spin = 0
  len = 700
  width = 12
  life = 0
  maxLife = 0.5
  tick = 0.08
  tickT = 0
  dmg = 10
  color = '#c9a0ff'
  slot = 0
  /** true=敌方光束（伤害玩家） */
  hostile = false
  /** 敌方光束的预警时间，预警期间不造成伤害 */
  warn = 0
  ox = 0
  oy = 0
  /** true=固定在原点；false=跟随玩家 */
  fixed = false
  /** true=瞬发"重炮"：起手最亮、随即快速衰减（磁轨炮） */
  punch = false
  /** 画法：棱镜激光 / 磁轨 / 灼痕 / Boss 光束（只影响外观） */
  style: BeamStyle = 'laser'
}

export class Ring {
  alive = false
  x = 0
  y = 0
  r = 0
  maxR = 160
  speed = 400
  dmg = 10
  knock = 100
  slow = 0
  serial = 0
  color = '#e8fbff'
  hostile = false
  delay = 0
  hitPlayer = false
}

export class Mine {
  alive = false
  x = 0
  y = 0
  arm = 0.4
  life = 9
  trigger = 36
  dmg = 30
  blast = 70
  /** 进化：引爆前先拉拽周围敌人 */
  pull = 0
  pulling = 0
  age = 0
}

/**
 * 榴弹炮的炮弹：抛物线飞行，落地爆炸。
 * 落点跟着目标走（飞行途中敌人在移动）；目标死了就停在最后的位置。
 */
export class Shell {
  alive = false
  /** 发射点 */
  x0 = 0
  y0 = 0
  /** 当前落点（世界坐标） */
  x = 0
  y = 0
  /** 已飞行时间 / 总飞行时间 */
  t = 0
  T = 1
  dmg = 0
  blast = 0
  knock = 0
  /** 进化后：落地时撒出的子弹药数量 */
  cluster = 0
  color = '#b8f03a'
  evolved = false
  /** 落点跟随的目标，以及相对它中心的偏移（同一目标上的多发炮弹要错开） */
  target: Target | null = null
  targetId = -1
  ox = 0
  oy = 0
}

export class Blast {
  alive = false
  x = 0
  y = 0
  r = 60
  life = 0.3
  maxLife = 0.3
  color = '#ff9b3d'
}

export class Bolt {
  alive = false
  /** x0,y0,x1,y1,... */
  pts: number[] = []
  life = 0
  maxLife = 0.2
  color = '#ffe66b'
}

/** 预警标记：延迟后触发（地面圈/直线预警） */
export class Telegraph {
  alive = false
  kind: 'circle' | 'line' = 'circle'
  x = 0
  y = 0
  x2 = 0
  y2 = 0
  r = 60
  t = 1
  maxT = 1
  color = '#ff3ea5'
  /** 触发动作标识，见 bosses.ts */
  action = ''
  a = 0
  b = 0
}

export class Boss {
  readonly isBoss = true
  alive = false
  id!: BossId
  x = 0
  y = 0
  r = 60
  qs = 0
  vx = 0
  vy = 0
  hp = 1
  maxHp = 1
  dmg = 20
  flash = 0
  age = 0
  phase = 0
  /** 技能计时器们 */
  t1 = 0
  t2 = 0
  t3 = 0
  ang = 0
  spin = 0
  state = 0
  stateT = 0
  tx = 0
  ty = 0
  /** 出场无敌/演出时间 */
  intro = 0
  contactCd = 0
  /** 环绕的护盾球（概览绘制/碰撞） */
  orbs: { a: number; x: number; y: number; r: number; hp: number }[] = []
  /** 每个武器槽位下次可受击的时间 */
  hitAt = new Float64Array(8)
  lastRing = 0
  slow = 0
  stun = 0
  shielded = 0
  /** 分形核心的分身镜像 */
  clones: { x: number; y: number; a: number }[] = []
}

export type Target = Enemy | Boss
