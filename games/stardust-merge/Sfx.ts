// 星尘消消乐 —— Web Audio 实时合成音效（零音频文件）
// 复用 games/star-vanguard/Sfx.ts 的模式；E1：AudioContext 不可用则静默，E2：首次交互自动 resume

export class Sfx {
  private ctx: AudioContext | null = null
  private muted = false

  setMuted(v: boolean): void {
    this.muted = v
  }

  isMuted(): boolean {
    return this.muted
  }

  private ensure(): AudioContext | null {
    if (this.muted) return null
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext()
      } catch {
        return null
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  /** 首次用户交互时预热（E2：自动播放策略） */
  warm(): void {
    this.ensure()
  }

  private tone(
    freqA: number,
    freqB: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    delay = 0,
  ): void {
    const ctx = this.ensure()
    if (!ctx) return
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freqA, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqB), t0 + dur)
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  /** 白噪声爆（低通滤波），消除类音效 */
  private noise(dur: number, vol: number, cutoff: number, delay = 0): void {
    const ctx = this.ensure()
    if (!ctx) return
    const t0 = ctx.currentTime + delay
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    const gain = ctx.createGain()
    gain.gain.value = vol
    src.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    src.start(t0)
  }

  /** 放置：轻脆的叮 */
  place(): void {
    this.tone(660, 880, 0.07, 'sine', 0.08)
  }

  /** 合成：上行双音 */
  merge(step: number): void {
    const base = 523 * 2 ** Math.min(step - 1, 3)
    this.tone(base, base * 1.5, 0.09, 'triangle', 0.09)
    this.tone(base * 1.5, base * 2, 0.11, 'sine', 0.07, 0.05)
  }

  /** 消除：碎星噪声 + 高音 */
  clear(chain: number): void {
    const base = 523 * 2 ** Math.min(chain - 1, 4)
    this.noise(0.18, 0.14, 2400)
    this.tone(base, base * 1.33, 0.12, 'sine', 0.1)
  }

  /** 无效放置：低沉拒绝音 */
  invalid(): void {
    this.tone(180, 120, 0.12, 'square', 0.07)
  }

  /** 点击 / 确认 */
  click(): void {
    this.tone(880, 660, 0.05, 'sine', 0.06)
  }

  /** 游戏结束：下行三音 */
  gameOver(): void {
    this.tone(392, 392, 0.16, 'triangle', 0.11)
    this.tone(262, 262, 0.16, 'triangle', 0.11, 0.18)
    this.tone(131, 131, 0.42, 'triangle', 0.11, 0.36)
    this.noise(0.4, 0.08, 500, 0.36)
  }

  /** 新纪录：胜利旋律 */
  record(): void {
    this.tone(523, 523, 0.09, 'square', 0.08)
    this.tone(659, 659, 0.09, 'square', 0.08, 0.09)
    this.tone(784, 784, 0.09, 'square', 0.08, 0.18)
    this.tone(1047, 1047, 0.2, 'square', 0.08, 0.27)
  }
}

/** 全局共享音效单例（各场景共用，静音状态跨场景保持） */
export const sfx = new Sfx()