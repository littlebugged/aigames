import { PassiveId } from './ids'

/**
 * 被动道具。每级的效果 = per，可叠加到 maxLevel。
 * fmt 决定文案里数值怎么显示：pct → "+10%"，num → "+20"，dec → "+0.5"。
 */
export interface PassiveDef {
  id: PassiveId
  maxLevel: number
  color: string
  per: number
  fmt: 'pct' | 'num' | 'dec'
}

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  power: { id: 'power', maxLevel: 5, color: '#ff5d6c', per: 0.1, fmt: 'pct' },
  haste: { id: 'haste', maxLevel: 5, color: '#ffe66b', per: 0.07, fmt: 'pct' },
  hull: { id: 'hull', maxLevel: 5, color: '#ff8fa3', per: 20, fmt: 'num' },
  armor: { id: 'armor', maxLevel: 5, color: '#9fb4d9', per: 1, fmt: 'num' },
  thruster: { id: 'thruster', maxLevel: 5, color: '#5dd0ff', per: 0.07, fmt: 'pct' },
  magnet: { id: 'magnet', maxLevel: 5, color: '#5dff9e', per: 0.3, fmt: 'pct' },
  regen: { id: 'regen', maxLevel: 5, color: '#7dffb0', per: 0.5, fmt: 'dec' },
  area: { id: 'area', maxLevel: 5, color: '#c9a0ff', per: 0.1, fmt: 'pct' },
  learning: { id: 'learning', maxLevel: 5, color: '#8fb8ff', per: 0.1, fmt: 'pct' },
  luck: { id: 'luck', maxLevel: 5, color: '#ffd84a', per: 0.06, fmt: 'pct' },
  accel: { id: 'accel', maxLevel: 5, color: '#ff9b3d', per: 0.1, fmt: 'pct' },
  multi: { id: 'multi', maxLevel: 2, color: '#3df2ff', per: 1, fmt: 'num' },
}

export function formatPassiveValue(def: PassiveDef, level: number): string {
  const v = def.per * level
  if (def.fmt === 'pct') return `+${Math.round(v * 100)}%`
  if (def.fmt === 'dec') return `+${v.toFixed(1)}`
  return `+${Math.round(v)}`
}
