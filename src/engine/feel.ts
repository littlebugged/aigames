/**
 * 手感参数：伤害数字分级、进化演出的时间轴。
 * 只有数据和纯函数，不依赖 DOM / Canvas，所以渲染层、音频层、App 都能共用，也能在 Node 里直接单测。
 */

// ───────────────────────── 伤害数字分级 ─────────────────────────

/**
 * 数字字形的外观（预渲染成字形图集，见 render/numfont.ts）。
 * 取向是"霓虹灯管"而不是"糖果字"：白热的字芯 + 越往下越饱和的渐变 + 细而利落的暗描边 + 贴着字形的柔光；
 * 重击再加斜体与顶部高光。低档位几乎是中性的灰白，颜色只留给真正的重击，所以满屏数字也不会花。
 */
export interface NumLook {
  /** 图集基准字号（世界单位）：决定字形预渲染的分辨率 */
  size: number
  weight: 600 | 800
  /** 字面渐变：顶部 → 中段 → 底部 */
  top: string
  mid: string
  bot: string
  /** 光晕色；空串表示没有光晕 */
  glow: string
  /** 光晕模糊半径（相对字号） */
  glowK: number
  /** 暗描边宽度（相对字号） */
  outline: number
  /** 斜体程度（0 = 正体） */
  skew: number
  /** 顶部高光强度 0–1 */
  gloss: number
}

export interface DmgTier extends NumLook {
  /** 该档伤害下限（含） */
  min: number
  /** 粒子/特效取色（火花、冲击环）；字面颜色见 top/mid/bot */
  color: string
  /** 特效光晕色；空串表示没有 */
  halo: string
  /** 存活秒数：越狠的数字停留越久，让人看得清 */
  life: number
  /** 弹出瞬间的放大倍率 */
  pop: number
}

/**
 * 8 档：冷灰 → 冰白 → 纯白 → 暖黄 → 橙 → 红 → 品红 → 金白，字号约每档 ×1.2。
 * 阈值按整局实测的命中分布标定（机器人 16 局、约 50 万次命中）：
 *   T0 8% · T1 46% · T2 31% · T3 8.5% · T4 3.5% · T5 2% · T6 1.5% · T7 0.14%
 * 所以日常的杂兵数字是小号灰白，一看到黄/橙/红/品红就知道这一下很重。
 */
export const DMG_TIERS: readonly DmgTier[] = [
  { min: 0, size: 11, color: '#a9bbd9', halo: '', life: 0.5, pop: 1.2, weight: 600, top: '#cbd8ee', mid: '#a9bbd9', bot: '#8599bc', glow: '', glowK: 0, outline: 0.08, skew: 0, gloss: 0 },
  { min: 10, size: 13, color: '#e4f0ff', halo: '', life: 0.58, pop: 1.3, weight: 600, top: '#ffffff', mid: '#e4f0ff', bot: '#bcd2f0', glow: '', glowK: 0, outline: 0.085, skew: 0, gloss: 0 },
  { min: 20, size: 15, color: '#ffffff', halo: '#7fe9ff', life: 0.66, pop: 1.4, weight: 800, top: '#ffffff', mid: '#f2fbff', bot: '#c9ecff', glow: '#52dcff', glowK: 0.11, outline: 0.09, skew: 0, gloss: 0 },
  { min: 40, size: 19, color: '#ffe27a', halo: '#ffb300', life: 0.8, pop: 1.6, weight: 800, top: '#fffbe6', mid: '#ffe27a', bot: '#ffbf1f', glow: '#ff9f00', glowK: 0.13, outline: 0.095, skew: 0.1, gloss: 0.3 },
  { min: 80, size: 23, color: '#ffa63d', halo: '#ff6a00', life: 0.92, pop: 1.75, weight: 800, top: '#fff1d8', mid: '#ffb04a', bot: '#ff7a12', glow: '#ff6a00', glowK: 0.15, outline: 0.1, skew: 0.13, gloss: 0.34 },
  { min: 160, size: 28, color: '#ff5468', halo: '#ff1f4b', life: 1.0, pop: 1.95, weight: 800, top: '#ffe9e6', mid: '#ff8a7a', bot: '#ff3a3a', glow: '#ff2a2a', glowK: 0.16, outline: 0.1, skew: 0.16, gloss: 0.38 },
  { min: 350, size: 34, color: '#ff5fe0', halo: '#c400ff', life: 1.12, pop: 2.15, weight: 800, top: '#fff0fc', mid: '#ff8fe6', bot: '#ff2fd0', glow: '#d11dff', glowK: 0.18, outline: 0.1, skew: 0.18, gloss: 0.42 },
  { min: 800, size: 41, color: '#fff2a6', halo: '#ffd000', life: 1.28, pop: 2.4, weight: 800, top: '#ffffff', mid: '#ffe98a', bot: '#ffb300', glow: '#ffc400', glowK: 0.24, outline: 0.1, skew: 0.2, gloss: 0.5 },
]

export const TOP_TIER = DMG_TIERS.length - 1

/** 玩家自己受到的伤害：热红色，和打出去的数字一眼区分 */
export const HURT_STYLE = DMG_TIERS.length

/** 全部数字外观：下标 0..TOP_TIER 是伤害档位，HURT_STYLE 是受伤数字 */
export const NUM_LOOKS: readonly NumLook[] = [
  ...DMG_TIERS,
  { size: 18, weight: 800, top: '#ffe6ea', mid: '#ff8da0', bot: '#ff3a5c', glow: '#ff1f4b', glowK: 0.16, outline: 0.1, skew: 0.1, gloss: 0.3 },
]

/** 伤害 → 档位。暴击额外上浮一档（至少落在第 2 档），一眼能和普通命中区分开。 */
export function dmgTier(dmg: number, crit: boolean): number {
  let t = 0
  for (let i = TOP_TIER; i > 0; i--) {
    if (dmg >= DMG_TIERS[i].min) {
      t = i
      break
    }
  }
  if (crit) t = Math.min(TOP_TIER, Math.max(2, t + 1))
  return t
}

/** 先四舍五入再换算：999.6 显示 1.0k 而不是 1000；9999 显示 10k 而不是 10.0k */
export function fmtDmg(n: number): string {
  const r = Math.round(n)
  if (r >= 9950) return `${Math.round(r / 1000)}k`
  if (r >= 1000) return `${(r / 1000).toFixed(1)}k`
  return `${r}`
}

/** 飘字限流分级：0=小数字（T0–T2）  1=中等（T3–T4）  2=重击（T5+） */
export function budgetClass(tier: number): 0 | 1 | 2 {
  return tier >= 5 ? 2 : tier >= 3 ? 1 : 0
}

// ───────────────────────── 进化演出 ─────────────────────────

/** 蓄力：从选中进化卡到"爆发"的间隔（秒，真实时间） */
export const EVOLVE_CHARGE = 0.36
/** 爆发瞬间的定格（几乎静止的一小段，让冲击波有"砸下来"的感觉） */
export const EVOLVE_HOLD = 0.14
/** 定格之后慢慢恢复到正常速度所需的时间 */
export const EVOLVE_RAMP = 0.95
/** 整个演出的总时长（真实秒） */
export const EVOLVE_TOTAL = EVOLVE_CHARGE + EVOLVE_HOLD + EVOLVE_RAMP
/** 定格时的时间流速 */
export const EVOLVE_FLOOR = 0.12

const smooth = (u: number): number => {
  const x = u < 0 ? 0 : u > 1 ? 1 : u
  return x * x * (3 - 2 * x)
}

/**
 * 进化演出的时间流速（1 = 正常）。t 为事件发生后的真实秒数。
 *   蓄力：平滑地从 1 降到 0.45（屏息）→ 爆发：瞬间砸到 0.12 定格 → 渐渐恢复。
 * 模拟与粒子都乘这个系数，所以冲击波和火花会"慢放"。
 */
export function evolveTimeScale(t: number): number {
  if (t < 0 || t >= EVOLVE_TOTAL) return 1
  if (t < EVOLVE_CHARGE) return 1 - 0.55 * smooth(t / EVOLVE_CHARGE)
  const u = t - EVOLVE_CHARGE
  if (u < EVOLVE_HOLD) return EVOLVE_FLOOR
  const r = (u - EVOLVE_HOLD) / EVOLVE_RAMP
  return EVOLVE_FLOOR + (1 - EVOLVE_FLOOR) * Math.pow(r, 1.6)
}

/** 进化大横幅停留的秒数（HUD 计时，暂停时不走） */
export const EVOLVE_BANNER_SECS = 2.8

/** 进化爆发时镜头的瞬间放大量（比例，0.085 = 放大 8.5%） */
export const EVOLVE_ZOOM = 0.085
