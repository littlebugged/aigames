import type { BossId, PickupId, WeaponId } from '../data/ids'

export type PickupKind = PickupId

/**
 * 模拟层 → 渲染/音频层 的单向事件。
 * 模拟层不依赖任何 DOM，只管 emit；谁关心谁订阅（粒子、飘字、音效、震屏）。
 */
export type GameEvent =
  | { t: 'shot'; w: WeaponId; x: number; y: number; a: number; evo?: boolean }
  | { t: 'hit'; x: number; y: number; dmg: number; crit: boolean; color: string; boss: boolean }
  | { t: 'kill'; x: number; y: number; r: number; color: string; elite: boolean; big: boolean }
  | { t: 'hurt'; x: number; y: number; dmg: number }
  | { t: 'gem'; x: number; y: number; value: number }
  | { t: 'pickup'; kind: PickupKind; x: number; y: number }
  | { t: 'levelup'; level: number }
  | { t: 'dash'; x: number; y: number; a: number }
  | { t: 'blast'; x: number; y: number; r: number; color: string }
  /** 榴弹炮的炮弹落地（紧跟在一次 blast 之后）：渲染层在这里补扬尘与更重的震屏 */
  | { t: 'shellLand'; x: number; y: number; r: number; evo: boolean }
  /** 敌方的落地爆炸（陨火、熔渣团、震地）：渲染层在地面上留下焦痕与烟，blast 事件负责闪光与震屏 */
  | { t: 'scorch'; x: number; y: number; r: number }
  /** 虹吸索回血（每 0.6 秒汇总一次，n 为整数点数） */
  | { t: 'heal'; x: number; y: number; n: number }
  | { t: 'spark'; x: number; y: number; color: string; n: number }
  | { t: 'warn'; key: string; sev: 1 | 2 }
  /** mini：0 = 正主；1 / 2 = 小 Boss（先遣体）的强度档 */
  | { t: 'boss'; id: BossId; what: 'spawn' | 'phase' | 'dead' | 'retire'; mini?: number }
  | { t: 'revive'; x: number; y: number }
  | { t: 'evolve'; w: WeaponId }
  /** 进化冲击波引爆（选卡之后 EVOLVE_SHOCK.delay 秒）：渲染层在这一刻放大招 */
  | { t: 'evolveBoom'; w: WeaponId }
  | { t: 'toast'; key: string; n?: number }
  /** 浪涌：每一波结束前以飞船为圆心扫出的清场冲击波（n = 第几波） */
  | { t: 'surge'; x: number; y: number; r: number; n: number }
  /** 一波开始：n / total = 第几波 / 共几波，tag = 波的主题（横幅用） */
  | { t: 'wave'; n: number; total: number; tag: string; mini: boolean }
  /** 引力井张开 */
  | { t: 'well'; x: number; y: number; r: number }
  /** 伏击预警：屏幕边缘亮出箭头，指出接下来攻势压来的方向（弧度，可能有多个） */
  | { t: 'ambush'; angles: number[]; t0: number }
  /** 群杀播报：0.6 秒内击杀数突增（n = 窗口内击杀数，tier 1~5） */
  | { t: 'multi'; n: number; tier: number }
  | { t: 'end'; won: boolean }

export type EventSink = (e: GameEvent) => void
