import { clamp01 } from '../engine/math'

export interface FloatStyle {
  /** 字号（世界单位） */
  size: number
  /** 外观下标：见 engine/feel 的 NUM_LOOKS（伤害档位 / 受伤数字）；由 NumberFont 负责实际画法 */
  style: number
  life?: number
  /** 弹出瞬间的放大倍率（之后带一点回弹地落回 1） */
  pop?: number
  /**
   * 档位：池满时高档位会挤掉低档位；档位 ≥ 3 的字画在最上层，
   * 档位 ≥ 5 的字在弹出时轻微抖动。
   */
  tier?: number
  /** 上浮速度倍率（越重的数字越"沉"，停得越久） */
  rise?: number
}

/** 谁来把一串数字画出来（生产环境是 NumberFont；测试里换成记录器） */
export interface NumPainter {
  draw(ctx: CanvasRenderingContext2D, text: string, style: number, x: number, y: number, size: number, scale: number): void
}

/** 先冲过头再回弹：u=0 → 0，u≈0.6 时超过 1，u=1 → 1 */
const easeOutBack = (u: number): number => {
  const c1 = 1.70158
  const c3 = c1 + 1
  const x = u - 1
  return 1 + c3 * x * x * x + c1 * x * x
}

/** 池大小。屏幕上同时出现太多数字只会是噪音，所以很小；满了以后用档位决定谁留下。 */
const CAP = 44
/** 从这一档起画在最上层 */
const TOP_LAYER = 3
/** 从这一档起弹出时抖动 */
const HOT_TIER = 5

/**
 * 飘字（伤害数字等）。
 * 每条记录带一个"档位"：
 *   - 画：低档在下、高档在上，大数字不会被一片小数字盖住；
 *   - 挤：池满时高档位挤掉最低档里最老的一条，保证重击的数字一定看得到；
 *   - 样式：字号 / 外观 / 弹出倍率 / 停留时间都由调用方按档位传入。
 */
export class FloatTexts {
  private n = 0
  private readonly txt: string[] = new Array(CAP).fill('')
  private readonly look = new Uint8Array(CAP)
  private readonly x = new Float32Array(CAP)
  private readonly y = new Float32Array(CAP)
  private readonly vy = new Float32Array(CAP)
  private readonly life = new Float32Array(CAP)
  private readonly maxLife = new Float32Array(CAP)
  private readonly size = new Float32Array(CAP)
  private readonly pop = new Float32Array(CAP)
  private readonly phase = new Float32Array(CAP)
  private readonly tier = new Uint8Array(CAP)

  get count(): number {
    return this.n
  }

  /** 当前所有飘字的档位（调试 / 测试用） */
  tiers(): number[] {
    return Array.from(this.tier.subarray(0, this.n))
  }

  clear(): void {
    this.n = 0
  }

  /** 返回是否真的放进去了（池满且没有更低档位可挤时丢弃） */
  add(x: number, y: number, text: string, st: FloatStyle): boolean {
    const tier = st.tier ?? 0
    let i: number
    if (this.n < CAP) {
      i = this.n++
    } else {
      let worst = -1
      let worstTier = 255
      let worstLeft = Infinity
      for (let j = 0; j < this.n; j++) {
        const left = this.life[j] / this.maxLife[j]
        if (this.tier[j] < worstTier || (this.tier[j] === worstTier && left < worstLeft)) {
          worst = j
          worstTier = this.tier[j]
          worstLeft = left
        }
      }
      if (worst < 0 || worstTier >= tier) return false
      i = worst
    }
    const life = st.life ?? 0.7
    this.txt[i] = text
    this.look[i] = st.style
    this.x[i] = x + (Math.random() - 0.5) * 10
    this.y[i] = y
    this.vy[i] = (-46 - Math.random() * 18) * (st.rise ?? 1)
    this.life[i] = this.maxLife[i] = life
    this.size[i] = st.size
    this.pop[i] = st.pop ?? 1.45
    this.phase[i] = Math.random() * 6.283
    this.tier[i] = tier
    return true
  }

  update(dt: number): void {
    let i = 0
    while (i < this.n) {
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        const l = --this.n
        if (i !== l) {
          this.txt[i] = this.txt[l]
          this.look[i] = this.look[l]
          this.x[i] = this.x[l]
          this.y[i] = this.y[l]
          this.vy[i] = this.vy[l]
          this.life[i] = this.life[l]
          this.maxLife[i] = this.maxLife[l]
          this.size[i] = this.size[l]
          this.pop[i] = this.pop[l]
          this.phase[i] = this.phase[l]
          this.tier[i] = this.tier[l]
        }
        continue
      }
      this.y[i] += this.vy[i] * dt
      this.vy[i] *= Math.exp(-2.2 * dt)
      i++
    }
  }

  /** scale：世界单位 → 设备像素（决定字形图集的预渲染分辨率） */
  draw(ctx: CanvasRenderingContext2D, painter: NumPainter, scale = 1): void {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.n; i++) {
        const tier = this.tier[i]
        if (tier >= TOP_LAYER !== (pass === 1)) continue
        this.drawOne(ctx, painter, i, tier, scale)
      }
    }
    ctx.globalAlpha = 1
  }

  private drawOne(ctx: CanvasRenderingContext2D, painter: NumPainter, i: number, tier: number, scale: number): void {
    const maxLife = this.maxLife[i]
    const age = maxLife - this.life[i]
    const frac = this.life[i] / maxLife
    // 弹出：先冲到 pop 倍再回弹落定；档位越高弹得越久
    const u = clamp01(age / (0.15 + tier * 0.014))
    const s = this.size[i] * (1 + (this.pop[i] - 1) * (1 - easeOutBack(u)))
    // 最后一段时间淡出；重击的数字更晚才开始淡
    const alpha = Math.min(1, frac / (tier >= TOP_LAYER ? 0.3 : 0.5))
    // 热档位：弹出时抖一下
    let px = this.x[i]
    let py = this.y[i]
    if (tier >= HOT_TIER && u < 1) {
      const j = (1 - u) * (1.2 + (tier - HOT_TIER) * 0.8)
      px += Math.sin(age * 88 + this.phase[i]) * j
      py += Math.cos(age * 97 + this.phase[i] * 1.7) * j * 0.7
    }
    ctx.globalAlpha = alpha
    painter.draw(ctx, this.txt[i], this.look[i], px, py, s, scale)
  }
}
