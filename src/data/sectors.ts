import { BossId, EnemyId, SectorId } from './ids'

export interface RosterEntry {
  id: EnemyId
  /** 从第几秒开始出现 */
  from: number
  /** 到第几秒后不再出现（缺省为一直） */
  to?: number
  /** 抽取权重 */
  weight: number
}

/** 定时事件：到点触发一次。 */
export interface TimedEvent {
  at: number
  kind: 'ring' | 'wall' | 'elite' | 'boss-warning'
  enemy?: EnemyId
  count?: number
}

export interface SectorPalette {
  /** 背景渐变（上 → 下） */
  bg0: string
  bg1: string
  /** 网格线（细 / 粗） */
  grid: string
  gridMajor: string
  /** 星尘点缀 */
  dust: string
  /** 主题强调色（用于 UI） */
  accent: string
}

export interface SectorDef {
  id: SectorId
  boss: BossId
  /** Boss 出现的时间（秒），同时也是整局的目标时长 */
  length: number
  palette: SectorPalette
  /** 刷怪预算（点/秒）= base + perMin*m + accel*m²，m 为分钟数 */
  spawn: { base: number; perMin: number; accel: number }
  /** 敌人血量倍率 = 1 + hpPerMin*m + hpQuad*m² */
  hpPerMin: number
  hpQuad: number
  /** 敌人接触伤害成长：1 + dmgPerMin*m */
  dmgPerMin: number
  /** 通关后晶核收益倍率 */
  reward: number
  /** 需要先通关的星区 */
  requires: SectorId | null
  roster: RosterEntry[]
  events: TimedEvent[]
}

export const SECTORS: Record<SectorId, SectorDef> = {
  fields: {
    id: 'fields',
    boss: 'overseer',
    length: 600,
    palette: {
      bg0: '#060913',
      bg1: '#0d1124',
      grid: '#2b3b73',
      gridMajor: '#4d69bd',
      dust: '#9db6ff',
      accent: '#3df2ff',
    },
    spawn: { base: 1.4, perMin: 1.61, accel: 0.084 },
    hpPerMin: 0.49,
    hpQuad: 0.086,
    dmgPerMin: 0.109,
    reward: 1,
    requires: null,
    roster: [
      { id: 'drone', from: 0, weight: 10 },
      { id: 'swarmer', from: 40, weight: 4 },
      { id: 'brute', from: 130, weight: 1.6 },
      { id: 'shooter', from: 200, weight: 2.4 },
      { id: 'splitter', from: 260, weight: 2.4 },
      { id: 'charger', from: 330, weight: 2.4 },
      { id: 'bomber', from: 400, weight: 2 },
      { id: 'shielder', from: 470, weight: 1.2 },
    ],
    events: [
      { at: 55, kind: 'ring', enemy: 'swarmer', count: 16 },
      { at: 105, kind: 'wall', enemy: 'drone', count: 12 },
      { at: 150, kind: 'elite', enemy: 'brute' },
      { at: 200, kind: 'ring', enemy: 'swarmer', count: 22 },
      { at: 245, kind: 'elite', enemy: 'shooter' },
      { at: 300, kind: 'elite', enemy: 'charger' },
      { at: 330, kind: 'wall', enemy: 'drone', count: 18 },
      { at: 380, kind: 'ring', enemy: 'drone', count: 26 },
      { at: 430, kind: 'elite', enemy: 'splitter' },
      { at: 490, kind: 'elite', enemy: 'brute' },
      { at: 520, kind: 'ring', enemy: 'swarmer', count: 36 },
      { at: 560, kind: 'elite', enemy: 'shielder' },
      { at: 585, kind: 'boss-warning' },
    ],
  },

  wasteland: {
    id: 'wasteland',
    boss: 'fractal',
    length: 600,
    palette: {
      bg0: '#050e0a',
      bg1: '#0a1a12',
      grid: '#22503a',
      gridMajor: '#3f9068',
      dust: '#b4ffd8',
      accent: '#5dff9e',
    },
    spawn: { base: 1.82, perMin: 1.89, accel: 0.095 },
    hpPerMin: 0.62,
    hpQuad: 0.086,
    dmgPerMin: 0.109,
    reward: 1.6,
    requires: 'fields',
    roster: [
      { id: 'drone', from: 0, to: 360, weight: 7 },
      { id: 'swarmer', from: 0, weight: 5 },
      { id: 'shooter', from: 70, weight: 3 },
      { id: 'splitter', from: 120, weight: 3 },
      { id: 'bomber', from: 170, weight: 3.2 },
      { id: 'brute', from: 210, weight: 2 },
      { id: 'charger', from: 270, weight: 3 },
      { id: 'shielder', from: 330, weight: 2.2 },
      { id: 'wraith', from: 400, weight: 2.6 },
    ],
    events: [
      { at: 45, kind: 'ring', enemy: 'swarmer', count: 18 },
      { at: 90, kind: 'wall', enemy: 'swarmer', count: 14 },
      { at: 130, kind: 'elite', enemy: 'shooter' },
      { at: 180, kind: 'ring', enemy: 'bomber', count: 10 },
      { at: 230, kind: 'elite', enemy: 'splitter' },
      { at: 280, kind: 'wall', enemy: 'drone', count: 20 },
      { at: 320, kind: 'elite', enemy: 'bomber' },
      { at: 370, kind: 'ring', enemy: 'swarmer', count: 34 },
      { at: 420, kind: 'elite', enemy: 'shielder' },
      { at: 470, kind: 'elite', enemy: 'wraith' },
      { at: 510, kind: 'ring', enemy: 'wraith', count: 14 },
      { at: 550, kind: 'elite', enemy: 'brute' },
      { at: 585, kind: 'boss-warning' },
    ],
  },

  void: {
    id: 'void',
    boss: 'maw',
    length: 600,
    palette: {
      bg0: '#09061a',
      bg1: '#160b2b',
      grid: '#3b2b70',
      gridMajor: '#7657cc',
      dust: '#d9c4ff',
      accent: '#c9a0ff',
    },
    spawn: { base: 2.24, perMin: 2.17, accel: 0.104 },
    hpPerMin: 0.75,
    hpQuad: 0.086,
    dmgPerMin: 0.109,
    reward: 2.4,
    requires: 'wasteland',
    roster: [
      { id: 'swarmer', from: 0, weight: 5 },
      { id: 'drone', from: 0, to: 300, weight: 5 },
      { id: 'wraith', from: 40, weight: 3 },
      { id: 'shooter', from: 80, weight: 3 },
      { id: 'charger', from: 130, weight: 3 },
      { id: 'bomber', from: 180, weight: 3 },
      { id: 'splitter', from: 220, weight: 2.6 },
      { id: 'brute', from: 260, weight: 2.4 },
      { id: 'shielder', from: 320, weight: 2.6 },
    ],
    events: [
      { at: 40, kind: 'ring', enemy: 'wraith', count: 12 },
      { at: 85, kind: 'wall', enemy: 'swarmer', count: 18 },
      { at: 120, kind: 'elite', enemy: 'wraith' },
      { at: 170, kind: 'ring', enemy: 'bomber', count: 12 },
      { at: 215, kind: 'elite', enemy: 'charger' },
      { at: 265, kind: 'wall', enemy: 'shooter', count: 12 },
      { at: 310, kind: 'elite', enemy: 'shielder' },
      { at: 360, kind: 'ring', enemy: 'swarmer', count: 40 },
      { at: 410, kind: 'elite', enemy: 'brute' },
      { at: 455, kind: 'elite', enemy: 'splitter' },
      { at: 500, kind: 'ring', enemy: 'wraith', count: 18 },
      { at: 545, kind: 'elite', enemy: 'bomber' },
      { at: 585, kind: 'boss-warning' },
    ],
  },
}

/** 威胁等级（难度）：敌人更强、更多，收益更高。 */
export const THREAT_LEVELS = [
  { hp: 1, speed: 1, spawn: 1, reward: 1 },
  { hp: 1.35, speed: 1.05, spawn: 1.15, reward: 1.4 },
  { hp: 1.75, speed: 1.1, spawn: 1.3, reward: 1.9 },
  { hp: 2.3, speed: 1.15, spawn: 1.5, reward: 2.6 },
] as const
