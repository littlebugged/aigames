import type { InputState } from '../game/entities'
import { clamp } from './math'

/**
 * 输入层：键盘 + 触屏虚拟摇杆 + 手柄，合并成模拟层需要的 InputState。
 * 只在"战斗中"响应移动；菜单里的键盘导航由各 UI 屏幕自己处理。
 */

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
}

const JOY_RADIUS = 58

export class Input {
  /** 战斗中才采集移动/冲刺 */
  enabled = false
  onPause: (() => void) | null = null
  /** 手柄菜单导航（战斗外 / 升级选卡时） */
  onNav: ((dir: 'left' | 'right' | 'up' | 'down' | 'confirm' | 'back') => void) | null = null
  /** 最近一次使用的输入设备（HUD 据此显示触控按钮/键盘提示） */
  lastDevice: 'kbd' | 'touch' | 'pad' = 'kbd'
  onDeviceChange: ((d: 'kbd' | 'touch' | 'pad') => void) | null = null
  leftHanded = false
  vibration = true

  private readonly keys = new Set<string>()
  private dashQueued = false

  // 虚拟摇杆
  private joyId = -1
  private joyX0 = 0
  private joyY0 = 0
  private joyMx = 0
  private joyMy = 0
  private zone: HTMLElement | null = null
  private joyBase: HTMLElement | null = null
  private joyKnob: HTMLElement | null = null

  // 手柄
  private padPrev: boolean[] = []
  private padNavT = 0
  private padAxisPrev = { x: 0, y: 0 }

  constructor() {
    window.addEventListener('keydown', (e) => this.keyDown(e))
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.reset())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset()
    })
  }

  private setDevice(d: 'kbd' | 'touch' | 'pad'): void {
    if (this.lastDevice === d) return
    this.lastDevice = d
    this.onDeviceChange?.(d)
  }

  reset(): void {
    this.keys.clear()
    this.dashQueued = false
    this.endJoy()
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    this.setDevice('kbd')
    if (!this.enabled) return
    const code = e.code
    if (code in MOVE_KEYS || code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight') e.preventDefault()
    if (e.repeat) return
    if (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight') this.dashQueued = true
    else if (code === 'Escape' || code === 'KeyP') this.onPause?.()
    else this.keys.add(code)
  }

  // ───────────────────────── 触屏 ─────────────────────────

  /** 在战斗区域上挂浮动摇杆：左半屏（左手模式为右半屏）按下的位置就是摇杆中心 */
  attachJoystick(zone: HTMLElement): void {
    this.zone = zone
    this.joyBase = document.createElement('div')
    this.joyBase.className = 'joy-base'
    this.joyKnob = document.createElement('div')
    this.joyKnob.className = 'joy-knob'
    this.joyBase.appendChild(this.joyKnob)
    zone.appendChild(this.joyBase)

    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.joyId !== -1) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const rect = zone.getBoundingClientRect()
      const half = (e.clientX - rect.left) / rect.width
      const onMoveSide = this.leftHanded ? half >= 0.5 : half < 0.5
      if (!onMoveSide && e.pointerType === 'touch') return
      if (e.pointerType === 'touch') this.setDevice('touch')
      this.joyId = e.pointerId
      this.joyX0 = e.clientX
      this.joyY0 = e.clientY
      this.joyMx = this.joyMy = 0
      try {
        zone.setPointerCapture(e.pointerId)
      } catch {
        /* 某些浏览器对合成事件会抛错，忽略 */
      }
      if (this.joyBase && this.joyKnob) {
        this.joyBase.style.display = 'block'
        this.joyBase.style.left = `${e.clientX - rect.left}px`
        this.joyBase.style.top = `${e.clientY - rect.top}px`
        this.joyKnob.style.transform = 'translate(-50%,-50%)'
      }
      e.preventDefault()
    })
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return
      let dx = e.clientX - this.joyX0
      let dy = e.clientY - this.joyY0
      const d = Math.hypot(dx, dy)
      if (d > JOY_RADIUS) {
        // 手指拖出范围时，摇杆中心跟着走（浮动摇杆的手感）
        const over = d - JOY_RADIUS
        this.joyX0 += (dx / d) * over
        this.joyY0 += (dy / d) * over
        dx = e.clientX - this.joyX0
        dy = e.clientY - this.joyY0
        if (this.joyBase && this.zone) {
          const rect = this.zone.getBoundingClientRect()
          this.joyBase.style.left = `${this.joyX0 - rect.left}px`
          this.joyBase.style.top = `${this.joyY0 - rect.top}px`
        }
      }
      const m = Math.min(1, Math.hypot(dx, dy) / JOY_RADIUS)
      const ang = Math.atan2(dy, dx)
      const dead = 0.12
      const mag = m < dead ? 0 : (m - dead) / (1 - dead)
      this.joyMx = Math.cos(ang) * mag
      this.joyMy = Math.sin(ang) * mag
      if (this.joyKnob) {
        this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
      }
    })
    const up = (e: PointerEvent): void => {
      if (e.pointerId === this.joyId) this.endJoy()
    }
    zone.addEventListener('pointerup', up)
    zone.addEventListener('pointercancel', up)
    zone.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private endJoy(): void {
    this.joyId = -1
    this.joyMx = this.joyMy = 0
    if (this.joyBase) this.joyBase.style.display = 'none'
  }

  /** 冲刺按钮（DOM 按钮）按下 */
  pressDash(): void {
    if (!this.enabled) return
    this.setDevice('touch')
    this.dashQueued = true
  }

  buzz(ms: number | number[]): void {
    if (!this.vibration) return
    if (this.lastDevice !== 'touch') return
    try {
      navigator.vibrate?.(ms)
    } catch {
      /* 忽略 */
    }
  }

  // ───────────────────────── 手柄 ─────────────────────────

  private pollPad(dt: number): { mx: number; my: number; dash: boolean } {
    const pads = navigator.getGamepads?.() ?? []
    let pad: Gamepad | null = null
    for (const p of pads) {
      if (p && p.connected) {
        pad = p
        break
      }
    }
    if (!pad) return { mx: 0, my: 0, dash: false }
    const btn = (i: number): boolean => !!pad.buttons[i]?.pressed
    const cur = pad.buttons.map((b) => b.pressed)
    const edge = (i: number): boolean => !!cur[i] && !this.padPrev[i]

    let ax = pad.axes[0] ?? 0
    let ay = pad.axes[1] ?? 0
    const m = Math.hypot(ax, ay)
    const dead = 0.18
    if (m < dead) ax = ay = 0
    else {
      const k = Math.min(1, (m - dead) / (1 - dead)) / m
      ax *= k
      ay *= k
    }
    // 十字键也能移动
    const dx = (btn(15) ? 1 : 0) - (btn(14) ? 1 : 0)
    const dy = (btn(13) ? 1 : 0) - (btn(12) ? 1 : 0)
    if (dx !== 0 || dy !== 0) {
      ax = dx
      ay = dy
    }

    const anyInput = m > 0.4 || cur.some((v, i) => v && !this.padPrev[i])
    if (anyInput) this.setDevice('pad')

    let dash = false
    if (this.enabled) {
      if (edge(0) || edge(5) || edge(7) || edge(1)) dash = true
      if (edge(9)) this.onPause?.()
    } else if (this.onNav) {
      // 菜单导航：摇杆/十字键带重复，A 确认，B 返回
      this.padNavT -= dt
      const nx = Math.abs(ax) > 0.6 ? Math.sign(ax) : 0
      const ny = Math.abs(ay) > 0.6 ? Math.sign(ay) : 0
      const changed = nx !== this.padAxisPrev.x || ny !== this.padAxisPrev.y
      if ((nx !== 0 || ny !== 0) && (changed || this.padNavT <= 0)) {
        this.onNav(nx < 0 ? 'left' : nx > 0 ? 'right' : ny < 0 ? 'up' : 'down')
        this.padNavT = changed ? 0.35 : 0.14
      }
      this.padAxisPrev = { x: nx, y: ny }
      if (edge(0)) this.onNav('confirm')
      if (edge(1)) this.onNav('back')
      if (edge(9)) this.onNav('confirm')
    }
    this.padPrev = cur
    return { mx: ax, my: ay, dash }
  }

  // ───────────────────────── 合并 ─────────────────────────

  /** 每帧调用一次；冲刺是"边沿触发"，读取后清除 */
  poll(dt: number): InputState {
    const pad = this.pollPad(dt)
    if (!this.enabled) {
      this.dashQueued = false
      return { mx: 0, my: 0, dash: false }
    }
    let mx = 0
    let my = 0
    for (const k of this.keys) {
      const v = MOVE_KEYS[k]
      if (v) {
        mx += v[0]
        my += v[1]
      }
    }
    const km = Math.hypot(mx, my)
    if (km > 1) {
      mx /= km
      my /= km
    }
    // 取模长最大的来源，避免多设备叠加后超速
    const cands: [number, number][] = [
      [mx, my],
      [this.joyMx, this.joyMy],
      [pad.mx, pad.my],
    ]
    let best: [number, number] = [0, 0]
    let bm = 0
    for (const c of cands) {
      const m = Math.hypot(c[0], c[1])
      if (m > bm) {
        bm = m
        best = c
      }
    }
    const dash = this.dashQueued || pad.dash
    this.dashQueued = false
    return { mx: clamp(best[0], -1, 1), my: clamp(best[1], -1, 1), dash }
  }
}
