import type { AchDef, AchMetric } from '../data/achievements'
import { h } from './dom'
import { UI_ICON, type UiIconName } from './icons'

/**
 * 勋章：六边形的切面金属底座 + 中央徽记。成就页、结算页共用。
 *
 * 语言和局内精灵 / 图标一致——哑光硬表面：墨线外廓，金属框用"亮面 / 暗面"的半透明切面叠出倒角
 * （光源在左上），里面一块深色面板托着徽记，面板边缘是反向的内倒角（凹进去的感觉）。没有任何发光。
 *
 * 档位由奖励晶核决定：铜 ≤40、银 ≤100、金 ≤250、其余是等离子（最难的几个）。
 * 档位同时用"颜色 + 面板底部的点数（1~4）"表达，色觉不同的玩家也分得清。
 * 配色全部在 CSS（`.medal` 的 --m / --f / --g），这里只产出结构，所以能在 Node 里直接测试。
 */

export type MedalTier = 'bronze' | 'silver' | 'gold' | 'plasma'
export const MEDAL_TIERS: readonly MedalTier[] = ['bronze', 'silver', 'gold', 'plasma']

export const medalTier = (reward: number): MedalTier => (reward <= 40 ? 'bronze' : reward <= 100 ? 'silver' : reward <= 250 ? 'gold' : 'plasma')

/** 每类成就指标用哪个徽记 */
export const MEDAL_EMBLEM: Record<AchMetric, UiIconName> = {
  runTime: 'clock',
  runKills: 'crosshair',
  runLevel: 'chevrons',
  runEvolves: 'evolve',
  runWeapons: 'rack',
  runNoHit: 'shield',
  runDashes: 'dash',
  totalKills: 'skull',
  totalRuns: 'flag',
  totalCores: 'core',
  bossFields: 'bossEye',
  bossWasteland: 'bossFractal',
  bossVoid: 'bossMaw',
  bossCrucible: 'bossForge',
  clearThreat: 'flame',
}

export type MedalSize = 'sm' | 'md' | 'lg'
/** 勋章配色：四个档位，外加结算页用的 danger（战败） */
export type MedalPalette = MedalTier | 'danger'

// ───────────────────────── 几何（画布 64×74，中心 32,37） ─────────────────────────

const CX = 32
const CY = 37
const num = (v: number): string => String(Math.round(v * 100) / 100)
type P = [number, number]
const pt = (r: number, deg: number): P => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)]
/** 尖顶正六边形的六个顶点：上、右上、右下、下、左下、左上 */
const hexPts = (r: number): P[] => [-90, -30, 30, 90, 150, 210].map((a) => pt(r, a))
const d = (v: P[]): string => `M${v.map(([x, y]) => `${num(x)} ${num(y)}`).join('L')}Z`
const shape = (cls: string, v: P[]): string => `<path class="${cls}" d="${d(v)}"/>`
const overlay = (v: P[], white: boolean, a: number): string => `<path d="${d(v)}" fill="${white ? '#fff' : '#000'}" fill-opacity="${a}"/>`

/** 两个同心六边形之间的 6 块梯形（第 i 块对应第 i 条边：0 右上斜边，1 右竖边，2 右下斜边，3 左下斜边，4 左竖边，5 左上斜边） */
const ringQuads = (rOut: number, rIn: number): P[][] => {
  const o = hexPts(rOut)
  const i = hexPts(rIn)
  return o.map((_, k) => [o[k], o[(k + 1) % 6], i[(k + 1) % 6], i[k]])
}

/** 金属框：每条边一块切面，亮面朝左上、暗面朝右下 */
const RIM_TONES: [boolean, number][] = [
  [true, 0.2],
  [false, 0.2],
  [false, 0.36],
  [false, 0.1],
  [true, 0.3],
  [true, 0.52],
]
/** 面板内缘的反向倒角：左上边压暗、右下边提亮（凹进去的一圈） */
const LIP_TONES: [boolean, number][] = [
  [false, 0.2],
  [true, 0.16],
  [true, 0.26],
  [true, 0.1],
  [false, 0.3],
  [false, 0.5],
]

const R_INK = 36.6
const R_RIM = 35.4
const R_RIM_IN = 28.6
const R_FACE = 26.8
const EMBLEM_K = 1.4

/** 勋章的 SVG 标记（不含配色，由外层 .medal 的 CSS 变量决定）。pips = 面板底部的点数（档位 1~4；0 表示不画） */
export function medalSvg(emblem: UiIconName, pips = 0): string {
  const rim = ringQuads(R_RIM, R_RIM_IN).map((q, k) => overlay(q, ...RIM_TONES[k]))
  const lip = ringQuads(R_RIM_IN, R_FACE).map((q, k) => overlay(q, ...LIP_TONES[k]))
  const face = hexPts(R_FACE)
  // 面板左上方的一块淡淡的反光（硬边，不是渐变发光）
  const sheen: P[] = [face[5], face[0], [face[0][0] + 9, face[0][1] + 15.6], [CX - 3, CY - 2], [face[5][0] + 1, face[5][1] + 8]]
  const dots = Array.from({ length: pips }, (_, i) => {
    const x = CX + (i - (pips - 1) / 2) * 4.6
    return `<path class="mf-pip" d="M${num(x)} 55.4l1.7 1.7l-1.7 1.7l-1.7 -1.7Z"/>`
  })
  const k = EMBLEM_K
  const at = `translate(${num(CX - 12 * k)} ${num(CY - 1.4 - 12 * k)}) scale(${k})`
  const inner = UI_ICON[emblem]
  return (
    `<svg class="medal-art" viewBox="0 0 64 74" fill="currentColor" stroke="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    shape('mf-ink', hexPts(R_INK)) +
    shape('mf-metal', hexPts(R_RIM)) +
    rim.join('') +
    shape('mf-lip', hexPts(R_RIM_IN)) +
    lip.join('') +
    shape('mf-face', face) +
    overlay(sheen, true, 0.07) +
    // 徽记的投影：同一个图形压暗后向下错 1 格，像刻在面板上
    `<g class="mf-sh" style="color:#000" opacity="0.5" transform="translate(0 1.4) ${at}">${inner}</g>` +
    `<g transform="${at}">${inner}</g>` +
    dots.join('') +
    `</svg>`
  )
}

/** 任意徽记 + 配色的勋章（结算页的战果徽章也用它）：got=已获得（上色）/ 未获得（灰暗，但档位色隐约可见） */
export function medalBadge(emblem: UiIconName, palette: MedalPalette, size: MedalSize = 'md', got = true, pips = 0): HTMLElement {
  return h('span', { class: `medal ${size} tier-${palette} ${got ? 'got' : 'lock'}`, 'aria-hidden': 'true', html: medalSvg(emblem, pips) })
}

/** 一枚成就勋章：档位由奖励决定，徽记由成就指标决定 */
export function medalEl(a: Pick<AchDef, 'metric' | 'reward'>, got: boolean, size: MedalSize = 'md'): HTMLElement {
  const tier = medalTier(a.reward)
  return medalBadge(MEDAL_EMBLEM[a.metric], tier, size, got, MEDAL_TIERS.indexOf(tier) + 1)
}
