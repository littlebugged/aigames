import { PassiveId, WEAPON_MAX_LEVEL, WeaponId } from './ids'

/**
 * 武器的"基础"数值（未乘玩家加成）。
 * 战斗时再由 game/stats.ts 把玩家的伤害/冷却/范围等倍率乘上去。
 * 所有 UI 文案里的升级说明，都是对相邻两级的数值做差自动生成的，
 * 所以调平衡只改这里的表格，文案会自己跟着变。
 */
export interface WStats {
  /** 单次伤害（持续型武器指每跳伤害） */
  damage: number
  /** 冷却（秒） */
  cooldown: number
  /** 数量：弹体 / 光刃 / 电弧条数 / 导弹 / 光束 / 地雷 / 冲击环 / 无人机 */
  count: number
  /** 穿透次数 */
  pierce: number
  /** 弹速 或 公转角速度 */
  speed: number
  /** 体型：光刃半径 / 光束宽度 / 冲击环最大半径 */
  area: number
  /** 持续时间（秒） */
  duration: number
  /** 索敌范围 或 公转半径 或 光束长度 */
  range: number
  /** 击退力度 */
  knock: number
  /** 电弧额外跳跃次数 */
  chain: number
  /** 持续伤害的判定间隔（秒） */
  tick: number
  /** 爆炸半径 */
  blast: number
}

export interface WeaponDef {
  id: WeaponId
  color: string
  /** 满级后需要持有哪个被动才能进化 */
  evolvesWith: PassiveId
  /** 升级卡片上展示哪些数值的变化（按顺序） */
  shown: (keyof WStats)[]
  stats(level: number, evolved: boolean): WStats
}

const ZERO: WStats = {
  damage: 0,
  cooldown: 1,
  count: 1,
  pierce: 0,
  speed: 0,
  area: 0,
  duration: 0,
  range: 0,
  knock: 0,
  chain: 0,
  tick: 0,
  blast: 0,
}

/** 取 1 起始的等级表；超过长度取最后一项。 */
const at = (table: readonly number[], level: number): number =>
  table[Math.min(Math.max(level, 1), table.length) - 1]

const make = (base: Partial<WStats>): WStats => ({ ...ZERO, ...base })

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  /** 脉冲炮：朝最近的敌人连射光弹，万金油。 */
  pulse: {
    id: 'pulse',
    color: '#3df2ff',
    evolvesWith: 'power',
    shown: ['damage', 'count', 'cooldown', 'pierce'],
    stats(level, evolved) {
      if (evolved)
        return make({
          damage: 34,
          cooldown: 0.42,
          count: 5,
          pierce: 3,
          speed: 620,
          area: 8,
          blast: 42,
          range: 620,
        })
      return make({
        damage: at([13, 13, 15, 15, 18, 18, 22, 26], level),
        cooldown: at([0.78, 0.78, 0.74, 0.66, 0.66, 0.62, 0.56, 0.48], level),
        count: at([1, 1, 2, 2, 2, 3, 3, 4], level),
        pierce: at([0, 0, 0, 0, 1, 1, 1, 2], level),
        speed: 540,
        area: 5,
        range: 480,
      })
    },
  },

  /** 环绕刃：绕身旋转的光刃，近身防御，越多越密。 */
  orbit: {
    id: 'orbit',
    color: '#8fb8ff',
    evolvesWith: 'area',
    shown: ['damage', 'count', 'area', 'range'],
    stats(level, evolved) {
      if (evolved)
        return make({
          damage: 20,
          cooldown: 1,
          count: 6,
          speed: 3.8,
          area: 19,
          range: 122,
          knock: 90,
          tick: 0.3,
          chain: 4, // 进化后：内圈额外的反向光刃数量
        })
      return make({
        damage: at([7, 8, 8, 10, 10, 12, 12, 15], level),
        count: at([2, 2, 3, 3, 4, 4, 5, 5], level),
        speed: at([2.4, 2.6, 2.6, 2.9, 2.9, 3.2, 3.2, 3.5], level),
        area: at([11, 12, 12, 13, 14, 14, 15, 16], level),
        range: at([74, 74, 78, 82, 86, 90, 94, 100], level),
        knock: 40,
        tick: at([0.46, 0.46, 0.42, 0.42, 0.4, 0.38, 0.36, 0.34], level),
      })
    },
  },

  /** 电弧链：闪电在敌人之间连跳，对付成群的小怪。 */
  arc: {
    id: 'arc',
    color: '#ffe66b',
    evolvesWith: 'haste',
    shown: ['damage', 'chain', 'count', 'cooldown'],
    stats(level, evolved) {
      if (evolved)
        return make({
          damage: 36,
          cooldown: 0.6,
          count: 4,
          chain: 9,
          range: 300,
          duration: 0.5, // 进化后：电击使敌人麻痹的时间
        })
      return make({
        damage: at([14, 16, 16, 19, 22, 22, 26, 30], level),
        cooldown: at([1.25, 1.25, 1.1, 1.1, 1.0, 0.9, 0.9, 0.75], level),
        count: at([1, 1, 1, 1, 2, 2, 2, 3], level),
        chain: at([2, 3, 3, 4, 4, 5, 6, 7], level),
        range: 270,
      })
    },
  },

  /** 追踪导弹：自动追踪并范围爆炸。 */
  missile: {
    id: 'missile',
    color: '#ff9b3d',
    evolvesWith: 'accel',
    shown: ['damage', 'count', 'blast', 'cooldown'],
    stats(level, evolved) {
      if (evolved)
        return make({
          damage: 26,
          cooldown: 1.05,
          count: 8,
          speed: 300,
          blast: 64,
          duration: 2.4,
          range: 560,
        })
      return make({
        damage: at([18, 20, 20, 24, 24, 28, 28, 34], level),
        cooldown: at([2.1, 2.1, 1.9, 1.9, 1.7, 1.7, 1.5, 1.3], level),
        count: at([1, 1, 2, 2, 2, 3, 3, 4], level),
        speed: 250,
        blast: at([46, 50, 50, 54, 58, 62, 66, 72], level),
        duration: 2.6,
        range: 520,
      })
    },
  },

  /** 棱镜激光：周期性射出贯穿一切的光束。 */
  laser: {
    id: 'laser',
    color: '#c9a0ff',
    evolvesWith: 'multi',
    shown: ['damage', 'count', 'area', 'cooldown'],
    stats(level, evolved) {
      if (evolved)
        return make({
          damage: 22,
          cooldown: 2.3,
          count: 4,
          area: 26,
          duration: 1.7,
          tick: 0.08,
          range: 820,
        })
      return make({
        damage: at([10, 12, 12, 14, 14, 17, 17, 21], level),
        cooldown: at([3.0, 3.0, 2.7, 2.7, 2.4, 2.4, 2.1, 1.8], level),
        count: at([1, 1, 1, 2, 2, 2, 3, 3], level),
        area: at([12, 12, 14, 14, 16, 18, 18, 22], level),
        duration: at([0.45, 0.5, 0.5, 0.55, 0.55, 0.6, 0.65, 0.7], level),
        tick: 0.08,
        range: 760,
      })
    },
  },

  /** 磁暴地雷：沿途布雷，敌人踩上去就大爆炸。 */
  mine: {
    id: 'mine',
    color: '#5dff9e',
    evolvesWith: 'magnet',
    shown: ['damage', 'blast', 'count', 'cooldown'],
    stats(level, evolved) {
      if (evolved)
        return make({
          damage: 92,
          cooldown: 1.4,
          count: 4,
          blast: 112,
          duration: 10,
          range: 40,
          chain: 150, // 进化后：引爆前的引力井吸引半径
        })
      return make({
        damage: at([30, 34, 34, 40, 40, 46, 52, 60], level),
        cooldown: at([2.6, 2.4, 2.4, 2.1, 2.1, 1.8, 1.8, 1.5], level),
        count: at([1, 1, 1, 2, 2, 2, 3, 3], level),
        blast: at([64, 68, 72, 72, 78, 84, 90, 96], level),
        duration: 9,
        range: 36,
      })
    },
  },

  /** 冲击波：以自身为中心扩散的冲击环，击退并重创近身敌人。 */
  nova: {
    id: 'nova',
    color: '#e8fbff',
    evolvesWith: 'armor',
    shown: ['damage', 'area', 'knock', 'cooldown'],
    stats(level, evolved) {
      if (evolved)
        return make({
          damage: 46,
          cooldown: 2.6,
          count: 2,
          speed: 520,
          area: 290,
          knock: 220,
          duration: 2, // 进化后：减速持续时间
        })
      return make({
        damage: at([16, 18, 18, 22, 22, 26, 26, 32], level),
        cooldown: at([4.0, 3.8, 3.5, 3.5, 3.2, 3.0, 2.7, 2.4], level),
        count: 1,
        speed: 440,
        area: at([150, 160, 170, 180, 190, 200, 215, 230], level),
        knock: at([120, 120, 140, 140, 160, 160, 180, 200], level),
      })
    },
  },

  /** 僚机无人机：环绕飞行并自动开火的小帮手。 */
  drone: {
    id: 'drone',
    color: '#7dffb0',
    evolvesWith: 'learning',
    shown: ['damage', 'count', 'cooldown'],
    stats(level, evolved) {
      if (evolved)
        return make({
          damage: 15,
          cooldown: 0.42,
          count: 6,
          pierce: 1,
          speed: 620,
          range: 380,
          area: 5,
        })
      return make({
        damage: at([6, 7, 7, 8, 9, 9, 11, 13], level),
        cooldown: at([0.9, 0.85, 0.8, 0.8, 0.72, 0.65, 0.6, 0.5], level),
        count: at([1, 1, 2, 2, 2, 3, 3, 4], level),
        speed: 560,
        range: 340,
        area: 4,
      })
    },
  },
}

export { WEAPON_MAX_LEVEL }
