// 星穹守卫 —— Web Audio 实时合成音效（零音频文件）
// 参考 games/neon-dash/main.ts 的 Sfx 模式扩展；E1：AudioContext 不可用则静默，E2：首次交互自动 resume

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

  /** 白噪声爆（低通滤波），用于爆炸类音效 */
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

  shoot(): void {
    this.tone(920, 440, 0.06, 'square', 0.05)
  }

  enemyShoot(): void {
    this.tone(320, 190, 0.09, 'sawtooth', 0.045)
  }

  hit(): void {
    this.tone(220, 70, 0.08, 'square', 0.09)
  }

  boomSmall(): void {
    this.noise(0.22, 0.16, 900)
    this.tone(150, 40, 0.2, 'triangle', 0.12)
  }

  boomBig(): void {
    this.noise(0.55, 0.24, 650)
    this.tone(120, 28, 0.5, 'triangle', 0.18)
    this.tone(60, 20, 0.6, 'sine', 0.14, 0.05)
  }

  pickup(): void {
    this.tone(523, 523, 0.06, 'square', 0.07)
    this.tone(659, 659, 0.06, 'square', 0.07, 0.06)
    this.tone(784, 784, 0.1, 'square', 0.07, 0.12)
  }

  shieldBreak(): void {
    this.tone(1100, 180, 0.16, 'triangle', 0.1)
  }

  bossWarn(): void {
    for (let i = 0; i < 3; i += 1) {
      this.tone(440, 440, 0.12, 'square', 0.09, i * 0.3)
      this.tone(622, 622, 0.12, 'square', 0.09, i * 0.3 + 0.15)
    }
  }

  wave(): void {
    this.tone(880, 880, 0.09, 'square', 0.07)
    this.tone(1320, 1320, 0.13, 'square', 0.07, 0.09)
  }

  gameOver(): void {
    this.tone(392, 392, 0.16, 'triangle', 0.12)
    this.tone(262, 262, 0.16, 'triangle', 0.12, 0.18)
    this.tone(131, 131, 0.4, 'triangle', 0.12, 0.36)
    this.noise(0.4, 0.1, 500, 0.36)
  }
}

/** 全局共享音效单例（各场景共用，静音状态跨场景保持） */
export const sfx = new Sfx()