/**
 * 空间哈希网格：每帧重建，用来做"附近有哪些敌人"的查询。
 * 实体只按圆心入桶；查询时把半径放大 maxR 来补偿实体自身大小，
 * 因此体型特别大的（Boss）不要放进来，单独处理。
 */
export interface GridItem {
  x: number
  y: number
  r: number
  /** 查询去重戳，由网格内部维护 */
  qs: number
}

const BITS = 7
const SIZE = 1 << BITS // 每轴 128 个桶，坐标按环绕取模
const MASK = SIZE - 1

export class SpatialHash<T extends GridItem> {
  private readonly inv: number
  private readonly buckets: T[][]
  private used: number[] = []
  private stamp = 0
  /** 入桶实体的最大半径，用来放大查询范围 */
  readonly maxR: number

  constructor(
    readonly cell = 96,
    maxR = 44,
  ) {
    this.inv = 1 / cell
    this.maxR = maxR
    this.buckets = Array.from({ length: SIZE * SIZE }, () => [])
  }

  clear(): void {
    const used = this.used
    for (let i = 0; i < used.length; i++) this.buckets[used[i]].length = 0
    used.length = 0
  }

  insert(e: T): void {
    const cx = Math.floor(e.x * this.inv)
    const cy = Math.floor(e.y * this.inv)
    const idx = ((cy & MASK) << BITS) | (cx & MASK)
    const b = this.buckets[idx]
    if (b.length === 0) this.used.push(idx)
    b.push(e)
  }

  /**
   * 把与圆 (x,y,r) 可能相交的实体追加进 out（已做距离精筛，含实体自身半径）。
   * 返回 out 方便链式使用。
   */
  query(x: number, y: number, r: number, out: T[]): T[] {
    const reach = r + this.maxR
    const x0 = Math.floor((x - reach) * this.inv)
    const x1 = Math.floor((x + reach) * this.inv)
    const y0 = Math.floor((y - reach) * this.inv)
    const y1 = Math.floor((y + reach) * this.inv)
    const stamp = ++this.stamp
    for (let cy = y0; cy <= y1; cy++) {
      const row = (cy & MASK) << BITS
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets[row | (cx & MASK)]
        for (let i = 0; i < b.length; i++) {
          const e = b[i]
          if (e.qs === stamp) continue
          e.qs = stamp
          const dx = e.x - x
          const dy = e.y - y
          const rr = r + e.r
          if (dx * dx + dy * dy <= rr * rr) out.push(e)
        }
      }
    }
    return out
  }

  /** 最近的一个实体（可带过滤），找不到返回 undefined。 */
  nearest(x: number, y: number, maxDist: number, filter?: (e: T) => boolean): T | undefined {
    const reach = maxDist + this.maxR
    const x0 = Math.floor((x - reach) * this.inv)
    const x1 = Math.floor((x + reach) * this.inv)
    const y0 = Math.floor((y - reach) * this.inv)
    const y1 = Math.floor((y + reach) * this.inv)
    const stamp = ++this.stamp
    let best: T | undefined
    let bestD = maxDist * maxDist
    for (let cy = y0; cy <= y1; cy++) {
      const row = (cy & MASK) << BITS
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets[row | (cx & MASK)]
        for (let i = 0; i < b.length; i++) {
          const e = b[i]
          if (e.qs === stamp) continue
          e.qs = stamp
          if (filter && !filter(e)) continue
          const dx = e.x - x
          const dy = e.y - y
          const d = dx * dx + dy * dy
          if (d < bestD) {
            bestD = d
            best = e
          }
        }
      }
    }
    return best
  }
}
