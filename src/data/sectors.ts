import { BossId, EnemyId, SectorId } from './ids'
import { BOSS_ADDS, MINIS, WAVES_CRUCIBLE, WAVES_FIELDS, WAVES_VOID, WAVES_WASTELAND, type MiniPlan, type PulseDef, type WaveDef } from './waves'

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
  /** 杂兵数量倍率（乘在每个脉冲的数量上）：越靠后的星区，人潮越厚 */
  density: number
  /** 敌人血量成长 = hpPerMin*m + hpQuad*m²（再乘 TUNE.hpGrow 与各兵种的 grow） */
  hpPerMin: number
  hpQuad: number
  /** 敌人接触伤害成长：1 + dmgPerMin*m */
  dmgPerMin: number
  /** 通关后晶核收益倍率 */
  reward: number
  /** 需要先通关的星区 */
  requires: SectorId | null
  /** 12 波脚本（时长之和 = length） */
  waves: WaveDef[]
  /** 小 Boss 的出场计划 */
  minis: MiniPlan[]
  /** Boss 战里补充杂兵的脉冲（轮换） */
  adds: PulseDef[]
  /** 本星区会出现的兵种（由脚本统计，指南页用） */
  roster: EnemyId[]
}

/** 从脚本里统计出现过的兵种（按首次出现的顺序） */
export function rosterOf(waves: WaveDef[], adds: PulseDef[]): EnemyId[] {
  const seen = new Set<EnemyId>()
  const add = (id?: EnemyId): void => {
    if (id) seen.add(id)
  }
  for (const w of waves) {
    for (const p of w.pulses) {
      add(p.enemy)
      add(p.mix)
    }
    for (const q of w.squads ?? []) add(q.enemy)
  }
  for (const p of adds) {
    add(p.enemy)
    add(p.mix)
  }
  seen.delete('shard')
  return [...seen]
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
    density: 1,
    hpPerMin: 0.49,
    hpQuad: 0.086,
    dmgPerMin: 0.109,
    reward: 1,
    requires: null,
    waves: WAVES_FIELDS,
    minis: MINIS.fields,
    adds: BOSS_ADDS.fields,
    roster: [],
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
    density: 1.25,
    hpPerMin: 0.62,
    hpQuad: 0.086,
    dmgPerMin: 0.109,
    reward: 1.6,
    requires: 'fields',
    waves: WAVES_WASTELAND,
    minis: MINIS.wasteland,
    adds: BOSS_ADDS.wasteland,
    roster: [],
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
    density: 1.5,
    hpPerMin: 0.75,
    hpQuad: 0.086,
    dmgPerMin: 0.109,
    reward: 2.4,
    requires: 'wasteland',
    waves: WAVES_VOID,
    minis: MINIS.void,
    adds: BOSS_ADDS.void,
    roster: [],
  },

  crucible: {
    id: 'crucible',
    boss: 'forge',
    length: 600,
    palette: {
      bg0: '#160805',
      bg1: '#2b1007',
      grid: '#6a2a12',
      gridMajor: '#b8501f',
      dust: '#ffc58a',
      accent: '#ff8a3d',
    },
    density: 1.65,
    hpPerMin: 0.8,
    hpQuad: 0.088,
    dmgPerMin: 0.112,
    reward: 3.4,
    requires: 'void',
    waves: WAVES_CRUCIBLE,
    minis: MINIS.crucible,
    adds: BOSS_ADDS.crucible,
    roster: [],
  },
}

for (const sec of Object.values(SECTORS)) sec.roster = rosterOf(sec.waves, sec.adds)

/** 威胁等级（难度）：敌人更强、更多，收益更高。 */
export const THREAT_LEVELS = [
  { hp: 1, speed: 1, spawn: 1, reward: 1 },
  { hp: 1.35, speed: 1.05, spawn: 1.15, reward: 1.4 },
  { hp: 1.75, speed: 1.1, spawn: 1.3, reward: 1.9 },
  { hp: 2.3, speed: 1.15, spawn: 1.5, reward: 2.6 },
] as const
