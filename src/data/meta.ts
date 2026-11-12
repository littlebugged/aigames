import { MetaId } from './ids'

/**
 * 机库（永久升级）。每次升级用晶核购买，下一局开始生效。
 * 单条上限都不高，总和控制在"手感变好"而不是"数值碾压"。
 */
export interface MetaDef {
  id: MetaId
  max: number
  /** 第 1 级的价格 */
  base: number
  /** 每级价格倍率 */
  growth: number
  /** 每级效果 */
  per: number
  fmt: 'pct' | 'num' | 'dec'
  color: string
}

export const METAS: Record<MetaId, MetaDef> = {
  m_power: { id: 'm_power', max: 5, base: 60, growth: 1.6, per: 0.04, fmt: 'pct', color: '#ff5d6c' },
  m_hull: { id: 'm_hull', max: 5, base: 50, growth: 1.55, per: 10, fmt: 'num', color: '#ff8fa3' },
  m_speed: { id: 'm_speed', max: 4, base: 50, growth: 1.6, per: 0.03, fmt: 'pct', color: '#5dd0ff' },
  m_magnet: { id: 'm_magnet', max: 4, base: 40, growth: 1.55, per: 0.15, fmt: 'pct', color: '#5dff9e' },
  m_xp: { id: 'm_xp', max: 5, base: 80, growth: 1.65, per: 0.05, fmt: 'pct', color: '#8fb8ff' },
  m_regen: { id: 'm_regen', max: 4, base: 70, growth: 1.7, per: 0.15, fmt: 'dec', color: '#7dffb0' },
  m_armor: { id: 'm_armor', max: 3, base: 150, growth: 2.1, per: 1, fmt: 'num', color: '#9fb4d9' },
  m_luck: { id: 'm_luck', max: 4, base: 90, growth: 1.7, per: 0.03, fmt: 'pct', color: '#ffd84a' },
  m_dash: { id: 'm_dash', max: 4, base: 60, growth: 1.6, per: 0.08, fmt: 'pct', color: '#c9a0ff' },
  m_reroll: { id: 'm_reroll', max: 3, base: 100, growth: 2.0, per: 1, fmt: 'num', color: '#ffe66b' },
  m_banish: { id: 'm_banish', max: 3, base: 100, growth: 2.0, per: 1, fmt: 'num', color: '#ff9b3d' },
  m_revive: { id: 'm_revive', max: 2, base: 400, growth: 2.5, per: 1, fmt: 'num', color: '#ff4d8d' },
  m_greed: { id: 'm_greed', max: 5, base: 120, growth: 1.7, per: 0.08, fmt: 'pct', color: '#3df2ff' },
}

/** 购买第 (rank+1) 级的价格；rank 为当前已有等级。 */
export function metaCost(def: MetaDef, rank: number): number {
  return Math.round((def.base * Math.pow(def.growth, rank)) / 5) * 5
}

export function formatMetaValue(def: MetaDef, rank: number): string {
  const v = def.per * rank
  if (def.fmt === 'pct') return `+${Math.round(v * 100)}%`
  if (def.fmt === 'dec') return `+${v.toFixed(2)}`
  return `+${Math.round(v)}`
}
