// 星尘消消乐 —— 配置与工具（渲染 / 存储层；规则见 engine.ts）

export const GAME_W = 960
export const GAME_H = 720

// 棋盘：8×8，每格 56px + 8px 间距 → 内容区 504×504
export const BOARD_SIZE = 8
export const CELL = 56
export const GAP = 8
export const BOARD_PX = BOARD_SIZE * CELL + (BOARD_SIZE - 1) * GAP
export const BOARD_X = (GAME_W - BOARD_PX) / 2
export const BOARD_Y = 140

// 待放区：底部 3 个槽位（棋盘底 644 之下）
export const HAND_SIZE = 3
export const HAND_SLOT = 64
export const HAND_GAP = 20
export const HAND_Y = 682

// 配色（深空星云主题，PRD 1.3：深蓝紫渐变 + 辉光粒子）
export const COLOR = {
  bgTop: 0x070b1f,
  bgBottom: 0x160f38,
  boardBg: 0x0b1028,
  cellBg: 0x161d45,
  cellBorder: 0x27305f,
  cellHover: 0x2c3a7a,
  text: 0xeaf0ff,
  textDim: 0x9aa3d0,
  accent: 0x8ad8ff,
  warn: 0xff7d9c,
  gold: 0xffd166,
  slotBg: 0x161d45,
} as const

/** 数字 → 渐变色（2 淡青 → 金 → 紫，PRD 1.3 视觉） */
export const TILE_COLORS: Record<number, readonly [number, number]> = {
  2: [0x123a5e, 0x3fb1ff],
  4: [0x0e4a4a, 0x2fe6c8],
  8: [0x124a34, 0x3fe68a],
  16: [0x40500e, 0xaee02f],
  32: [0x54400e, 0xe0b52f],
  64: [0x5a320e, 0xe08a2f],
  128: [0x5c200e, 0xe05b2f],
  256: [0x54100e, 0xe0455a],
  512: [0x42124f, 0xb04ae0],
  1024: [0x2a1358, 0x7d4ae0],
} as const

export const FONT = '"PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'

// 本地存储（key 与主页卡片 data-best-key 对应；E-09 降级见 storeGet/storeSet）
export const STORE = {
  best: 'stardust-merge:best',
  recent: 'stardust-merge:recent',
  muted: 'stardust-merge:muted',
  tutorial: 'stardust-merge:tutorial',
} as const

export interface RecentRecord {
  score: number
  maxCombo: number
  date: number // epoch ms
}

// ── 工具函数（与项目其他游戏一致）──────────────────────────────
export const rand = (min: number, max: number): number => min + Math.random() * (max - min)
export const randInt = (min: number, max: number): number => Math.floor(rand(min, max + 1))
export const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** 安全读写 localStorage（E-09：不可用则降级为内存态，游戏仍可玩） */
const mem = new Map<string, string>()

export function storeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return mem.get(key) ?? null
  }
}

export function storeSet(key: string, val: string): void {
  try {
    localStorage.setItem(key, val)
  } catch {
    mem.set(key, val)
  }
}

export function loadBest(): number {
  return Number(storeGet(STORE.best) ?? 0) || 0
}

export function saveBest(score: number): void {
  storeSet(STORE.best, String(score))
}

export function loadRecent(): RecentRecord[] {
  try {
    const raw = JSON.parse(storeGet(STORE.recent) ?? '[]') as unknown
    return Array.isArray(raw) ? (raw as RecentRecord[]) : []
  } catch {
    return []
  }
}

export function pushRecent(rec: RecentRecord): RecentRecord[] {
  const list = [rec, ...loadRecent()].slice(0, 10)
  storeSet(STORE.recent, JSON.stringify(list))
  return list
}