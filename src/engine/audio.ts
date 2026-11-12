import type { SectorId, WeaponId } from '../data/ids'
import type { GameEvent } from '../game/events'
import { clamp } from './math'

/**
 * 纯 WebAudio 合成的音效与生成式音乐，零音频资源文件。
 *
 * 音乐：16 步音序器 + 前瞻调度（setInterval 提前 0.2s 排音符，节奏稳定不受主线程抖动影响），
 * 分层随"强度"逐步加入：铺底 → 底鼓 → 贝斯 → 镲 → 军鼓 → 琶音。
 * 音效：每种声音限频，避免大量同类事件叠成一团噪音。
 */

export type MusicMode = 'off' | 'menu' | 'play' | 'boss'

interface MusicCfg {
  /** 贝斯根音（MIDI） */
  root: number
  scale: number[]
  /** 4 小节的和弦进行（音阶级数） */
  prog: number[]
  bpm: number
}

const MUSIC: Record<SectorId, MusicCfg> = {
  fields: { root: 33, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 0, 6], bpm: 118 },
  wasteland: { root: 38, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 1, 0, 6], bpm: 124 },
  void: { root: 40, scale: [0, 2, 3, 5, 7, 8, 11], prog: [0, 5, 3, 4], bpm: 128 },
}
const BOSS_SCALE = [0, 1, 4, 5, 7, 8, 10]
const MENU_CFG: MusicCfg = { root: 33, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 5, 3, 4], bpm: 84 }

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

const degMidi = (cfg: { root: number; scale: number[] }, deg: number): number => {
  const oct = Math.floor(deg / 7)
  const idx = ((deg % 7) + 7) % 7
  return cfg.root + oct * 12 + cfg.scale[idx]
}

interface ToneOpts {
  type?: OscillatorType
  f1?: number
  vol?: number
  attack?: number
  delay?: number
  pan?: number
  lp?: number
  dest?: AudioNode
}

interface NoiseOpts {
  vol?: number
  type?: BiquadFilterType
  f0?: number
  f1?: number
  q?: number
  attack?: number
  delay?: number
  pan?: number
  dest?: AudioNode
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfxBus!: GainNode
  private musicBus!: GainNode
  private duck!: GainNode
  private musicFilter!: BiquadFilterNode
  private out!: DynamicsCompressorNode
  private analyser: AnalyserNode | null = null
  private meterBuf: Float32Array<ArrayBuffer> | null = null
  private noiseBuf: AudioBuffer | null = null

  private vMaster = 0.8
  private vSfx = 0.85
  private vMusic = 0.5
  private voices = 0
  private readonly last = new Map<string, number>()
  private gemStreak = 0
  private gemT = 0

  // 音乐状态
  private mode: MusicMode = 'off'
  private sector: SectorId = 'fields'
  private timer: number | null = null
  private nextT = 0
  private step = 0
  private bar = 0
  private intensity = 0
  private targetIntensity = 0
  private paused = false
  private hiddenSuspended = false

  /** 是否可用（浏览器不支持时所有调用都是空操作） */
  get available(): boolean {
    return this.ctx !== null
  }

  constructor() {
    document.addEventListener('visibilitychange', () => {
      const c = this.ctx
      if (!c) return
      if (document.hidden) {
        if (c.state === 'running') {
          this.hiddenSuspended = true
          void c.suspend()
        }
      } else if (this.hiddenSuspended) {
        this.hiddenSuspended = false
        void c.resume()
      }
    })
  }

  /** 必须在用户手势里调用：创建并唤醒 AudioContext */
  unlock(): void {
    if (!this.ctx) this.init()
    const c = this.ctx
    if (c && c.state === 'suspended' && !document.hidden) void c.resume()
  }

  private init(): void {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    let c: AudioContext
    try {
      c = new Ctor({ latencyHint: 'interactive' })
    } catch {
      return
    }
    this.ctx = c

    this.master = c.createGain()
    this.master.gain.value = this.vMaster
    const comp = c.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 18
    comp.ratio.value = 5
    comp.attack.value = 0.004
    comp.release.value = 0.2
    // 补偿增益 + 砖墙限幅：整体响度更足，同时无论多少声音叠在一起都不会削波
    const makeup = c.createGain()
    makeup.gain.value = 1.55
    const lim = c.createDynamicsCompressor()
    lim.threshold.value = -4
    lim.knee.value = 0
    lim.ratio.value = 20
    lim.attack.value = 0.001
    lim.release.value = 0.12
    this.master.connect(comp)
    comp.connect(makeup)
    makeup.connect(lim)
    lim.connect(c.destination)
    this.out = lim

    this.sfxBus = c.createGain()
    this.sfxBus.gain.value = this.vSfx
    this.sfxBus.connect(this.master)

    this.musicBus = c.createGain()
    this.musicBus.gain.value = this.vMusic * 0.55
    this.duck = c.createGain()
    this.duck.gain.value = 1
    this.musicFilter = c.createBiquadFilter()
    this.musicFilter.type = 'lowpass'
    this.musicFilter.frequency.value = 18000
    this.musicBus.connect(this.duck)
    this.duck.connect(this.musicFilter)
    this.musicFilter.connect(this.master)

    // 空间感：给音乐加一路带反馈的回声
    const delay = c.createDelay(1)
    delay.delayTime.value = 0.32
    const fb = c.createGain()
    fb.gain.value = 0.34
    const wet = c.createGain()
    wet.gain.value = 0.28
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2600
    this.musicBus.connect(delay)
    delay.connect(lp)
    lp.connect(fb)
    fb.connect(delay)
    lp.connect(wet)
    wet.connect(this.duck)

    // 白噪声缓冲（2 秒）
    const len = c.sampleRate * 2
    const buf = c.createBuffer(1, len, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.noiseBuf = buf

    if (this.mode !== 'off') this.startSequencer()
  }

  /** 仅调试 / e2e：读取主输出的瞬时电平，用来验证合成器确实在发声（首次调用才会接入分析节点） */
  meter(): { state: string; rms: number; peak: number } | null {
    const c = this.ctx
    if (!c) return null
    if (!this.analyser) {
      this.analyser = c.createAnalyser()
      this.analyser.fftSize = 2048
      this.meterBuf = new Float32Array(this.analyser.fftSize)
      this.out.connect(this.analyser)
    }
    const buf = this.meterBuf
    if (!buf) return null
    this.analyser.getFloatTimeDomainData(buf)
    let sum = 0
    let peak = 0
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i])
      sum += v * v
      if (v > peak) peak = v
    }
    return { state: c.state, rms: Math.sqrt(sum / buf.length), peak }
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.vMaster = clamp(master, 0, 1)
    this.vSfx = clamp(sfx, 0, 1)
    this.vMusic = clamp(music, 0, 1)
    const c = this.ctx
    if (!c) return
    const t = c.currentTime
    this.master.gain.setTargetAtTime(this.vMaster, t, 0.03)
    this.sfxBus.gain.setTargetAtTime(this.vSfx, t, 0.03)
    this.musicBus.gain.setTargetAtTime(this.vMusic * 0.55, t, 0.03)
  }

  // ───────────────────────── 基础发声 ─────────────────────────

  private ok(key: string, minGap: number): boolean {
    const c = this.ctx
    if (!c) return false
    const now = c.currentTime
    const prev = this.last.get(key) ?? -1
    if (now - prev < minGap) return false
    this.last.set(key, now)
    return true
  }

  private tone(f0: number, dur: number, o: ToneOpts = {}): void {
    const c = this.ctx
    if (!c || this.voices > 56) return
    const t = c.currentTime + (o.delay ?? 0)
    const osc = c.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(f0, t)
    if (o.f1 && o.f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + dur)
    const g = c.createGain()
    const v = o.vol ?? 0.1
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(v, t + (o.attack ?? 0.004))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    let node: AudioNode = osc
    let filt: BiquadFilterNode | null = null
    if (o.lp) {
      filt = c.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = o.lp
      node.connect(filt)
      node = filt
    }
    node.connect(g)
    let tail: AudioNode = g
    let pan: StereoPannerNode | null = null
    if (o.pan && c.createStereoPanner) {
      pan = c.createStereoPanner()
      pan.pan.value = clamp(o.pan, -1, 1)
      g.connect(pan)
      tail = pan
    }
    tail.connect(o.dest ?? this.sfxBus)
    this.voices++
    osc.onended = () => {
      this.voices--
      osc.disconnect()
      g.disconnect()
      filt?.disconnect()
      pan?.disconnect()
    }
    osc.start(t)
    osc.stop(t + dur + 0.04)
  }

  private noise(dur: number, o: NoiseOpts = {}): void {
    const c = this.ctx
    if (!c || !this.noiseBuf || this.voices > 56) return
    const t = c.currentTime + (o.delay ?? 0)
    const src = c.createBufferSource()
    src.buffer = this.noiseBuf
    const f = c.createBiquadFilter()
    f.type = o.type ?? 'bandpass'
    f.frequency.setValueAtTime(o.f0 ?? 1500, t)
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur)
    f.Q.value = o.q ?? 0.9
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(o.vol ?? 0.1, t + (o.attack ?? 0.003))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f)
    f.connect(g)
    let tail: AudioNode = g
    let pan: StereoPannerNode | null = null
    if (o.pan && c.createStereoPanner) {
      pan = c.createStereoPanner()
      pan.pan.value = clamp(o.pan, -1, 1)
      g.connect(pan)
      tail = pan
    }
    tail.connect(o.dest ?? this.sfxBus)
    this.voices++
    src.onended = () => {
      this.voices--
      src.disconnect()
      f.disconnect()
      g.disconnect()
      pan?.disconnect()
    }
    src.start(t, Math.random() * 1.6, dur + 0.05)
  }

  // ───────────────────────── 游戏事件音效 ─────────────────────────

  onEvent(e: GameEvent, world: { player: { x: number }; viewHalfW: number } | null): void {
    if (!this.ctx || this.ctx.state !== 'running') return
    const pan = (x: number): number => (world ? clamp((x - world.player.x) / (world.viewHalfW || 640), -1, 1) * 0.65 : 0)
    switch (e.t) {
      case 'shot':
        this.shot(e.w, pan(e.x))
        break
      case 'hit':
        if (e.boss) {
          if (this.ok('hitB', 0.08)) {
            this.tone(150, 0.09, { type: 'triangle', f1: 90, vol: 0.09, pan: pan(e.x) })
          }
        } else if (e.crit) {
          if (this.ok('hitC', 0.07)) {
            this.tone(1568, 0.09, { type: 'sine', vol: 0.07, pan: pan(e.x) })
            this.noise(0.03, { type: 'highpass', f0: 4000, vol: 0.06, pan: pan(e.x) })
          }
        } else if (this.ok('hit', 0.055)) {
          this.noise(0.025, { type: 'highpass', f0: 3200, vol: 0.045, pan: pan(e.x) })
        }
        break
      case 'kill':
        if (e.elite || e.big) {
          if (this.ok('killB', 0.12)) {
            this.tone(240, 0.32, { type: 'sawtooth', f1: 45, vol: 0.18, lp: 1800, pan: pan(e.x) })
            this.noise(0.28, { type: 'lowpass', f0: 2400, f1: 200, vol: 0.2, pan: pan(e.x) })
          }
        } else if (this.ok('kill', 0.045)) {
          const f = 380 + Math.random() * 120
          this.tone(f, 0.09, { type: 'triangle', f1: f * 0.3, vol: 0.075, pan: pan(e.x) })
          this.noise(0.05, { type: 'bandpass', f0: 1800, f1: 500, vol: 0.05, pan: pan(e.x) })
        }
        break
      case 'hurt':
        if (this.ok('hurt', 0.12)) {
          this.noise(0.24, { type: 'lowpass', f0: 1500, f1: 200, vol: 0.34 })
          this.tone(170, 0.28, { type: 'sawtooth', f1: 55, vol: 0.22, lp: 900 })
          this.tone(121, 0.22, { type: 'square', f1: 60, vol: 0.08, lp: 700 })
          this.duckMusic(0.45, 0.35)
        }
        break
      case 'gem': {
        const now = this.ctx.currentTime
        if (now - this.gemT > 0.5) this.gemStreak = 0
        this.gemT = now
        if (this.ok('gem', 0.035)) {
          const semis = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]
          const m = 76 + semis[Math.min(semis.length - 1, this.gemStreak)]
          this.gemStreak++
          this.tone(mtof(m), 0.11, { type: 'sine', vol: 0.055, pan: pan(e.x) })
        }
        break
      }
      case 'pickup':
        this.pickup(e.kind)
        break
      case 'levelup':
        this.arp([72, 76, 79, 84, 88], 0.07, { type: 'triangle', vol: 0.12 })
        this.tone(mtof(60), 0.5, { type: 'sine', vol: 0.12, attack: 0.02 })
        break
      case 'dash':
        this.noise(0.2, { type: 'bandpass', f0: 1400, f1: 260, q: 1.2, vol: 0.2 })
        this.tone(320, 0.17, { type: 'triangle', f1: 920, vol: 0.09 })
        break
      case 'blast': {
        const big = clamp(e.r / 130, 0.4, 1.6)
        if (this.ok('blast', 0.05)) {
          this.tone(130, 0.4 * big, { type: 'sine', f1: 38, vol: 0.28 * Math.min(1, big), pan: pan(e.x) })
          this.noise(0.4 * big, { type: 'lowpass', f0: 1800, f1: 120, vol: 0.26 * Math.min(1, big), pan: pan(e.x) })
        }
        break
      }
      case 'warn':
        if (e.sev >= 2) this.siren()
        else {
          this.tone(880, 0.12, { type: 'square', vol: 0.07, lp: 3000 })
          this.tone(880, 0.12, { type: 'square', vol: 0.07, lp: 3000, delay: 0.18 })
        }
        break
      case 'boss':
        if (e.what === 'spawn') this.bossSpawn()
        else if (e.what === 'phase') this.bossPhase()
        else this.bossDead()
        break
      case 'revive':
        this.tone(200, 0.9, { type: 'sawtooth', f1: 1200, vol: 0.12, lp: 3500, attack: 0.05 })
        this.arp([69, 73, 76, 81, 85], 0.08, { type: 'triangle', vol: 0.12 }, 0.35)
        break
      case 'evolve':
        this.arp([72, 76, 79, 83, 86, 91, 95], 0.065, { type: 'sine', vol: 0.12 })
        this.arp([84, 88, 91, 95], 0.065, { type: 'triangle', vol: 0.06 }, 0.1)
        this.tone(70, 0.7, { type: 'sine', f1: 40, vol: 0.28 })
        this.noise(0.6, { type: 'highpass', f0: 2000, f1: 9000, vol: 0.08, attack: 0.3 })
        break
      case 'end':
        if (e.won) this.fanfare()
        else this.defeat()
        break
      default:
        break
    }
  }

  private shot(w: WeaponId, pan: number): void {
    switch (w) {
      case 'pulse':
        if (this.ok('s:pulse', 0.075)) this.tone(900, 0.07, { type: 'triangle', f1: 380, vol: 0.055, pan })
        break
      case 'arc':
        if (this.ok('s:arc', 0.1)) {
          this.tone(260, 0.2, { type: 'sawtooth', f1: 1100, vol: 0.07, lp: 4000, pan })
          this.noise(0.18, { type: 'bandpass', f0: 3200, f1: 1800, q: 2, vol: 0.12, pan })
        }
        break
      case 'missile':
        if (this.ok('s:missile', 0.12)) {
          this.noise(0.28, { type: 'bandpass', f0: 500, f1: 1500, q: 1.3, vol: 0.14, pan })
          this.tone(150, 0.2, { type: 'sine', f1: 90, vol: 0.12, pan })
        }
        break
      case 'laser':
        if (this.ok('s:laser', 0.2)) {
          this.tone(200, 0.45, { type: 'sawtooth', f1: 900, vol: 0.085, lp: 2800, pan })
          this.tone(1760, 0.4, { type: 'sine', f1: 880, vol: 0.05, pan })
        }
        break
      case 'mine':
        if (this.ok('s:mine', 0.12)) {
          this.tone(210, 0.1, { type: 'sine', f1: 110, vol: 0.12, pan })
          this.tone(1320, 0.07, { type: 'sine', vol: 0.05, delay: 0.04, pan })
        }
        break
      case 'nova':
        if (this.ok('s:nova', 0.3)) {
          this.tone(95, 0.55, { type: 'sine', f1: 36, vol: 0.34 })
          this.noise(0.45, { type: 'lowpass', f0: 3000, f1: 200, vol: 0.18 })
        }
        break
      case 'chakram':
        if (this.ok('s:chakram', 0.14)) {
          this.noise(0.24, { type: 'bandpass', f0: 2000, f1: 700, q: 3, vol: 0.1, pan })
          this.tone(560, 0.22, { type: 'triangle', f1: 240, vol: 0.07, pan })
        }
        break
      case 'rail':
        if (this.ok('s:rail', 0.1)) {
          this.tone(2200, 0.2, { type: 'sawtooth', f1: 90, vol: 0.13, lp: 5200, pan })
          this.noise(0.28, { type: 'highpass', f0: 3200, vol: 0.14, pan })
          this.tone(74, 0.4, { type: 'sine', f1: 38, vol: 0.28, pan })
        }
        break
      default:
        break
    }
  }

  private pickup(kind: string): void {
    switch (kind) {
      case 'heal':
        this.arp([72, 76, 79], 0.07, { type: 'sine', vol: 0.13 })
        break
      case 'magnet':
        this.tone(180, 0.5, { type: 'sine', f1: 1400, vol: 0.12, attack: 0.02 })
        this.noise(0.45, { type: 'bandpass', f0: 400, f1: 2400, vol: 0.1 })
        break
      case 'bomb':
        this.tone(110, 0.5, { type: 'sine', f1: 36, vol: 0.3 })
        this.noise(0.5, { type: 'lowpass', f0: 2600, f1: 140, vol: 0.28 })
        break
      case 'chest':
        this.arp([76, 79, 83, 86, 88, 91], 0.06, { type: 'triangle', vol: 0.12 })
        this.noise(0.5, { type: 'highpass', f0: 6000, vol: 0.05, attack: 0.15 })
        break
      case 'cache':
        this.tone(1318, 0.09, { type: 'square', vol: 0.06, lp: 4000 })
        this.tone(1760, 0.18, { type: 'square', vol: 0.06, lp: 4000, delay: 0.07 })
        break
      default:
        break
    }
  }

  private arp(notes: number[], gap: number, o: ToneOpts, delay = 0): void {
    notes.forEach((m, i) => this.tone(mtof(m), 0.28, { ...o, delay: delay + i * gap }))
  }

  private siren(): void {
    for (let i = 0; i < 6; i++) {
      this.tone(i % 2 === 0 ? 466 : 622, 0.18, { type: 'square', vol: 0.085, lp: 2400, delay: i * 0.2 })
    }
    this.tone(55, 1.4, { type: 'sawtooth', vol: 0.15, lp: 300, attack: 0.1 })
    this.duckMusic(0.5, 1.2)
  }

  private bossSpawn(): void {
    this.tone(48, 2.4, { type: 'sawtooth', f1: 40, vol: 0.26, lp: 220, attack: 0.5 })
    this.tone(96, 2.2, { type: 'square', f1: 70, vol: 0.08, lp: 400, attack: 0.6 })
    this.noise(2.2, { type: 'lowpass', f0: 160, f1: 900, vol: 0.2, attack: 1.2 })
    this.noise(0.5, { type: 'highpass', f0: 1000, f1: 7000, vol: 0.09, delay: 1.7 })
  }

  private bossPhase(): void {
    this.noise(0.5, { type: 'highpass', f0: 800, f1: 9000, vol: 0.14, attack: 0.35 })
    this.tone(70, 0.9, { type: 'sine', f1: 30, vol: 0.4, delay: 0.45 })
    this.noise(0.8, { type: 'lowpass', f0: 3000, f1: 100, vol: 0.34, delay: 0.45 })
    this.duckMusic(0.35, 1)
  }

  private bossDead(): void {
    for (let i = 0; i < 12; i++) {
      const d = i * 0.11 + Math.random() * 0.05
      this.tone(160 - i * 5, 0.38, { type: 'sine', f1: 40, vol: 0.26, delay: d })
      this.noise(0.36, { type: 'lowpass', f0: 2600, f1: 120, vol: 0.22, delay: d })
    }
    const t = 1.7
    this.tone(60, 1.6, { type: 'sine', f1: 24, vol: 0.5, delay: t })
    this.noise(1.5, { type: 'lowpass', f0: 4000, f1: 80, vol: 0.45, delay: t })
    this.duckMusic(0.1, 2.4)
  }

  private fanfare(): void {
    const seq = [67, 72, 76, 79, 84]
    seq.forEach((m, i) => {
      this.tone(mtof(m), 0.5, { type: 'triangle', vol: 0.14, delay: i * 0.13 })
      this.tone(mtof(m - 12), 0.5, { type: 'sine', vol: 0.1, delay: i * 0.13 })
    })
    ;[72, 76, 79, 84, 88].forEach((m) => this.tone(mtof(m), 1.6, { type: 'triangle', vol: 0.09, delay: 0.7, attack: 0.04 }))
    this.tone(mtof(48), 1.8, { type: 'sine', vol: 0.18, delay: 0.7 })
  }

  private defeat(): void {
    ;[67, 63, 60, 55].forEach((m, i) => {
      this.tone(mtof(m), 0.7, { type: 'sawtooth', f1: mtof(m) * 0.96, vol: 0.12, lp: 1200, delay: i * 0.28 })
    })
    this.tone(mtof(36), 2.0, { type: 'sine', f1: mtof(33), vol: 0.22, delay: 0.5 })
    this.noise(1.6, { type: 'lowpass', f0: 800, f1: 90, vol: 0.2, delay: 0.3 })
  }

  // ───────────────────────── UI 音效 ─────────────────────────

  ui(kind: 'hover' | 'click' | 'confirm' | 'back' | 'buy' | 'deny' | 'card' | 'reroll' | 'open' | 'achievement'): void {
    if (!this.ctx || this.ctx.state !== 'running') return
    switch (kind) {
      case 'hover':
        if (this.ok('ui:hover', 0.05)) this.tone(1500, 0.03, { type: 'sine', vol: 0.025 })
        break
      case 'click':
        this.tone(820, 0.06, { type: 'triangle', f1: 560, vol: 0.09 })
        break
      case 'confirm':
        this.tone(660, 0.08, { type: 'triangle', vol: 0.1 })
        this.tone(990, 0.14, { type: 'triangle', vol: 0.1, delay: 0.07 })
        break
      case 'back':
        this.tone(520, 0.08, { type: 'triangle', f1: 380, vol: 0.09 })
        break
      case 'buy':
        this.tone(1318, 0.08, { type: 'square', vol: 0.06, lp: 4000 })
        this.tone(1760, 0.2, { type: 'square', vol: 0.06, lp: 4000, delay: 0.07 })
        this.noise(0.15, { type: 'highpass', f0: 6000, vol: 0.04, delay: 0.07 })
        break
      case 'deny':
        this.tone(160, 0.14, { type: 'sawtooth', f1: 110, vol: 0.1, lp: 800 })
        this.tone(150, 0.14, { type: 'sawtooth', f1: 100, vol: 0.1, lp: 800, delay: 0.1 })
        break
      case 'card':
        this.noise(0.14, { type: 'bandpass', f0: 600, f1: 2400, vol: 0.09 })
        this.tone(1100, 0.08, { type: 'sine', vol: 0.06, delay: 0.05 })
        break
      case 'reroll':
        for (let i = 0; i < 4; i++) this.noise(0.05, { type: 'bandpass', f0: 1800 + i * 300, vol: 0.07, delay: i * 0.045 })
        break
      case 'open':
        this.tone(440, 0.18, { type: 'triangle', f1: 880, vol: 0.08, attack: 0.02 })
        break
      case 'achievement':
        this.arp([79, 83, 86, 91], 0.09, { type: 'triangle', vol: 0.12 })
        break
    }
  }

  private duckMusic(level: number, secs: number): void {
    const c = this.ctx
    if (!c) return
    const t = c.currentTime
    this.duck.gain.cancelScheduledValues(t)
    this.duck.gain.setTargetAtTime(level, t, 0.02)
    this.duck.gain.setTargetAtTime(1, t + secs, 0.25)
  }

  // ───────────────────────── 音乐 ─────────────────────────

  musicMode(mode: MusicMode, sector?: SectorId): void {
    const changed = mode !== this.mode || (sector !== undefined && sector !== this.sector)
    if (sector) this.sector = sector
    this.mode = mode
    if (!changed) return
    this.step = 0
    this.bar = 0
    if (mode === 'off') {
      this.stopSequencer()
      return
    }
    this.targetIntensity = mode === 'menu' ? 0.3 : mode === 'boss' ? 1 : 0
    if (mode !== 'play') this.intensity = this.targetIntensity
    else this.intensity = Math.min(this.intensity, 0.05)
    this.startSequencer()
  }

  setIntensity(x: number): void {
    this.targetIntensity = clamp(x, 0, 1)
  }

  setPaused(p: boolean): void {
    this.paused = p
    const c = this.ctx
    if (!c || !this.musicFilter) return
    const t = c.currentTime
    this.musicFilter.frequency.cancelScheduledValues(t)
    this.musicFilter.frequency.setTargetAtTime(p ? 380 : 18000, t, 0.08)
  }

  private startSequencer(): void {
    const c = this.ctx
    if (!c) return
    this.nextT = c.currentTime + 0.06
    if (this.timer === null) this.timer = window.setInterval(() => this.pump(), 40)
  }

  private stopSequencer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private cfg(): MusicCfg {
    if (this.mode === 'menu') return MENU_CFG
    const base = MUSIC[this.sector]
    if (this.mode === 'boss') return { ...base, scale: BOSS_SCALE, bpm: base.bpm + 18, prog: [0, 1, 0, 1] }
    return base
  }

  private pump(): void {
    const c = this.ctx
    if (!c || c.state !== 'running') return
    this.intensity += (this.targetIntensity - this.intensity) * 0.06
    const horizon = c.currentTime + 0.2
    const cfg = this.cfg()
    const stepDur = 60 / cfg.bpm / 4
    // 页面长时间被挂起后避免一次排太多
    if (this.nextT < c.currentTime - 0.5) this.nextT = c.currentTime + 0.05
    while (this.nextT < horizon) {
      this.scheduleStep(this.step, this.nextT, cfg, stepDur)
      this.nextT += stepDur
      this.step = (this.step + 1) % 16
      if (this.step === 0) this.bar++
    }
  }

  private scheduleStep(step: number, t: number, cfg: MusicCfg, stepDur: number): void {
    const dest = this.musicBus
    const boss = this.mode === 'boss'
    const calm = this.mode === 'menu'
    const I = this.intensity
    const chordDeg = cfg.prog[this.bar % 4]
    const delay = Math.max(0, t - (this.ctx?.currentTime ?? 0))
    const o = (x: ToneOpts): ToneOpts => ({ ...x, dest, delay })
    const barDur = stepDur * 16

    // 铺底和弦：每小节一次
    if (step === 0) {
      const tones = [0, 2, 4].map((k) => degMidi(cfg, chordDeg + k) + 12)
      for (const m of tones) {
        for (const det of [-1, 1]) {
          this.tone(mtof(m) * (1 + det * 0.004), barDur * 1.02, {
            type: 'sawtooth',
            vol: calm ? 0.028 : 0.02,
            attack: barDur * 0.35,
            lp: 760 + I * 500,
            dest,
            delay,
          })
        }
      }
    }

    if (!calm) {
      // 底鼓
      const kickOn = I >= 0.08 || boss
      const kickStep = step % 4 === 0 || (boss && (step === 10 || step === 15))
      if (kickOn && kickStep) {
        this.tone(150, 0.16, o({ type: 'sine', f1: 42, vol: 0.34 }))
        this.noise(0.02, { type: 'highpass', f0: 2500, vol: 0.05, dest, delay })
      }
      // 军鼓
      if ((I >= 0.4 || boss) && (step === 4 || step === 12)) {
        this.noise(0.13, { type: 'bandpass', f0: 1700, q: 0.7, vol: 0.13, dest, delay })
        this.tone(200, 0.09, o({ type: 'triangle', f1: 120, vol: 0.1 }))
      }
      // 镲
      if (I >= 0.25 || boss) {
        const open = step % 4 === 2
        const sixteenth = boss || I > 0.75
        if (open || step % 2 === 0 || sixteenth) {
          this.noise(open ? 0.09 : 0.03, {
            type: 'highpass',
            f0: 7500,
            vol: open ? 0.04 : 0.022 + (step % 4 === 0 ? 0.01 : 0),
            dest,
            delay,
          })
        }
      }
      // 贝斯
      if (I >= 0.14 || boss) {
        const pat = boss ? step % 2 === 0 || step % 4 === 3 : step % 2 === 0
        if (pat) {
          const idx = step >> 1
          const offs = boss ? [0, 12, 0, 0, 7, 0, 12, 10] : [0, 0, 12, 0, 0, 7, 0, 10]
          const root = degMidi(cfg, chordDeg)
          const n = root + offs[idx % 8]
          this.tone(mtof(n), stepDur * (boss ? 1.6 : 1.9), {
            type: 'sawtooth',
            vol: boss ? 0.14 : 0.12,
            lp: 380 + I * 700,
            attack: 0.006,
            dest,
            delay,
          })
        }
      }
    }

    // 琶音
    if ((calm && step % 4 === 0) || (!calm && (I >= 0.55 || boss))) {
      const pat = [0, 2, 4, 2, 7, 4, 2, 4, 0, 2, 4, 7, 9, 7, 4, 2]
      const k = pat[step]
      const m = degMidi(cfg, chordDeg + k) + 24
      const accent = step % 4 === 0
      this.tone(mtof(m), stepDur * (calm ? 3.5 : 1.7), {
        type: boss ? 'square' : 'triangle',
        vol: (calm ? 0.04 : 0.05) * (accent ? 1.25 : 0.85),
        lp: 3200,
        attack: 0.004,
        dest,
        delay,
      })
    }

    // Boss 战：每 4 小节末尾一个上升噪声
    if (boss && this.bar % 4 === 3 && step === 8) {
      this.noise(stepDur * 8, { type: 'highpass', f0: 600, f1: 8000, vol: 0.07, attack: stepDur * 6, dest, delay })
    }
  }

  /** 音乐是否在运行（调试 / e2e 用） */
  get musicRunning(): boolean {
    return this.timer !== null
  }
}
