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
  | { t: 'spark'; x: number; y: number; color: string; n: number }
  | { t: 'warn'; key: string; sev: 1 | 2 }
  | { t: 'boss'; id: BossId; what: 'spawn' | 'phase' | 'dead' }
  | { t: 'revive'; x: number; y: number }
  | { t: 'evolve'; w: WeaponId }
  /** 进化冲击波引爆（选卡之后 EVOLVE_SHOCK.delay 秒）：渲染层在这一刻放大招 */
  | { t: 'evolveBoom'; w: WeaponId }
  | { t: 'toast'; key: string; n?: number }
  | { t: 'end'; won: boolean }

export type EventSink = (e: GameEvent) => void
