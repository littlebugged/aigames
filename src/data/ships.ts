import { ShipId, WeaponId } from './ids'

export interface ShipDef {
  id: ShipId
  color: string
  accent: string
  hp: number
  speed: number
  /** 伤害倍率 */
  dmg: number
  crit: number
  armor: number
  regen: number
  /** 冲刺冷却（秒） */
  dashCd: number
  /** 经验倍率加成 */
  xp: number
  startWeapon: WeaponId
  /** 解锁方式：默认拥有 / 完成某成就自动解锁；任何未解锁的飞船都可用晶核直接购买 */
  unlockAch: string | null
  cost: number
}

export const SHIPS: Record<ShipId, ShipDef> = {
  vanguard: {
    id: 'vanguard',
    color: '#3df2ff',
    accent: '#e8fbff',
    hp: 100,
    speed: 232,
    dmg: 1,
    crit: 0.05,
    armor: 0,
    regen: 0,
    dashCd: 2.4,
    xp: 0.1,
    startWeapon: 'pulse',
    unlockAch: null,
    cost: 0,
  },
  phantom: {
    id: 'phantom',
    color: '#5dff9e',
    accent: '#eafff2',
    hp: 82,
    speed: 262,
    dmg: 1.05,
    crit: 0.15,
    armor: 0,
    regen: 0.1,
    dashCd: 1.6,
    xp: 0.08,
    startWeapon: 'arc',
    unlockAch: 'survive_5',
    cost: 600,
  },
  bulwark: {
    id: 'bulwark',
    color: '#ffb347',
    accent: '#fff3dc',
    hp: 170,
    speed: 205,
    dmg: 1,
    crit: 0.03,
    armor: 1,
    regen: 0.4,
    dashCd: 2.8,
    xp: 0,
    startWeapon: 'nova',
    unlockAch: 'total_kills_2k',
    cost: 1200,
  },
  reaper: {
    id: 'reaper',
    color: '#ff5d8f',
    accent: '#ffe6ef',
    hp: 74,
    speed: 236,
    dmg: 1.3,
    crit: 0.1,
    armor: 0,
    regen: 0.15,
    dashCd: 2.2,
    xp: 0,
    startWeapon: 'laser',
    unlockAch: 'boss_fields',
    cost: 2000,
  },
}
