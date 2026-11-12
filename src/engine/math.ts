/** 数学与格式化小工具。纯函数，无 DOM 依赖（Node 里也能跑）。 */

export const TAU = Math.PI * 2

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 帧率无关的指数阻尼：lambda 越大，逼近越快。 */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  a + (b - a) * (1 - Math.exp(-lambda * dt))

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax
  const dy = by - ay
  return dx * dx + dy * dy
}

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.sqrt(dist2(ax, ay, bx, by))

export const angleTo = (ax: number, ay: number, bx: number, by: number): number =>
  Math.atan2(by - ay, bx - ax)

/** 最短角度差（b - a），结果在 [-π, π]。 */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  else if (d < -Math.PI) d += TAU
  return d
}

/** 把 a 朝 b 旋转，最多转 maxStep 弧度。 */
export function turnToward(a: number, b: number, maxStep: number): number {
  const d = angleDiff(a, b)
  if (Math.abs(d) <= maxStep) return b
  return a + Math.sign(d) * maxStep
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t)
export const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

/** 线段 (ax,ay)-(bx,by) 上离点 (px,py) 最近点的参数 t∈[0,1]。 */
export function segmentClosestT(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const abx = bx - ax
  const aby = by - ay
  const len2 = abx * abx + aby * aby
  if (len2 < 1e-9) return 0
  return clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1)
}

/** 点到线段的距离平方。 */
export function distToSegment2(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const t = segmentClosestT(ax, ay, bx, by, px, py)
  return dist2(ax + (bx - ax) * t, ay + (by - ay) * t, px, py)
}

/** 秒 → "mm:ss" */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 1234 → "1,234"；超大数用 K/M。 */
export function formatNum(n: number): string {
  const v = Math.round(n)
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 100_000) return `${Math.round(v / 1000)}K`
  return v.toLocaleString('en-US')
}
