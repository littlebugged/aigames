/** 颜色小工具：hex → rgba 字符串（带缓存，避免每帧拼接字符串）。 */

const cache = new Map<string, string>()

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.startsWith('#') ? hex.slice(1) : hex
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** alpha 量化到 1/50，既够平滑又让缓存命中率很高 */
export function rgba(hex: string, a: number): string {
  const q = Math.max(0, Math.min(50, Math.round(a * 50)))
  const key = hex + q
  let v = cache.get(key)
  if (v === undefined) {
    const [r, g, b] = hexToRgb(hex)
    v = `rgba(${r},${g},${b},${q / 50})`
    cache.set(key, v)
  }
  return v
}

const toHex = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')

export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return `#${toHex(r1 + (r2 - r1) * t)}${toHex(g1 + (g2 - g1) * t)}${toHex(b1 + (b2 - b1) * t)}`
}

export const lighten = (hex: string, t: number): string => mixHex(hex, '#ffffff', t)
export const darken = (hex: string, t: number): string => mixHex(hex, '#000000', t)

/** hex → HSL（h: 0~360, s/l: 0~1） */
export function toHsl(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexToRgb(hex)
  const r = r8 / 255
  const g = g8 / 255
  const b = b8 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}

/** HSL → hex */
export function fromHsl(h: number, s: number, l: number): string {
  const hh = (((h % 360) + 360) % 360) / 60
  const c = (1 - Math.abs(2 * l - 1)) * Math.max(0, Math.min(1, s))
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hh < 1) [r, g, b] = [c, x, 0]
  else if (hh < 2) [r, g, b] = [x, c, 0]
  else if (hh < 3) [r, g, b] = [0, c, x]
  else if (hh < 4) [r, g, b] = [0, x, c]
  else if (hh < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return `#${toHex((r + m) * 255)}${toHex((g + m) * 255)}${toHex((b + m) * 255)}`
}
