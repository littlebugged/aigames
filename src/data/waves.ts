import type { BossId, EnemyId } from './ids'

/**
 * 波次脚本（v1.14 割草·波次）。
 *
 * 一个星区 = 12 波 + Boss。每一波由若干「脉冲」组成：一个脉冲就是一整群杂兵按某种阵型同时压上来，
 * 玩家用范围大 / 数量多的武器把它整片割掉，喘口气，下一个脉冲再来——"一波波的攻势被一波波杀掉"。
 * 特殊兵种（小队）与精英夹在脉冲之间出场，小 Boss 在固定的波次登场。
 * 每一波结束时放一道「浪涌」清掉剩下的杂兵，然后弹出本波攒下的升级卡（升级的节奏就是波的节奏）。
 */

/** 波的主题（只影响开场横幅的名字） */
export const WAVE_TAGS = ['open', 'tide', 'pincer', 'stampede', 'ambush', 'siege', 'storm', 'mini', 'finale'] as const
export type WaveTag = (typeof WAVE_TAGS)[number]

/**
 * 阵型：
 *  ring    以玩家为圆心的合围圈，同时收拢；
 *  wall    一整面墙，从一个方向推过来（太宽就排成几行）；
 *  pincer  两面墙，从相反的方向夹击；
 *  stream  一股人流从一个方向持续涌入；
 *  burst   若干团密集的小怪团从不同方向冲来；
 *  spiral  刷怪点绕着玩家转一圈，像旋臂一样卷过来；
 *  lanes   几列纵队并排压过来；
 *  strike  陨火打击（熔炉星环）：地面预警圈依次砸落；
 *  well    引力井（虚空）：把玩家和杂兵一起往中心拽。
 */
export const FORMS = ['ring', 'wall', 'pincer', 'stream', 'burst', 'spiral', 'lanes', 'strike', 'well'] as const
export type Form = (typeof FORMS)[number]

export interface PulseDef {
  form: Form
  /** 刷什么（strike / well 不需要） */
  enemy?: EnemyId
  /** 数量权重：实际数量 = waveUnit(第几波) × w × 星区密度 × 威胁倍率 */
  w: number
  /** 每 5 只里有 1 只换成这个（杂兵里混几只别的） */
  mix?: EnemyId
  /** strike：陨火数；well：引力井数 */
  n?: number
  /** 伏击：提前这么多秒在屏幕边缘亮出预警箭头，然后才刷出 */
  warn?: number
}

/** 特殊兵种小队：夹在脉冲之间出场，成群的重甲 / 狙击 / 冲锋 / 自爆…… */
export interface SquadDef {
  enemy: EnemyId
  n: number
  elite?: boolean
  /** 跟在第几个脉冲之后 3 秒出场（0 起，缺省 1） */
  after?: number
}

export interface WaveDef {
  tag: WaveTag
  /** 本波时长（秒）；一个星区所有波之和 = 星区总时长 */
  len: number
  pulses: PulseDef[]
  squads?: SquadDef[]
}

/** 小 Boss 的出场计划：第几波（1 起）· 用哪个 Boss 的缩小版 · 强度档（1 / 2） */
export interface MiniPlan {
  wave: number
  boss: BossId
  tier: 1 | 2
}

export const WAVE = {
  /** 每波的杂兵"单位量"：waveUnit(k) = base × growth^(k-1)；脉冲数量 = 单位量 × 权重 × 星区密度 */
  unitBase: 26,
  unitGrowth: 1.16,
  /** 单个脉冲的数量上限（场上同时存在的敌人另有 maxEnemies 的上限） */
  maxPulse: 230,
  /** 第一个脉冲距波首的秒数；最后一个脉冲距波尾至少这么远 */
  firstAt: 2,
  lastGap: 14,
  /** 波尾前多少秒放"浪涌"（扫清剩下的杂兵，随后弹出升级卡） */
  sweepLead: 5,
  /** 小 Boss 登场距波首的秒数 */
  miniAt: 4,
  /** 有 Boss（含小 Boss）在场时，脉冲规模的系数 */
  bossScale: 0.5,
  /** Boss 战里每隔多少秒补一波杂兵（让 Boss 战里也有割草），场上杂兵数的上限 */
  addsEvery: 18,
  addsCap: 130,
  /** 补兵的单位量取第几波的规模 */
  addsWave: 9,
  /** 脉冲出场时的"冲刺"倍率（直到进入画面附近）：让攻势来得干脆，不用干等 */
  rush: 1.9,
}

export const waveUnit = (wave: number): number => WAVE.unitBase * WAVE.unitGrowth ** (Math.max(1, wave) - 1)

// ───────────────────────── 脚本 ─────────────────────────

const P = (form: Form, enemy: EnemyId, w: number, o: Partial<PulseDef> = {}): PulseDef => ({ form, enemy, w, ...o })
const S = (enemy: EnemyId, n: number, o: Partial<SquadDef> = {}): SquadDef => ({ enemy, n, ...o })
const W = (tag: WaveTag, len: number, pulses: PulseDef[], squads: SquadDef[] = []): WaveDef => ({ tag, len, pulses, squads })

/** 霓虹原野：纯粹的割草——杂兵人潮的各种阵型，特殊兵种一种一种地认识 */
export const WAVES_FIELDS: WaveDef[] = [
  W('open', 40, [P('stream', 'drone', 1.0), P('ring', 'swarmer', 1.1), P('stream', 'drone', 1.2), P('burst', 'swarmer', 1.3)]),
  W('tide', 50, [P('wall', 'drone', 1.3), P('ring', 'swarmer', 1.4), P('stream', 'swarmer', 1.4), P('burst', 'drone', 1.5)], [S('shooter', 2, { after: 2 })]),
  W('pincer', 50, [P('pincer', 'drone', 1.5), P('burst', 'swarmer', 1.5), P('stream', 'drone', 1.5), P('ring', 'swarmer', 1.7)], [S('charger', 2), S('shooter', 1, { after: 3 })]),
  W('mini', 50, [P('burst', 'swarmer', 1.4), P('stream', 'drone', 1.3), P('ring', 'swarmer', 1.4), P('wall', 'drone', 1.3)], [S('shooter', 2, { after: 0 })]),
  W('stampede', 50, [P('lanes', 'drone', 1.8), P('ring', 'swarmer', 1.8), P('lanes', 'swarmer', 1.8), P('pincer', 'drone', 1.8)], [S('brute', 2), S('shooter', 2, { after: 3 })]),
  W('siege', 50, [P('ring', 'swarmer', 1.9), P('wall', 'drone', 1.8, { mix: 'swarmer' }), P('burst', 'swarmer', 2.0), P('ring', 'drone', 1.9)], [S('brute', 1, { elite: true }), S('charger', 3, { after: 3 })]),
  W('tide', 50, [P('pincer', 'swarmer', 2.1), P('ring', 'drone', 2.0), P('wall', 'swarmer', 2.0), P('burst', 'drone', 2.2)], [S('splitter', 3), S('shooter', 3, { after: 2 })]),
  W('mini', 50, [P('ring', 'swarmer', 1.7), P('stream', 'drone', 1.6), P('burst', 'swarmer', 1.7), P('wall', 'drone', 1.6)], [S('shielder', 2), S('charger', 2, { after: 2 })]),
  W('storm', 50, [P('spiral', 'swarmer', 2.3), P('ring', 'swarmer', 2.2), P('lanes', 'drone', 2.2), P('pincer', 'swarmer', 2.3)], [S('brute', 3), S('shielder', 2, { after: 2 }), S('charger', 3, { after: 3 })]),
  W('siege', 50, [P('ring', 'swarmer', 2.4), P('wall', 'drone', 2.3, { mix: 'swarmer' }), P('burst', 'swarmer', 2.4), P('ring', 'drone', 2.4)], [S('splitter', 2, { elite: true }), S('bomber', 4, { after: 2 }), S('shooter', 4, { after: 3 })]),
  W('stampede', 50, [P('lanes', 'swarmer', 2.5), P('pincer', 'drone', 2.5), P('ring', 'swarmer', 2.6), P('spiral', 'drone', 2.5)], [S('shielder', 3), S('brute', 3, { after: 2 }), S('charger', 4, { after: 3 })]),
  W('finale', 60, [P('ring', 'swarmer', 2.6), P('wall', 'drone', 2.6, { mix: 'swarmer' }), P('pincer', 'swarmer', 2.7), P('burst', 'drone', 2.7), P('spiral', 'swarmer', 2.8)], [S('brute', 1, { elite: true }), S('shielder', 3, { after: 1 }), S('brute', 3, { after: 2 }), S('shooter', 4, { after: 3 }), S('bomber', 4, { after: 4 })]),
]

/** 数据荒原：伏击——攻势从屏幕边缘的预警箭头所指的方向压来，幽灵会瞬移到你背后 */
export const WAVES_WASTELAND: WaveDef[] = [
  W('open', 40, [P('stream', 'drone', 1.0), P('pincer', 'swarmer', 1.1, { warn: 1.8 }), P('stream', 'drone', 1.2), P('burst', 'swarmer', 1.3)]),
  W('ambush', 50, [P('pincer', 'drone', 1.4, { warn: 1.8 }), P('ring', 'swarmer', 1.4), P('lanes', 'swarmer', 1.5, { warn: 1.8 }), P('burst', 'drone', 1.5)], [S('wraith', 2), S('shooter', 1, { after: 2 })]),
  W('tide', 50, [P('wall', 'drone', 1.6, { warn: 1.8 }), P('ring', 'swarmer', 1.6), P('pincer', 'swarmer', 1.7, { warn: 1.8 }), P('stream', 'drone', 1.6)], [S('splitter', 2), S('wraith', 2, { after: 3 })]),
  W('mini', 50, [P('burst', 'swarmer', 1.5), P('stream', 'drone', 1.4), P('pincer', 'swarmer', 1.4, { warn: 1.8 }), P('ring', 'drone', 1.4)], [S('shooter', 2, { after: 0 }), S('wraith', 2, { after: 2 })]),
  W('ambush', 50, [P('lanes', 'drone', 1.9, { warn: 1.8 }), P('ring', 'swarmer', 1.9), P('pincer', 'swarmer', 2.0, { warn: 1.8 }), P('burst', 'drone', 2.0)], [S('wraith', 3), S('charger', 2, { after: 2 }), S('shooter', 2, { after: 3 })]),
  W('siege', 50, [P('ring', 'swarmer', 2.0), P('pincer', 'drone', 2.0, { warn: 1.8 }), P('wall', 'swarmer', 2.0, { warn: 1.8 }), P('stream', 'drone', 2.0)], [S('splitter', 1, { elite: true }), S('wraith', 3, { after: 2 })]),
  W('stampede', 50, [P('lanes', 'swarmer', 2.2, { warn: 1.8 }), P('ring', 'drone', 2.2), P('pincer', 'swarmer', 2.3, { warn: 1.8 }), P('burst', 'drone', 2.3)], [S('brute', 2), S('splitter', 3, { after: 2 }), S('wraith', 3, { after: 3 })]),
  W('mini', 50, [P('ring', 'swarmer', 1.9), P('pincer', 'drone', 1.8, { warn: 1.8 }), P('burst', 'swarmer', 1.9), P('stream', 'drone', 1.7)], [S('shielder', 2), S('shooter', 3, { after: 2 }), S('wraith', 2, { after: 3 })]),
  W('ambush', 50, [P('pincer', 'swarmer', 2.4, { warn: 1.8 }), P('lanes', 'drone', 2.4, { warn: 1.8 }), P('ring', 'swarmer', 2.4), P('burst', 'drone', 2.5)], [S('brute', 2), S('wraith', 4, { after: 2 }), S('charger', 3, { after: 3 })]),
  W('storm', 50, [P('spiral', 'swarmer', 2.6), P('pincer', 'drone', 2.5, { warn: 1.8 }), P('ring', 'swarmer', 2.6), P('wall', 'swarmer', 2.5, { warn: 1.8 })], [S('wraith', 1, { elite: true }), S('splitter', 4, { after: 2 }), S('shielder', 2, { after: 3 })]),
  W('siege', 50, [P('lanes', 'swarmer', 2.7, { warn: 1.8 }), P('ring', 'drone', 2.7), P('pincer', 'swarmer', 2.8, { warn: 1.8 }), P('burst', 'swarmer', 2.8)], [S('brute', 3), S('wraith', 4, { after: 2 }), S('shooter', 4, { after: 3 }), S('charger', 3, { after: 3 })]),
  W('finale', 60, [P('ring', 'swarmer', 2.8), P('pincer', 'drone', 2.8, { warn: 1.8, mix: 'swarmer' }), P('lanes', 'swarmer', 2.9, { warn: 1.8 }), P('burst', 'drone', 3.0), P('spiral', 'swarmer', 3.0)], [S('splitter', 1, { elite: true }), S('wraith', 4, { after: 1 }), S('brute', 3, { after: 2 }), S('shielder', 3, { after: 3 }), S('shooter', 4, { after: 4 })]),
]

/** 虚空裂隙：引力井把一切往中心拽——把杂兵拽成一团，也别被自己拽进去；旋臂状的攻势，幽灵与自爆怪成群 */
export const WAVES_VOID: WaveDef[] = [
  W('open', 40, [P('stream', 'swarmer', 1.1), P('ring', 'swarmer', 1.2), P('spiral', 'swarmer', 1.3), P('burst', 'drone', 1.3)]),
  W('tide', 50, [P('spiral', 'swarmer', 1.6), P('ring', 'drone', 1.5), P('well', 'swarmer', 0, { n: 1 }), P('burst', 'swarmer', 1.7)], [S('wraith', 3, { after: 1 })]),
  W('storm', 50, [P('ring', 'swarmer', 1.8), P('spiral', 'drone', 1.7), P('pincer', 'swarmer', 1.8), P('burst', 'swarmer', 1.8)], [S('wraith', 2), S('shooter', 2, { after: 2 })]),
  W('mini', 50, [P('burst', 'swarmer', 1.6), P('well', 'swarmer', 0, { n: 1 }), P('spiral', 'drone', 1.5), P('ring', 'swarmer', 1.6)], [S('bomber', 3, { after: 0 }), S('wraith', 2, { after: 2 })]),
  W('siege', 50, [P('ring', 'swarmer', 2.1), P('spiral', 'swarmer', 2.1), P('well', 'drone', 0, { n: 2 }), P('lanes', 'swarmer', 2.2)], [S('shooter', 3), S('charger', 2, { after: 2 }), S('wraith', 3, { after: 3 })]),
  W('tide', 50, [P('spiral', 'drone', 2.3, { mix: 'swarmer' }), P('ring', 'swarmer', 2.3), P('burst', 'swarmer', 2.4), P('pincer', 'drone', 2.3)], [S('bomber', 4), S('splitter', 1, { elite: true, after: 2 })]),
  W('storm', 50, [P('ring', 'swarmer', 2.5), P('well', 'swarmer', 0, { n: 2 }), P('spiral', 'swarmer', 2.5), P('burst', 'drone', 2.5)], [S('wraith', 4), S('brute', 2, { after: 2 }), S('shooter', 3, { after: 3 })]),
  W('mini', 50, [P('spiral', 'swarmer', 2.1), P('ring', 'drone', 2.0), P('well', 'swarmer', 0, { n: 1 }), P('burst', 'swarmer', 2.1)], [S('shielder', 2), S('bomber', 4, { after: 2 }), S('wraith', 3, { after: 3 })]),
  W('siege', 50, [P('ring', 'swarmer', 2.8), P('spiral', 'swarmer', 2.7), P('burst', 'drone', 2.8), P('pincer', 'swarmer', 2.8)], [S('wraith', 1, { elite: true }), S('brute', 3, { after: 2 }), S('shielder', 3, { after: 3 })]),
  W('storm', 50, [P('spiral', 'swarmer', 3.0), P('well', 'drone', 0, { n: 2 }), P('ring', 'swarmer', 3.0), P('lanes', 'swarmer', 3.0)], [S('bomber', 5), S('charger', 3, { after: 2 }), S('shooter', 4, { after: 3 })]),
  W('tide', 50, [P('ring', 'swarmer', 3.1), P('spiral', 'drone', 3.1, { mix: 'swarmer' }), P('burst', 'swarmer', 3.2), P('well', 'swarmer', 0, { n: 3 })], [S('wraith', 5), S('shielder', 3, { after: 2 }), S('brute', 3, { after: 3 })]),
  W('finale', 60, [P('ring', 'swarmer', 3.2), P('spiral', 'swarmer', 3.2), P('well', 'drone', 0, { n: 2 }), P('burst', 'drone', 3.3), P('ring', 'swarmer', 3.4)], [S('brute', 1, { elite: true }), S('wraith', 5, { after: 1 }), S('bomber', 5, { after: 2 }), S('shielder', 3, { after: 3 }), S('shooter', 4, { after: 4 })]),
]

/** 熔炉星环：陨火从天而降，自爆怪与护盾兵成墙推进——要边割边找落点 */
export const WAVES_CRUCIBLE: WaveDef[] = [
  W('open', 40, [P('stream', 'drone', 1.1), P('ring', 'swarmer', 1.2), P('strike', 'drone', 0, { n: 3 }), P('burst', 'swarmer', 1.4)], [S('bomber', 3, { after: 1 })]),
  W('tide', 50, [P('wall', 'drone', 1.6), P('ring', 'swarmer', 1.6), P('strike', 'drone', 0, { n: 4 }), P('burst', 'drone', 1.7)], [S('bomber', 4), S('charger', 2, { after: 2 })]),
  W('siege', 50, [P('lanes', 'swarmer', 1.9), P('ring', 'drone', 1.8), P('strike', 'drone', 0, { n: 4 }), P('stream', 'swarmer', 1.9)], [S('shooter', 2), S('shielder', 2, { after: 2 })]),
  W('mini', 50, [P('burst', 'swarmer', 1.7), P('strike', 'drone', 0, { n: 4 }), P('wall', 'drone', 1.6), P('ring', 'swarmer', 1.7)], [S('bomber', 4, { after: 0 }), S('charger', 2, { after: 2 })]),
  W('stampede', 50, [P('lanes', 'drone', 2.2), P('ring', 'swarmer', 2.2), P('strike', 'drone', 0, { n: 5 }), P('pincer', 'swarmer', 2.3)], [S('charger', 3), S('shielder', 2, { after: 2 }), S('bomber', 3, { after: 3 })]),
  W('siege', 50, [P('wall', 'drone', 2.3, { mix: 'swarmer' }), P('ring', 'swarmer', 2.3), P('strike', 'drone', 0, { n: 5 }), P('burst', 'drone', 2.4)], [S('shooter', 3), S('brute', 1, { elite: true, after: 2 })]),
  W('storm', 50, [P('ring', 'swarmer', 2.6), P('strike', 'drone', 0, { n: 6 }), P('lanes', 'swarmer', 2.6), P('spiral', 'drone', 2.6)], [S('bomber', 5), S('shielder', 3, { after: 2 }), S('wraith', 2, { after: 3 })]),
  W('mini', 50, [P('wall', 'swarmer', 2.2), P('strike', 'drone', 0, { n: 5 }), P('ring', 'drone', 2.2), P('burst', 'swarmer', 2.3)], [S('shielder', 2), S('bomber', 4, { after: 2 }), S('charger', 3, { after: 3 })]),
  W('stampede', 50, [P('lanes', 'swarmer', 3.0), P('pincer', 'drone', 2.9), P('strike', 'drone', 0, { n: 6 }), P('ring', 'swarmer', 3.0)], [S('brute', 3), S('shooter', 4, { after: 2 }), S('shielder', 3, { after: 3 })]),
  W('siege', 50, [P('wall', 'drone', 3.1, { mix: 'swarmer' }), P('ring', 'swarmer', 3.1), P('strike', 'drone', 0, { n: 7 }), P('burst', 'swarmer', 3.2)], [S('charger', 1, { elite: true }), S('bomber', 6, { after: 2 }), S('wraith', 3, { after: 3 })]),
  W('storm', 50, [P('spiral', 'swarmer', 3.3), P('strike', 'drone', 0, { n: 7 }), P('lanes', 'drone', 3.3), P('ring', 'swarmer', 3.4)], [S('shielder', 4), S('brute', 3, { after: 2 }), S('bomber', 5, { after: 3 })]),
  W('finale', 60, [P('ring', 'swarmer', 3.4), P('strike', 'drone', 0, { n: 8 }), P('wall', 'drone', 3.4, { mix: 'swarmer' }), P('pincer', 'swarmer', 3.5), P('burst', 'drone', 3.6)], [S('shielder', 1, { elite: true }), S('bomber', 6, { after: 1 }), S('brute', 3, { after: 2 }), S('charger', 4, { after: 3 }), S('shooter', 4, { after: 4 })]),
]

/** Boss 战里每隔 WAVE.addsEvery 秒补一波杂兵（按顺序轮换），让 Boss 战里也有割草 */
export const BOSS_ADDS: Record<'fields' | 'wasteland' | 'void' | 'crucible', PulseDef[]> = {
  fields: [P('ring', 'swarmer', 1.4), P('stream', 'drone', 1.3), P('burst', 'swarmer', 1.4)],
  wasteland: [P('pincer', 'swarmer', 1.4, { warn: 1.8 }), P('ring', 'drone', 1.3), P('burst', 'swarmer', 1.4)],
  void: [P('spiral', 'swarmer', 1.5), P('ring', 'drone', 1.3), P('burst', 'swarmer', 1.4)],
  crucible: [P('wall', 'drone', 1.4), P('ring', 'swarmer', 1.4), P('lanes', 'swarmer', 1.4)],
}

/** 各星区的小 Boss（都不是本星区自己的 Boss：每个星区先遇到两只别处 Boss 的「先遣体」，最后才是正主） */
export const MINIS: Record<'fields' | 'wasteland' | 'void' | 'crucible', MiniPlan[]> = {
  fields: [
    { wave: 4, boss: 'forge', tier: 1 },
    { wave: 8, boss: 'fractal', tier: 2 },
  ],
  wasteland: [
    { wave: 4, boss: 'overseer', tier: 1 },
    { wave: 8, boss: 'maw', tier: 2 },
  ],
  void: [
    { wave: 4, boss: 'fractal', tier: 1 },
    { wave: 8, boss: 'forge', tier: 2 },
  ],
  crucible: [
    { wave: 4, boss: 'maw', tier: 1 },
    { wave: 8, boss: 'overseer', tier: 2 },
  ],
}
