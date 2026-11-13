import type { NumLook } from '../engine/feel'

/**
 * 伤害数字的字形图集。
 *
 * 为什么不每帧 fillText：想要的质感（渐变字面、贴着字形的柔光、细暗描边、顶部高光、斜体）要叠好几层，
 * 每帧对每个数字都画一遍既贵（shadowBlur 在手机上尤其慢）又容易画成"气泡字"。
 * 所以每个字符 × 每个外观只预渲染一次到一张小画布，之后画数字 = 几次 drawImage，质感想怎么加都不增加运行时开销。
 *
 * 清晰度：字形按"稳定字号 × 1.5"的分辨率预渲染，正常大小时缩小一点（双线性），弹出的瞬间放大不超过 1.6 倍。
 * 屏幕缩放 / DPR 变化超过阈值时，该外观的图集整体失效并惰性重建。
 */

export interface PaintSurface {
  canvas: CanvasImageSource
  ctx: CanvasRenderingContext2D
}
export type SurfaceFactory = (w: number, h: number) => PaintSurface

interface Glyph {
  src: CanvasImageSource
  w: number
  h: number
  /** 步进（图集像素） */
  adv: number
  /** 笔位在字形画布里的位置（图集像素） */
  ox: number
  oy: number
}

/** 预渲染分辨率相对"稳定字号"的倍数 */
const OVERSAMPLE = 1.5
/** 屏幕缩放变化超过这个比例才重建图集 */
const REBUILD_RATIO = 0.22
const FAMILY = 'Orbitron, "Rajdhani", system-ui, sans-serif'

const domSurface: SurfaceFactory = (w, h) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { canvas: c, ctx: c.getContext('2d') as CanvasRenderingContext2D }
}

/** 字体还没加载好就别预渲染：否则会把后备字体的字形永远缓存下来 */
const domFontsReady = (): boolean => typeof document === 'undefined' || !document.fonts || (document.fonts.check('800 20px Orbitron') && document.fonts.check('600 20px Orbitron'))

const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export class NumberFont {
  private readonly cache: Map<string, Glyph>[]
  private readonly em: number[]
  private readonly meter: CanvasRenderingContext2D
  /** 字体就绪是单调的（一旦就绪不会回退），就绪后不再反复查询 FontFaceSet */
  private ready = false

  constructor(
    private readonly looks: readonly NumLook[],
    private readonly make: SurfaceFactory = domSurface,
    private readonly fontsReady: () => boolean = domFontsReady,
  ) {
    this.cache = looks.map(() => new Map())
    this.em = looks.map(() => 0)
    this.meter = make(4, 4).ctx
    // 提前触发字体加载（菜单页的标题已经在用，通常此时早已就绪）
    if (typeof document !== 'undefined' && document.fonts?.load) {
      void document.fonts.load('800 20px Orbitron').catch(() => {})
      void document.fonts.load('600 20px Orbitron').catch(() => {})
    }
  }

  /** 已缓存的字形数（测试 / 调试用） */
  get glyphCount(): number {
    return this.cache.reduce((s, m) => s + m.size, 0)
  }

  /**
   * 画一串数字，水平居中于 x，垂直居中于 y。
   * size：字号（世界单位）；scale：世界单位 → 设备像素（决定预渲染分辨率）。
   */
  draw(ctx: CanvasRenderingContext2D, text: string, style: number, x: number, y: number, size: number, scale: number): void {
    if (!this.looks[style]) return
    if (!this.ready) {
      if (!this.fontsReady()) return
      this.ready = true
    }
    const em = this.emFor(style, scale)
    const u = size / em
    const gs: Glyph[] = []
    let total = 0
    for (const ch of text) {
      const g = this.glyph(style, em, ch)
      gs.push(g)
      total += g.adv
    }
    let pen = x - (total * u) / 2
    for (const g of gs) {
      ctx.drawImage(g.src, pen - g.ox * u, y - g.oy * u, g.w * u, g.h * u)
      pen += g.adv * u
    }
  }

  private emFor(style: number, scale: number): number {
    const want = Math.max(12, Math.round((this.looks[style].size * scale * OVERSAMPLE) / 4) * 4)
    const cur = this.em[style]
    if (cur === 0 || Math.abs(want / cur - 1) > REBUILD_RATIO) {
      this.cache[style].clear()
      this.em[style] = want
    }
    return this.em[style]
  }

  private glyph(style: number, em: number, ch: string): Glyph {
    const map = this.cache[style]
    let g = map.get(ch)
    if (!g) {
      g = this.build(this.looks[style], em, ch)
      map.set(ch, g)
    }
    return g
  }

  private build(look: NumLook, E: number, ch: string): Glyph {
    const font = `${look.weight} ${E}px ${FAMILY}`
    const m = this.meter
    m.font = font
    // 按字形自己的宽度排版（比强行等宽更自然：Orbitron 的 1 比 0 窄，等宽会在 1 后面留一个洞）；
    // 再留一点字距，保证相邻字形的暗描边不会啃到邻居的字面
    const track = E * 0.04
    const adv = m.measureText(ch).width + track
    const slack = Math.ceil(E * 0.42 * look.skew)
    const pad = Math.ceil(E * (0.1 + look.glowK * 1.2 + look.outline))
    const w = Math.ceil(adv + 2 * (pad + slack))
    const h = Math.ceil(E * 1.3 + 2 * pad)
    const { canvas, ctx } = this.make(w, h)
    const ox = pad + slack
    const oy = h / 2
    // 字形实际落笔的 x：在步进盒里居中（字距平分在两侧）
    const tx = ox + track / 2

    ctx.font = font
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    // 斜体：以字形垂直中心为轴错切，笔位不动
    ctx.setTransform(1, 0, -look.skew, 1, look.skew * oy, 0)

    // ① 光晕：贴着字形的柔光（只在预渲染时用 shadowBlur，运行时零开销）
    if (look.glow && look.glowK > 0) {
      ctx.shadowColor = look.glow
      ctx.shadowBlur = E * look.glowK
      ctx.fillStyle = look.glow
      ctx.globalAlpha = 0.95
      ctx.fillText(ch, tx, oy)
      ctx.fillText(ch, tx, oy)
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
      ctx.globalAlpha = 1
    }
    // ② 暗描边：细而利落，保证任何背景上都读得清
    ctx.lineWidth = E * look.outline
    ctx.strokeStyle = 'rgba(4,6,18,0.86)'
    ctx.strokeText(ch, tx, oy)
    // ③ 字面：白热的顶部 → 本色 → 饱和的底部
    const g = ctx.createLinearGradient(0, oy - E * 0.42, 0, oy + E * 0.42)
    g.addColorStop(0, look.top)
    g.addColorStop(0.5, look.mid)
    g.addColorStop(1, look.bot)
    ctx.fillStyle = g
    ctx.fillText(ch, tx, oy)
    // ④ 顶部高光：只叠在字面上（再填一遍透明渐变，不会洗掉光晕和描边）
    if (look.gloss > 0) {
      const gl = ctx.createLinearGradient(0, oy - E * 0.42, 0, oy + E * 0.02)
      gl.addColorStop(0, rgba('#ffffff', look.gloss))
      gl.addColorStop(1, rgba('#ffffff', 0))
      ctx.fillStyle = gl
      ctx.fillText(ch, tx, oy)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    return { src: canvas, w, h, adv, ox, oy }
  }
}
