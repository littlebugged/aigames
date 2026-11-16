import { EnemyId } from './ids'

/** 敌人外形（生物设计），对应 render/creatures.ts 里的绘制函数。 */
export type EnemyShape =
  | 'wasp'
  | 'mite'
  | 'beetle'
  | 'spitter'
  | 'twin'
  | 'ram'
  | 'mine'
  | 'aegis'
  | 'wraith'
  | 'crystal'

/** 行为模板，对应 game/enemies.ts 里的 AI 实现。 */
export type EnemyAI =
  | 'chase'
  | 'swarm'
  | 'brute'
  | 'shooter'
  | 'splitter'
  | 'charger'
  | 'bomber'
  | 'shielder'
  | 'wraith'

/**
 * 兵种层级（v1.14 割草·波次）：
 *  · fodder 杂兵——成百上千地涌来，一两下就倒，是割草的对象；整局血量几乎不涨，难度靠数量；
 *  · special 特殊兵种——有明确的战术职责（狙击 / 冲锋 / 护盾 / 自爆 / 瞬移 / 分裂 / 重甲），血量厚、整局持续成长，
 *    不会被顺手一扫带走：得先停下来处理它们，才有余裕继续割草。
 */
export type EnemyTier = 'fodder' | 'special'

export interface EnemyDef {
  id: EnemyId
  ai: EnemyAI
  tier: EnemyTier
  shape: EnemyShape
  color: string
  hp: number
  speed: number
  radius: number
  /** 接触伤害 */
  dmg: number
  /** 掉落经验 */
  xp: number
  /** 击退抗性 0~1，1 为免疫 */
  knockResist: number
  /** 生成预算点数：越强越贵，导演器按预算放怪 */
  cost: number
  /**
   * 吃多少"血量随时间成长"（乘在 TUNE.hpGrow 上）：杂兵小于 1——整局都是一两下就倒的割草对象；
   * 重甲大于 1——后期仍然有分量。
   */
  grow: number
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  drone: {
    id: 'drone',
    ai: 'chase',
    tier: 'fodder',
    shape: 'wasp',
    color: '#ff4d8d',
    hp: 12,
    speed: 72,
    radius: 10,
    dmg: 8,
    xp: 1,
    knockResist: 0,
    cost: 1,
    grow: 0,
  },
  swarmer: {
    id: 'swarmer',
    ai: 'swarm',
    tier: 'fodder',
    shape: 'mite',
    color: '#ff8a3d',
    hp: 6,
    speed: 128,
    radius: 7,
    dmg: 5,
    xp: 1,
    knockResist: 0,
    cost: 0.7,
    grow: 0,
  },
  brute: {
    id: 'brute',
    ai: 'brute',
    tier: 'special',
    shape: 'beetle',
    color: '#ff3b3b',
    hp: 520,
    speed: 46,
    radius: 21,
    dmg: 16,
    xp: 9,
    knockResist: 0.7,
    cost: 5,
    grow: 1.1,
  },
  shooter: {
    id: 'shooter',
    ai: 'shooter',
    tier: 'special',
    shape: 'spitter',
    color: '#ffd84a',
    hp: 150,
    speed: 62,
    radius: 11,
    dmg: 6,
    xp: 4,
    knockResist: 0.2,
    cost: 3,
    grow: 0.9,
  },
  splitter: {
    id: 'splitter',
    ai: 'splitter',
    tier: 'special',
    shape: 'twin',
    color: '#9dff4d',
    hp: 190,
    speed: 64,
    radius: 14,
    dmg: 9,
    xp: 4,
    knockResist: 0.3,
    cost: 3,
    grow: 0.9,
  },
  charger: {
    id: 'charger',
    ai: 'charger',
    tier: 'special',
    shape: 'ram',
    color: '#ff6a2e',
    hp: 210,
    speed: 76,
    radius: 12,
    dmg: 12,
    xp: 5,
    knockResist: 0.4,
    cost: 3.5,
    grow: 0.9,
  },
  bomber: {
    id: 'bomber',
    ai: 'bomber',
    tier: 'special',
    shape: 'mine',
    color: '#ff2fd6',
    hp: 110,
    speed: 92,
    radius: 12,
    dmg: 6,
    xp: 4,
    knockResist: 0.1,
    cost: 3,
    grow: 0.8,
  },
  shielder: {
    id: 'shielder',
    ai: 'shielder',
    tier: 'special',
    shape: 'aegis',
    color: '#b36bff',
    hp: 380,
    speed: 50,
    radius: 16,
    dmg: 10,
    xp: 8,
    knockResist: 0.5,
    cost: 5,
    grow: 1.1,
  },
  wraith: {
    id: 'wraith',
    ai: 'wraith',
    tier: 'special',
    shape: 'wraith',
    color: '#d9a6ff',
    hp: 170,
    speed: 98,
    radius: 11,
    dmg: 9,
    xp: 5,
    knockResist: 0.1,
    cost: 3.5,
    grow: 0.9,
  },
  shard: {
    id: 'shard',
    ai: 'swarm',
    tier: 'fodder',
    shape: 'crystal',
    color: '#c8ff66',
    hp: 8,
    speed: 118,
    radius: 6,
    dmg: 4,
    xp: 0,
    knockResist: 0,
    cost: 0.5,
    grow: 0,
  },
}
