// 星尘消消乐 —— 规则引擎（纯逻辑，零依赖，可独立单测）
// 规则来源：《星尘消消乐》产品需求文档 v1.0 第 4 章
//
// 每回合流程（结合 PRD 4.2 / 4.3 / 4.4）：
//   1. 放置：方块落入选中空格，此格成为"放置位"
//   2. 消除优先：若放置后全盘已存在三连（≥3 连续同数），跳过合成直接进入消除流程
//      （不消除优先则三连永远无法形成：合成终止时放置位旁必无同数，见 mergeUntilStable 证明）
//   3. 合成：向放置位方向合并——旁邻同数被吸收、放置格翻倍，链式循环至无同数旁邻
//   4. 消除：全盘扫描所有三连组（行 + 列，并行处理、并集去重）→ 置空 → 重力下落 → 再扫描（连锁，段数 +1）
//   5. 计分：放置 +5（未触发任何事件）；合成 10×等级×2^(段-1)；消除 50×等级×段
//   6. 死局：棋盘无空格（每回合结束后盘面无三连，满盘即无任何可行放置，PRD 4.6.1 的
//      "且无可合并/可消除"由该不变量自动满足）

export const SIZE = 8

// 计分（PRD 4.4）
export const SCORE = {
  place: 5, // 未触发任何事件的放置
  mergeBase: 10, // 合成：10 × 等级（2 为 1 级，4 为 2 级……），连锁 ×2^(段-1)
  clearBase: 50, // 消除：50 × 等级 × 段（第 1 段 ×1，第 2 段 ×2……）
} as const

export const MAX_CHAIN = 50 // E-07：单回合连锁迭代上限兜底

/** 数字 → 等级（2→1，4→2，8→3） */
export const levelOf = (v: number): number => Math.log2(v)

/** 生成待放区方块（PRD 4.1 权重：2:60% / 4:30% / 8:10%） */
export function generateValue(): number {
  const roll = Math.random()
  if (roll < 0.6) return 2
  if (roll < 0.9) return 4
  return 8
}

/** 制造初始手牌 */
export function makeHand(count = 3): number[] {
  return Array.from({ length: count }, generateValue)
}

/** 一个三连消除组（行或列上 ≥3 连续同数） */
export interface ClearGroup {
  value: number
  cells: number[] // 组内格子索引（0~63）
}

/** 一步合成 */
export interface MergeStep {
  from: number // 被吸收的旁邻索引
  to: number // 放置位索引
  value: number // 合成后的数字
  step: number // 第几段合成（1 起）
  score: number // 本步得分（含连锁加成）
}

/** 一次下落（重力动画用：从 from 格沉到 to 格） */
export interface Fall {
  from: number
  to: number
}

/** 单段消除执行结果（段内并行：先全部置空，再统一重力） */
export interface ClearStepResult {
  groups: ClearGroup[]
  cleared: number[] // 被消除格子（去重）
  falls: Fall[] // 残余方块下落
}

/** 一段连锁消除 */
export interface ClearChain extends ClearStepResult {
  index: number // 第几段（1 起）
  score: number // 本段总得分
  value: number // 本段数字（组可能跨值，取首组）
}

export interface RoundResult {
  placed: number
  value: number
  merges: MergeStep[]
  chains: ClearChain[]
  scoreGain: number
  dead: boolean
}

/** 全盘扫描三连组：行 + 列各自扫描，返回全部 ≥3 连续同数段（组间可重叠，如十字） */
export function scanGroups(grid: number[]): ClearGroup[] {
  const groups: ClearGroup[] = []
  // 行方向
  for (let r = 0; r < SIZE; r += 1) {
    let c = 0
    while (c < SIZE) {
      const v = grid[r * SIZE + c]
      if (v === 0) {
        c += 1
        continue
      }
      let end = c + 1
      while (end < SIZE && grid[r * SIZE + end] === v) end += 1
      if (end - c >= 3) {
        const cells: number[] = []
        for (let i = c; i < end; i += 1) cells.push(r * SIZE + i)
        groups.push({ value: v, cells })
      }
      c = end
    }
  }
  // 列方向
  for (let c = 0; c < SIZE; c += 1) {
    let r = 0
    while (r < SIZE) {
      const v = grid[r * SIZE + c]
      if (v === 0) {
        r += 1
        continue
      }
      let end = r + 1
      while (end < SIZE && grid[end * SIZE + c] === v) end += 1
      if (end - r >= 3) {
        const cells: number[] = []
        for (let i = r; i < end; i += 1) cells.push(i * SIZE + c)
        groups.push({ value: v, cells })
      }
      r = end
    }
  }
  return groups
}

/** 是否存在三连（消除优先判定） */
export function hasClearGroup(grid: number[]): boolean {
  return scanGroups(grid).length > 0
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE
}

/** 查找放置位四邻中第一个同数旁邻（顺序：上、右、下、左），无则 -1 */
export function findMergeNeighbor(grid: number[], idx: number): number {
  const r = Math.floor(idx / SIZE)
  const c = idx % SIZE
  const v = grid[idx]
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [r - 1, c],
    [r, c + 1],
    [r + 1, c],
    [r, c - 1],
  ]
  for (const [nr, nc] of dirs) {
    if (inBounds(nr, nc) && grid[nr * SIZE + nc] === v) return nr * SIZE + nc
  }
  return -1
}

/** 重力：每列方块向列底沉落（PRD 4.3.3），返回每颗方块的下落映射 */
export function applyGravity(grid: number[]): Fall[] {
  const falls: Fall[] = []
  for (let c = 0; c < SIZE; c += 1) {
    let write = SIZE - 1
    for (let r = SIZE - 1; r >= 0; r -= 1) {
      const v = grid[r * SIZE + c]
      if (v !== 0) {
        if (write !== r) {
          grid[write * SIZE + c] = v
          grid[r * SIZE + c] = 0
          falls.push({ from: r * SIZE + c, to: write * SIZE + c })
        }
        write -= 1
      }
    }
  }
  return falls
}

/**
 * 执行一段消除：全盘多组并行置空 → 重力下落。
 * 无三连组时返回 null，棋盘不被修改。
 */
export function stepClear(grid: number[]): ClearStepResult | null {
  const groups = scanGroups(grid)
  if (groups.length === 0) return null
  const cleared = new Set<number>()
  for (const g of groups) {
    for (const cell of g.cells) cleared.add(cell)
  }
  for (const cell of cleared) grid[cell] = 0
  const falls = applyGravity(grid)
  return { groups, cleared: [...cleared], falls }
}

/** 死局判定（PRD 4.6）：棋盘无空格 */
export function isDead(grid: number[]): boolean {
  return !grid.some((v) => v === 0)
}

/**
 * 执行一轮完整操作：放置 → 合成（消除优先）→ 消除与连锁 → 计分。
 * 就地修改 grid，返回回合详情。
 */
export function playRound(grid: number[], idx: number, value: number): RoundResult {
  const placed = idx
  grid[idx] = value
  const merges: MergeStep[] = []
  const chains: ClearChain[] = []
  let scoreGain = 0

  // ── 合成阶段（PRD 4.2，消除优先：已有三连则跳过）──
  if (!hasClearGroup(grid)) {
    let step = 0
    while (true) {
      const nb = findMergeNeighbor(grid, placed)
      if (nb < 0) break
      grid[nb] = 0 // 旁邻被吸收
      grid[placed] *= 2 // 放置格翻倍
      step += 1
      const score = SCORE.mergeBase * levelOf(grid[placed]) * 2 ** (step - 1)
      scoreGain += score
      merges.push({ from: nb, to: placed, value: grid[placed], step, score })
      if (step >= MAX_CHAIN) break // E-07 防御
    }
  }

  // ── 消除阶段（PRD 4.3，含连锁）──
  let guard = 0
  while (true) {
    const seg = stepClear(grid)
    if (seg === null) break
    const index = chains.length + 1
    let score = 0
    for (const g of seg.groups) {
      score += SCORE.clearBase * levelOf(g.value) * index
    }
    chains.push({ ...seg, index, score, value: seg.groups[0]?.value ?? 0 })
    scoreGain += score
    guard += 1
    if (guard >= MAX_CHAIN) break // E-07 防御
  }

  // ── 放置分（PRD 4.4：未触发任何合成/消除）──
  if (merges.length === 0 && chains.length === 0) scoreGain += SCORE.place

  return { placed, value, merges, chains, scoreGain, dead: isDead(grid) }
}