// 星穹守卫 Star Vanguard —— 全局配置与工具函数
// 数值均来自 PRD v1.0（2.2~2.10 各节），按模块聚合便于二次开发调整

export const GAME_W = 960
export const GAME_H = 720

export const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

export const BEST_KEY = 'star-vanguard:best'

// ── 玩家（2.3）───────────────────────────────────────────────
export const PLAYER = {
  speed: 430, // px/s 左右移动
  startLives: 3,
  maxLives: 5,
  invincibleMs: 1600, // 受击后无敌帧
  fireCooldown: 1000 / 3, // 自动射击间隔 ms（1 秒 3 发）
  rapidCooldown: 130, // 速射冷却 ms
  doubleMs: 8000, // 双发持续
  rapidMs: 8000, // 速射持续
  bulletSpeed: 700,
} as const

// ── 敌人（2.4）───────────────────────────────────────────────
export const ENEMY = {
  ufoBulletSpeed: 220,
  bossMaxHpBase: 200, // 第 3 波
  bossMaxHpFrom6: 300, // 第 6 波起
  bossMaxHpStep: 100,
  bossMaxHpCap: 600,
  bossScore: 500,
  bossTop: 90, // 悬浮 y 范围
  bossBottom: 110,
  bossMoveSpeed: 60, // 水平正弦速度 px/s
  bossFireDelay: 2000, // 进场后开炮延迟
  bossRingInterval: 1600, // 环形散射
  bossRingCount: 12,
  bossRingSpeed: 180,
  bossFanInterval: 2200, // 扇形齐射
  bossFanShots: 5,
  bossFanGapMs: 90,
  bossFanSpeed: 300,
  bossFanArc: 20, // 扇形 ±角度
} as const

export type EnemyKind = 'asteroidL' | 'asteroidS' | 'ufo' | 'dart' | 'boss'

export type EnemyDef = {
  kind: EnemyKind
  hp: number
  score: number
}

export const ENEMY_DEFS: Record<Exclude<EnemyKind, 'boss'>, EnemyDef> = {
  asteroidL: { kind: 'asteroidL', hp: 2, score: 20 },
  asteroidS: { kind: 'asteroidS', hp: 1, score: 10 },
  ufo: { kind: 'ufo', hp: 3, score: 40 },
  dart: { kind: 'dart', hp: 1, score: 30 },
}

// ── 波次（2.5）───────────────────────────────────────────────
export const WAVE = {
  spawnIntervalBase: 1900,
  spawnIntervalMin: 800,
  spawnIntervalStep: 120,
  minionsBase: 4,
  minionsMax: 10, // 4 + min(n, 6)
  bossEvery: 3, // n % 3 === 0 为 Boss 波
  clearDelayMs: 1500, // 清场后进下一波提示
  maxAlive: 24, // 同屏上限
  bossWaveMinions: 2, // Boss 波的少量杂兵
} as const

// ── 道具（2.7）───────────────────────────────────────────────
export const POWER = {
  dropChance: 0.12, // 敌机掉落概率
  fallSpeed: 120,
  pickupRadius: 22,
  fullLifeBonus: 50, // 满血拾取生命 +50 分
} as const

export type PowerKind = 'life' | 'double' | 'shield' | 'rapid'

// ── 表现（2.10）──────────────────────────────────────────────
export const FX = {
  starLayers: [
    { speed: 20, count: 26, sizeMin: 1, sizeMax: 2, alpha: 0.35 },
    { speed: 60, count: 20, sizeMin: 1.5, sizeMax: 2.5, alpha: 0.55 },
    { speed: 134, count: 14, sizeMin: 2, sizeMax: 3.5, alpha: 0.9 },
  ],
  lowFpsThreshold: 30, // E7：低于该帧率进入降级
  warnFlashes: 3,
  warnMs: 2000,
  menuDebounceMs: 300, // E9
} as const

export const COLOR = {
  bg: 0x0b0d12,
  player: 0x4cc9f0,
  playerDark: 0x2a9fd4,
  bullet: 0x9ff3ff,
  enemyBullet: 0xff4f9a,
  asteroid: 0x8b7d6b,
  asteroidDark: 0x5a4f44,
  ufo: 0x7b61ff,
  ufoDome: 0x9fe8ff,
  dart: 0xff9f43,
  boss: 0xff3d6e,
  bossDark: 0x8f1e3f,
  power: 0x7dff8f,
  text: 0xe9edf6,
  textDim: 0x8b95ab,
} as const

// ── 工具函数（与项目其他游戏一致）──────────────────────────────
export const rand = (min: number, max: number): number => min + Math.random() * (max - min)
export const randInt = (min: number, max: number): number => Math.floor(rand(min, max + 1))
export const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))