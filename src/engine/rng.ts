/**
 * 可播种的伪随机数（mulberry32）。
 * 模拟层一律用它，这样同一个种子能在 Node 里复现一整局，便于测试和平衡调参。
 * 纯视觉效果（粒子抖动之类）用 Math.random 即可，不要污染模拟序列。
 */
export class RNG {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9
  }

  next(): number {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [a, b) 区间的浮点数 */
  range(a: number, b: number): number {
    return a + (b - a) * this.next()
  }

  /** [a, b) 区间的整数 */
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  angle(): number {
    return this.next() * Math.PI * 2
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  /** 按权重抽取；权重 ≤ 0 的项不会被选中。 */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined {
    let total = 0
    for (const it of items) total += Math.max(0, weight(it))
    if (total <= 0) return undefined
    let r = this.next() * total
    for (const it of items) {
      r -= Math.max(0, weight(it))
      if (r <= 0) return it
    }
    return items[items.length - 1]
  }

  /** Fisher–Yates 洗牌（原地） */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const t = arr[i]
      arr[i] = arr[j]
      arr[j] = t
    }
    return arr
  }
}

/** 字符串 → 种子（用于每日挑战等） */
export function hashSeed(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
