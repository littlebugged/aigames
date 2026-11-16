import { METAS } from '../data/meta'
import { PASSIVES } from '../data/passives'
import { SHIPS } from '../data/ships'
import { HULL_BASELINE, HULL_SCALING, WEAPONS, type WStats } from '../data/weapons'
import type { MetaId, PassiveId, ShipId, WeaponId } from '../data/ids'
import type { PlayerStats } from './entities'

export type MetaRanks = Partial<Record<MetaId, number>>

const lv = (m: MetaRanks, id: MetaId): number => m[id] ?? 0
const pl = (p: Partial<Record<PassiveId, number>>, id: PassiveId): number => p[id] ?? 0

/** 本局可用的重抽/放逐/复活次数——来自机库升级。 */
export interface RunPerks {
  rerolls: number
  banishes: number
  revives: number
}

export function computePerks(meta: MetaRanks): RunPerks {
  return {
    rerolls: lv(meta, 'm_reroll') * METAS.m_reroll.per,
    banishes: lv(meta, 'm_banish') * METAS.m_banish.per,
    revives: lv(meta, 'm_revive') * METAS.m_revive.per,
  }
}

/** 飞船 + 机库永久升级 + 本局被动道具 → 实战数值。 */
export function computeStats(
  ship: ShipId,
  meta: MetaRanks,
  passives: Partial<Record<PassiveId, number>>,
): PlayerStats {
  const s = SHIPS[ship]
  const P = PASSIVES
  const dashCut = Math.min(0.5, lv(meta, 'm_dash') * METAS.m_dash.per)
  return {
    maxHp: s.hp + lv(meta, 'm_hull') * METAS.m_hull.per + pl(passives, 'hull') * P.hull.per,
    regen: s.regen + lv(meta, 'm_regen') * METAS.m_regen.per + pl(passives, 'regen') * P.regen.per,
    speed:
      s.speed * (1 + lv(meta, 'm_speed') * METAS.m_speed.per + pl(passives, 'thruster') * P.thruster.per),
    armor: s.armor + lv(meta, 'm_armor') * METAS.m_armor.per + pl(passives, 'armor') * P.armor.per,
    magnet: 125 * (1 + lv(meta, 'm_magnet') * METAS.m_magnet.per + pl(passives, 'magnet') * P.magnet.per),
    dmg: s.dmg * (1 + lv(meta, 'm_power') * METAS.m_power.per + pl(passives, 'power') * P.power.per),
    cd: Math.max(0.35, 1 - pl(passives, 'haste') * P.haste.per),
    area: 1 + pl(passives, 'area') * P.area.per,
    projSpeed: 1 + pl(passives, 'accel') * P.accel.per,
    duration: 1 + pl(passives, 'accel') * 0.08,
    xp: 1 + s.xp + lv(meta, 'm_xp') * METAS.m_xp.per + pl(passives, 'learning') * P.learning.per,
    crit: Math.min(0.75, s.crit + lv(meta, 'm_luck') * METAS.m_luck.per + pl(passives, 'luck') * P.luck.per),
    critMul: 2,
    extraCount: pl(passives, 'multi') * P.multi.per,
    dashCd: s.dashCd * (1 - dashCut),
    luck: lv(meta, 'm_luck') * 0.03 + pl(passives, 'luck') * 0.05,
    greed: 1 + lv(meta, 'm_greed') * METAS.m_greed.per,
    minTaken: 0.2,
  }
}

/** 哪些武器吃"额外弹体数量"加成 */
const COUNTABLE: Partial<Record<WeaponId, true>> = {
  pulse: true,
  missile: true,
  arc: true,
  laser: true,
  mine: true,
  drone: true,
  chakram: true,
  howitzer: true,
  siphon: true,
}

/** 吃"最大耐久"加成的武器（榴弹炮）：伤害 ×(1 + 系数 × 高出 100 点的耐久 ÷ 100) */
function hullBoost(id: WeaponId, st: PlayerStats): number {
  const k = HULL_SCALING[id]
  return k ? 1 + (k * Math.max(0, st.maxHp - HULL_BASELINE)) / 100 : 1
}

/** 武器基础数值 × 玩家加成 = 战斗里实际用的数值 */
export function resolveWeaponStats(id: WeaponId, level: number, evolved: boolean, st: PlayerStats): WStats {
  const b = WEAPONS[id].stats(level, evolved)
  return {
    damage: b.damage * st.dmg * hullBoost(id, st),
    cooldown: b.cooldown * st.cd,
    count: b.count + (COUNTABLE[id] ? st.extraCount : 0),
    pierce: b.pierce,
    speed: b.speed * st.projSpeed,
    area: b.area * st.area,
    duration: b.duration * st.duration,
    range: id === 'orbit' || id === 'siphon' ? b.range * (1 + (st.area - 1) * 0.5) : b.range,
    knock: b.knock,
    chain: b.chain,
    tick: b.tick,
    blast: b.blast * st.area,
    heal: b.heal,
  }
}

/**
 * 升到下一级所需经验 = round(a + b·L + c·L² + d·L³)。可调，仅供平衡测试覆盖。
 *
 * v1.14 波次改版：经验是击杀时直接入账的，升级卡在一波结束时统一弹出，所以曲线要对准"每一波大约升 2~3 级"。
 * v1.15 人潮补兵之后，屏幕里的怪多了一倍以上（击杀数从每局 6 千涨到 1 万 4），经验曲线跟着整体抬高、重新拟合：
 * 用 scripts/sim.ts 实测各星区 × 各飞船逐波的累计经验供给，让波末等级落在 4 / 7 / 10 / 12 / 15 / 17 / 20 / 22 / 24 / 26 / 28
 * （第一波约 3~4 级，之后每波 2~3 级，进 Boss 战前约 30 级）。早期的补兵占比更高，所以早期的单级成本也相应更贵。
 */
export const XP_CURVE = { a: 32, b: 11.5, c: 0, d: 0.022 }

export function xpForLevel(level: number): number {
  return Math.round(XP_CURVE.a + XP_CURVE.b * level + XP_CURVE.c * level * level + XP_CURVE.d * level * level * level)
}
