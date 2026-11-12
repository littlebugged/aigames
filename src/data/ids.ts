/** 全部内容 ID 的集中定义。新增内容时先在这里加，TypeScript 会提示所有需要补齐的地方。 */

export const WEAPON_IDS = ['pulse', 'orbit', 'arc', 'missile', 'laser', 'mine', 'nova', 'drone', 'chakram', 'rail'] as const
export type WeaponId = (typeof WEAPON_IDS)[number]

export const PASSIVE_IDS = [
  'power',
  'haste',
  'hull',
  'armor',
  'thruster',
  'magnet',
  'regen',
  'area',
  'learning',
  'luck',
  'accel',
  'multi',
] as const
export type PassiveId = (typeof PASSIVE_IDS)[number]

export const SHIP_IDS = ['vanguard', 'phantom', 'bulwark', 'reaper'] as const
export type ShipId = (typeof SHIP_IDS)[number]

export const SECTOR_IDS = ['fields', 'wasteland', 'void'] as const
export type SectorId = (typeof SECTOR_IDS)[number]

export const ENEMY_IDS = [
  'drone',
  'swarmer',
  'brute',
  'shooter',
  'splitter',
  'charger',
  'bomber',
  'shielder',
  'wraith',
  'shard',
] as const
export type EnemyId = (typeof ENEMY_IDS)[number]

export const BOSS_IDS = ['overseer', 'fractal', 'maw'] as const
export type BossId = (typeof BOSS_IDS)[number]

export const META_IDS = [
  'm_power',
  'm_hull',
  'm_speed',
  'm_magnet',
  'm_xp',
  'm_regen',
  'm_armor',
  'm_luck',
  'm_dash',
  'm_reroll',
  'm_banish',
  'm_revive',
  'm_greed',
] as const
export type MetaId = (typeof META_IDS)[number]

export const MAX_WEAPONS = 6
export const MAX_PASSIVES = 6
export const WEAPON_MAX_LEVEL = 8
