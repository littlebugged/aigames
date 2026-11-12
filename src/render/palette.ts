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
