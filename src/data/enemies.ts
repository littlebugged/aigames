import { EnemyId } from './ids'

/** 敌人外形，对应 render/shapes.ts 里的绘制函数。 */
export type EnemyShape =
  | 'tri'
  | 'diamond'
  | 'hex'
  | 'ring'
  | 'square'
  | 'chevron'
  | 'orb'
  | 'oct'
  | 'crescent'
  | 'shard'

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

export interface EnemyDef {
  id: EnemyId
  ai: EnemyAI
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
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  drone: {
    id: 'drone',
    ai: 'chase',
    shape: 'tri',
    color: '#ff4d8d',
    hp: 13,
    speed: 72,
    radius: 10,
    dmg: 8,
    xp: 1,
    knockResist: 0,
    cost: 1,
  },
  swarmer: {
    id: 'swarmer',
    ai: 'swarm',
    shape: 'diamond',
    color: '#ff8a3d',
    hp: 6,
    speed: 128,
    radius: 7,
    dmg: 5,
    xp: 1,
    knockResist: 0,
    cost: 0.7,
  },
  brute: {
    id: 'brute',
    ai: 'brute',
    shape: 'hex',
    color: '#ff3b3b',
    hp: 95,
    speed: 46,
    radius: 21,
    dmg: 16,
    xp: 6,
    knockResist: 0.7,
    cost: 5,
  },
  shooter: {
    id: 'shooter',
    ai: 'shooter',
    shape: 'ring',
    color: '#ffd84a',
    hp: 30,
    speed: 62,
    radius: 11,
    dmg: 6,
    xp: 3,
    knockResist: 0.2,
    cost: 3,
  },
  splitter: {
    id: 'splitter',
    ai: 'splitter',
    shape: 'square',
    color: '#9dff4d',
    hp: 38,
    speed: 64,
    radius: 14,
    dmg: 9,
    xp: 3,
    knockResist: 0.3,
    cost: 3,
  },
  charger: {
    id: 'charger',
    ai: 'charger',
    shape: 'chevron',
    color: '#ff6a2e',
    hp: 44,
    speed: 76,
    radius: 12,
    dmg: 12,
    xp: 4,
    knockResist: 0.4,
    cost: 3.5,
  },
  bomber: {
    id: 'bomber',
    ai: 'bomber',
    shape: 'orb',
    color: '#ff2fd6',
    hp: 26,
    speed: 92,
    radius: 12,
    dmg: 6,
    xp: 3,
    knockResist: 0.1,
    cost: 3,
  },
  shielder: {
    id: 'shielder',
    ai: 'shielder',
    shape: 'oct',
    color: '#b36bff',
    hp: 85,
    speed: 50,
    radius: 16,
    dmg: 10,
    xp: 6,
    knockResist: 0.5,
    cost: 5,
  },
  wraith: {
    id: 'wraith',
    ai: 'wraith',
    shape: 'crescent',
    color: '#d9a6ff',
    hp: 30,
    speed: 98,
    radius: 11,
    dmg: 9,
    xp: 4,
    knockResist: 0.1,
    cost: 3.5,
  },
  shard: {
    id: 'shard',
    ai: 'swarm',
    shape: 'shard',
    color: '#c8ff66',
    hp: 9,
    speed: 118,
    radius: 6,
    dmg: 4,
    xp: 0,
    knockResist: 0,
    cost: 0.5,
  },
}
