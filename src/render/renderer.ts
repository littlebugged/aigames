import { SHIPS } from '../data/ships'
import { TAU, clamp01 } from '../engine/math'
import type { GameEvent } from '../game/events'
import type { World } from '../game/world'
import { Background } from './background'
import { BossArt } from './bossart'
import { Camera } from './camera'
import { Particles, FloatTexts } from './particles'
import { lighten, rgba } from './palette'
import { FACES_MOTION } from './shapes'
import { GEM_COLORS, PICKUP_COLOR, SpriteBank } from './sprites'

export type Quality = 'high' | 'medium' | 'low'

export interface RenderSettings {
  quality: Quality
  shake: boolean
  dmgNumbers: boolean
  reduceFlash: boolean
}

interface QualityCfg {
  /** 画布像素预算（宽×高×dpr²） */
  pixels: number
  dprMax: number
  bloom: boolean
  density: number
  cap: number
  nebula: boolean
}

const QUALITY: Record<Quality, QualityCfg> = {
  high: { pixels: 3.4e6, dprMax: 2, bloom: true, density: 1, cap: 2000, nebula: true },
  medium: { pixels: 2.1e6, dprMax: 1.5, bloom: true, density: 0.65, cap: 1200, nebula: true },
  low: { pixels: 1.2e6, dprMax: 1, bloom: false, density: 0.35, cap: 600, nebula: false },
}

interface Ghost {
  x: number
  y: number
  a: number
  t: number
}

interface Scheduled {
  t: number
  fn: () => void
}

const ENEMY_SPAWN_FADE = 0.5

const fmtDmg = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`)

export class Renderer {
  readonly canvas: HTMLCanvasElement
  readonly cam = new Camera()
  settings: RenderSettings

  private readonly ctx: CanvasRenderingContext2D
  private readonly bank = new SpriteBank(2.5)
  private readonly bossArt = new BossArt(2.5)
  private readonly bg = new Background()
  private readonly parts: Particles
  private readonly texts = new FloatTexts()

  private world: World | null = null

  // 视口
  private cssW = 1
  private cssH = 1
  W = 2
  H = 2
  dpr = 1
  /** 世界单位 → 设备像素 */
  k = 1
  private ox = 0
  private oy = 0
  private cx = 0
  private cy = 0
  private halfW = 640
  private halfH = 360

  // 动画状态
  private vt = 0
  private flashA = 0
  private flashColor = '#ffffff'
  private bossMix = 0
  private lastBossX = 0
  private lastBossY = 0
  private dmgBudget = 10
  private bossDmgBudget = 4
  private readonly ghosts: Ghost[] = []
  private readonly scheduled: Scheduled[] = []

  // 泛光缓冲
  private bloomHalf: HTMLCanvasElement | null = null
  private bloomQuarter: HTMLCanvasElement | null = null
  private bloomEighth: HTMLCanvasElement | null = null
  private bhC: CanvasRenderingContext2D | null = null
  private bqC: CanvasRenderingContext2D | null = null
  private beC: CanvasRenderingContext2D | null = null

  private readonly hurtVig: HTMLCanvasElement

  /** 最近一帧 CPU 耗时（毫秒，指数平滑），用于自适应画质 */
  frameMs = 0

  constructor(canvas: HTMLCanvasElement, settings: RenderSettings) {
    this.canvas = canvas
    this.settings = settings
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2d context unavailable')
    this.ctx = ctx
    this.parts = new Particles(QUALITY[settings.quality].cap)
    this.hurtVig = this.makeVignette('#ff1f4b')
    this.applyQuality()
  }

  private makeVignette(color: string): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g2 = c.getContext('2d')
    if (!g2) throw new Error('2d context unavailable')
    const g = g2.createRadialGradient(128, 128, 60, 128, 128, 182)
    g.addColorStop(0, rgba(color, 0))
    g.addColorStop(0.6, rgba(color, 0.18))
    g.addColorStop(1, rgba(color, 0.95))
    g2.fillStyle = g
    g2.fillRect(0, 0, 256, 256)
    return c
  }

  // ───────────────────────── 尺寸与画质 ─────────────────────────

  private applyQuality(): void {
    const q = QUALITY[this.settings.quality]
    this.parts.density = q.density
    this.bg.nebulaOn = q.nebula
  }

  setQuality(q: Quality): void {
    this.settings.quality = q
    this.applyQuality()
    this.resize(this.cssW, this.cssH)
  }

  resize(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, cssW)
    this.cssH = Math.max(1, cssH)
    const q = QUALITY[this.settings.quality]
    let dpr = Math.min(window.devicePixelRatio || 1, q.dprMax)
    const px = this.cssW * this.cssH * dpr * dpr
    if (px > q.pixels) dpr *= Math.sqrt(q.pixels / px)
    dpr = Math.max(0.5, dpr)
    const W = Math.max(2, Math.round(this.cssW * dpr))
    const H = Math.max(2, Math.round(this.cssH * dpr))
    if (this.canvas.width !== W) this.canvas.width = W
    if (this.canvas.height !== H) this.canvas.height = H
    this.W = W
    this.H = H
    this.dpr = W / this.cssW
    this.k = Camera.scaleFor(this.cssW, this.cssH) * this.dpr
    this.halfW = W / (2 * this.k)
    this.halfH = H / (2 * this.k)
    this.ctx.imageSmoothingEnabled = true
    this.ctx.imageSmoothingQuality = 'high'
    this.ensureBloom()
    this.syncView()
  }

  private syncView(): void {
    if (!this.world) return
    this.world.viewHalfW = this.halfW
    this.world.viewHalfH = this.halfH
  }

  private ensureBloom(): void {
    const mk = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const c = document.createElement('canvas')
      c.width = Math.max(2, w)
      c.height = Math.max(2, h)
      const g = c.getContext('2d')
      if (!g) throw new Error('2d context unavailable')
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      return [c, g]
    }
    ;[this.bloomHalf, this.bhC] = mk(this.W >> 1, this.H >> 1)
    ;[this.bloomQuarter, this.bqC] = mk(this.W >> 2, this.H >> 2)
    ;[this.bloomEighth, this.beC] = mk(this.W >> 3, this.H >> 3)
  }

  // ───────────────────────── 生命周期 ─────────────────────────

  attach(w: World): void {
    this.world = w
    this.parts.clear()
    this.texts.clear()
    this.scheduled.length = 0
    this.ghosts.length = 0
    this.flashA = 0
    this.bossMix = 0
    this.bg.setPalette(w.sector.palette)
    this.cam.reset(w.player.x, w.player.y)
    this.cx = w.player.x
    this.cy = w.player.y
    this.syncView()
  }

  /** 屏幕坐标（CSS 像素）→ 世界坐标，给触摸/鼠标瞄准用 */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    const sx = ((clientX - rect.left) / rect.width) * this.W
    const sy = ((clientY - rect.top) / rect.height) * this.H
    return { x: (sx - this.W / 2) / this.k + this.cx, y: (sy - this.H / 2) / this.k + this.cy }
  }

  // ───────────────────────── 事件 → 特效 ─────────────────────────

  onEvent(e: GameEvent): void {
    const w = this.world
    if (!w) return
    const p = w.player
    const P = this.parts
    switch (e.t) {
      case 'shot':
        if (e.w === 'pulse') P.sparkCone(e.x + Math.cos(e.a) * 12, e.y + Math.sin(e.a) * 12, e.a, 0.5, '#3df2ff', 2, 140, 0.16)
        break
      case 'hit': {
        P.spark(e.x, e.y, e.crit ? '#ffe66b' : lighten(e.color, 0.3), e.crit ? 6 : 3, e.crit ? 260 : 150, 0.28, e.crit ? 2.2 : 1.6)
        if (this.settings.dmgNumbers) this.hitNumber(e.x, e.y, e.dmg, e.crit, e.boss)
        break
      }
      case 'kill': {
        const big = e.big || e.elite
        P.burst(e.x, e.y, e.color, big ? 16 : 6, 120 + e.r * 7, 5 + e.r * 0.28, 0.5)
        P.shards(e.x, e.y, e.color, big ? 12 : 4, 150 + e.r * 7, 3.4, 0.55)
        P.ring(e.x, e.y, e.r * 0.4, e.r * (big ? 3.6 : 2.3), e.color, big ? 0.45 : 0.32, big ? 3.2 : 2)
        if (e.elite) {
          this.cam.addTrauma(0.26)
          P.ring(e.x, e.y, e.r, e.r * 5, '#ffd84a', 0.55, 3)
          P.spark(e.x, e.y, '#ffffff', 14, 320, 0.4)
        } else if (e.big) this.cam.addTrauma(0.12)
        break
      }
      case 'hurt': {
        this.cam.addTrauma(Math.min(0.75, 0.3 + e.dmg * 0.012))
        P.burst(p.x, p.y, '#ff3b5c', 10, 220, 6, 0.4)
        P.spark(p.x, p.y, '#ffffff', 8, 260, 0.3)
        if (this.settings.dmgNumbers) this.texts.add(p.x, p.y - 20, `-${Math.round(e.dmg)}`, '#ff5c7a', 17, 0.9)
        break
      }
      case 'gem': {
        const tier = e.value < 4 ? 0 : e.value < 12 ? 1 : e.value < 40 ? 2 : 3
        P.spark(e.x, e.y, GEM_COLORS[tier], 2, 110, 0.22, 1.5)
        break
      }
      case 'pickup': {
        const col = PICKUP_COLOR[e.kind]
        const big = e.kind === 'chest'
        P.ring(e.x, e.y, 8, big ? 80 : 46, col, big ? 0.55 : 0.4, 3)
        P.burst(e.x, e.y, col, big ? 22 : 10, big ? 260 : 170, 6, 0.55)
        if (big) {
          this.cam.addTrauma(0.15)
          this.flash('#ffd84a', 0.12)
        }
        break
      }
      case 'levelup':
        P.ring(p.x, p.y, 14, 210, '#3df2ff', 0.65, 4)
        P.ring(p.x, p.y, 8, 140, '#ffffff', 0.5, 2.5)
        P.burst(p.x, p.y, '#3df2ff', 22, 300, 7, 0.7)
        this.flash('#3df2ff', 0.2)
        break
      case 'dash':
        P.sparkCone(e.x - Math.cos(e.a) * 10, e.y - Math.sin(e.a) * 10, e.a + Math.PI, 1.2, SHIPS[w.cfg.ship].accent, 18, 300, 0.32)
        P.ring(e.x, e.y, 6, 52, SHIPS[w.cfg.ship].color, 0.3, 2.4)
        break
      case 'blast': {
        P.ring(e.x, e.y, e.r * 0.15, e.r, e.color, 0.4, 4)
        P.burst(e.x, e.y, e.color, 8 + e.r * 0.1, e.r * 2.6, 8, 0.45)
        P.shards(e.x, e.y, e.color, 4 + e.r * 0.04, e.r * 2.4, 3.6, 0.5)
        this.cam.addTrauma(Math.min(0.42, e.r / 420))
        break
      }
      case 'spark':
        P.spark(e.x, e.y, e.color, e.n, 180)
        break
      case 'boss':
        this.bossEvent(e.what)
        break
      case 'revive':
        P.ring(e.x, e.y, 10, 340, '#ffffff', 0.8, 6)
        P.ring(e.x, e.y, 10, 220, '#6dff8a', 0.7, 4)
        P.burst(e.x, e.y, '#6dff8a', 30, 360, 8, 0.8)
        this.flash('#ffffff', 0.5)
        this.cam.addTrauma(0.5)
        break
      case 'evolve': {
        const gold = '#ffd84a'
        for (let i = 0; i < 3; i++) {
          this.schedule(i * 0.14, () => {
            P.ring(p.x, p.y, 10, 170 + i * 70, i === 1 ? '#ffffff' : gold, 0.7, 4)
          })
        }
        P.burst(p.x, p.y, gold, 34, 340, 8, 0.85)
        P.spark(p.x, p.y, '#ffffff', 22, 380, 0.5)
        this.flash(gold, 0.3)
        this.cam.addTrauma(0.3)
        break
      }
      case 'end':
        if (!e.won) this.playerExplosion()
        break
      default:
        break
    }
  }

  private hitNumber(x: number, y: number, dmg: number, crit: boolean, boss: boolean): void {
    if (crit) {
      this.texts.add(x, y - 10, fmtDmg(dmg), '#ffd84a', 19, 0.8)
      return
    }
    if (boss) {
      if (this.bossDmgBudget < 1) return
      this.bossDmgBudget -= 1
      this.texts.add(x + (Math.random() - 0.5) * 60, y - 30 - Math.random() * 30, fmtDmg(dmg), '#ffc2cc', 14, 0.7)
      return
    }
    if (this.dmgBudget < 1) return
    this.dmgBudget -= 1
    this.texts.add(x, y - 8, fmtDmg(dmg), dmg >= 40 ? '#ffffff' : '#bfefff', dmg >= 40 ? 14 : 12, 0.6)
  }

  private flash(color: string, a: number): void {
    if (this.settings.reduceFlash) return
    this.flashColor = color
    this.flashA = Math.max(this.flashA, a)
  }

  private schedule(delay: number, fn: () => void): void {
    this.scheduled.push({ t: delay, fn })
  }

  private bossEvent(what: 'spawn' | 'phase' | 'dead'): void {
    const w = this.world
    if (!w) return
    const b = w.boss
    const x = b ? b.x : this.lastBossX
    const y = b ? b.y : this.lastBossY
    const P = this.parts
    if (what === 'spawn') {
      this.cam.addTrauma(0.55)
      this.flash('#ff3e6c', 0.25)
    } else if (what === 'phase') {
      this.cam.addTrauma(0.7)
      this.flash('#ffffff', 0.35)
      const r = b ? b.r : 60
      P.ring(x, y, r, r * 5.5, '#ffffff', 0.7, 5)
      P.ring(x, y, r * 0.5, r * 4, '#ff3e6c', 0.6, 3)
      P.shards(x, y, '#ff6a8a', 30, 420, 5, 0.9)
    } else {
      // 连环爆炸 + 终结一击
      const r = b ? b.r : 60
      const cols = ['#ffffff', '#ffd84a', '#ff6a8a', '#ffb347']
      for (let i = 0; i < 16; i++) {
        this.schedule(i * 0.1, () => {
          const a = Math.random() * TAU
          const d = Math.random() * r * 1.1
          const ex = x + Math.cos(a) * d
          const ey = y + Math.sin(a) * d
          const c = cols[i % cols.length]
          P.burst(ex, ey, c, 14, 320, 9, 0.7)
          P.ring(ex, ey, 6, 40 + Math.random() * 60, c, 0.4, 3)
          P.shards(ex, ey, c, 8, 300, 4, 0.7)
          this.cam.addTrauma(0.22)
        })
      }
      this.schedule(1.7, () => {
        P.ring(x, y, r, 760, '#ffffff', 1.0, 8)
        P.ring(x, y, r * 0.6, 520, '#ffd84a', 0.9, 5)
        P.burst(x, y, '#ffffff', 70, 620, 12, 1.0)
        P.shards(x, y, '#ffd84a', 40, 560, 6, 1.0)
        this.cam.addTrauma(1)
        this.flash('#ffffff', 0.85)
      })
    }
  }

  private playerExplosion(): void {
    const w = this.world
    if (!w) return
    const p = w.player
    const col = SHIPS[w.cfg.ship].color
    const P = this.parts
    P.ring(p.x, p.y, 8, 260, '#ffffff', 0.7, 5)
    P.ring(p.x, p.y, 8, 170, col, 0.6, 4)
    P.burst(p.x, p.y, col, 40, 460, 10, 0.9)
    P.burst(p.x, p.y, '#ffffff', 16, 300, 8, 0.6)
    P.shards(p.x, p.y, col, 30, 480, 5, 1.0)
    this.cam.addTrauma(0.9)
    this.flash('#ff3b5c', 0.4)
  }

  // ───────────────────────── 主绘制 ─────────────────────────

  /** animDt 是"视觉时间步长"：暂停/升级选择时传 0，粒子与镜头就会定格 */
  frame(w: World, animDt: number): void {
    const t0 = performance.now()
    if (this.world !== w) this.attach(w)
    const ctx = this.ctx
    const p = w.player
    const k = this.k

    this.vt += animDt
    // 预算回填
    this.dmgBudget = Math.min(12, this.dmgBudget + animDt * 30)
    this.bossDmgBudget = Math.min(4, this.bossDmgBudget + animDt * 7)

    // 预定事件（Boss 连环爆炸等）
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      const s = this.scheduled[i]
      s.t -= animDt
      if (s.t <= 0) {
        this.scheduled.splice(i, 1)
        s.fn()
      }
    }

    const boss = w.boss && w.boss.alive ? w.boss : null
    if (boss) {
      this.lastBossX = boss.x
      this.lastBossY = boss.y
    }
    this.bossMix += ((boss && boss.intro <= 0 ? 1 : 0) - this.bossMix) * Math.min(1, animDt * 1.6)

    this.cam.update(animDt, p.x, p.y, p.vx, p.vy, this.settings.shake)
    this.parts.update(animDt)
    this.texts.update(animDt)
    this.flashA = Math.max(0, this.flashA - animDt * 2.4)
    this.updateGhosts(w, animDt)

    this.cx = this.cam.x + this.cam.sx
    this.cy = this.cam.y + this.cam.sy
    this.ox = this.W / 2 - this.cx * k
    this.oy = this.H / 2 - this.cy * k

    // 背景（屏幕空间）
    this.bg.draw(ctx, this.cx, this.cy, this.W, this.H, k, this.vt, this.bossMix)

    // 世界空间
    this.worldT()
    this.drawMines(w)
    this.drawTelegraphs(w)
    this.drawGems(w)
    this.drawPickups(w)
    this.drawEnemiesUnder(w)
    this.drawEnemies(w)
    this.drawEnemiesOver(w)
    if (boss) this.bossArt.draw(ctx, boss, p.x, p.y, this.vt, this.bank)
    this.drawBeams(w)
    this.drawRings(w)
    this.drawEnemyBullets(w)
    this.drawGhosts(w)
    this.drawPlayerWeapons(w)
    this.drawPlayerBullets(w, animDt)
    this.drawPlayer(w)
    this.drawBolts(w)
    this.drawBlasts(w)
    this.parts.draw(ctx, this.bank)
    this.texts.draw(ctx)

    // 屏幕空间后处理
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (QUALITY[this.settings.quality].bloom) this.bloomPass()
    this.drawIndicators(w, boss)
    this.drawOverlays(w)

    const dt = performance.now() - t0
    this.frameMs += (dt - this.frameMs) * 0.08
  }

  private worldT(): void {
    this.ctx.setTransform(this.k, 0, 0, this.k, this.ox, this.oy)
    this.ctx.globalAlpha = 1
    this.ctx.globalCompositeOperation = 'source-over'
  }

  private inView(x: number, y: number, m: number): boolean {
    return Math.abs(x - this.cx) < this.halfW + m && Math.abs(y - this.cy) < this.halfH + m
  }

  // ───────────────────────── 地面层 ─────────────────────────

  private drawMines(w: World): void {
    const ctx = this.ctx
    for (const m of w.mines) {
      if (!m.alive || !this.inView(m.x, m.y, 150)) continue
      const armed = m.age >= m.arm
      const col = '#5dff9e'
      ctx.save()
      ctx.translate(m.x, m.y)
      if (m.pulling > 0) {
        // 引力井：向内收缩的光环
        const f = m.pulling / 0.55
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 3; i++) {
          const ff = (f + i / 3) % 1
          ctx.strokeStyle = rgba('#b8ffd9', 0.6 * (1 - ff))
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(0, 0, m.pull * ff, 0, TAU)
          ctx.stroke()
        }
        ctx.globalCompositeOperation = 'source-over'
      } else if (armed) {
        ctx.strokeStyle = rgba(col, 0.1 + 0.05 * Math.sin(this.vt * 4 + m.x))
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(0, 0, m.trigger, 0, TAU)
        ctx.stroke()
      }
      ctx.rotate(this.vt * 1.6 + m.x)
      const s = armed ? 7 : 5 + 2 * (m.age / m.arm)
      ctx.beginPath()
      ctx.moveTo(s, 0)
      ctx.lineTo(0, s)
      ctx.lineTo(-s, 0)
      ctx.lineTo(0, -s)
      ctx.closePath()
      ctx.fillStyle = rgba(col, armed ? 0.4 : 0.15)
      ctx.fill()
      ctx.strokeStyle = rgba(col, 0.95)
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()
      if (armed) {
        const g = this.bank.glow(col)
        const blink = 0.45 + 0.4 * Math.sin(this.vt * 9 + m.y)
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = blink
        ctx.drawImage(g.c, m.x - 12, m.y - 12, 24, 24)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }
    }
  }

  private drawTelegraphs(w: World): void {
    const ctx = this.ctx
    for (const tl of w.teles) {
      if (!tl.alive) continue
      const p = 1 - tl.t / tl.maxT
      if (tl.kind === 'circle') {
        if (!this.inView(tl.x, tl.y, tl.r + 40)) continue
        ctx.fillStyle = rgba(tl.color, 0.05 + 0.15 * p)
        ctx.beginPath()
        ctx.arc(tl.x, tl.y, tl.r, 0, TAU)
        ctx.fill()
        ctx.strokeStyle = rgba(tl.color, 0.5 + 0.4 * p)
        ctx.lineWidth = 2
        ctx.setLineDash([8, 6])
        ctx.stroke()
        ctx.setLineDash([])
        ctx.strokeStyle = rgba(tl.color, 0.9)
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(tl.x, tl.y, tl.r * p, 0, TAU)
        ctx.stroke()
      } else {
        const dx = tl.x2 - tl.x
        const dy = tl.y2 - tl.y
        const len = Math.hypot(dx, dy)
        const mx = (tl.x + tl.x2) / 2
        const my = (tl.y + tl.y2) / 2
        if (!this.inView(mx, my, len / 2 + tl.r + 40)) continue
        ctx.save()
        ctx.translate(tl.x, tl.y)
        ctx.rotate(Math.atan2(dy, dx))
        ctx.fillStyle = rgba(tl.color, 0.05 + 0.17 * p)
        ctx.fillRect(0, -tl.r, len, tl.r * 2)
        ctx.strokeStyle = rgba(tl.color, 0.35 + 0.5 * p)
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(0, -tl.r)
        ctx.lineTo(len, -tl.r)
        ctx.moveTo(0, tl.r)
        ctx.lineTo(len, tl.r)
        ctx.stroke()
        // 中心线随时间变亮
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = rgba(tl.color, 0.15 + 0.7 * p)
        ctx.lineWidth = 2 + 4 * p
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(len, 0)
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  private drawGems(w: World): void {
    const ctx = this.ctx
    const bank = this.bank
    for (const g of w.gems) {
      if (!g.alive || !this.inView(g.x, g.y, 20)) continue
      const s = bank.gem[g.tier]
      const bob = g.mag ? 0 : Math.sin(this.vt * 4 + g.x * 0.05) * 1.3
      ctx.drawImage(s.c, g.x - s.w / 2, g.y - s.h / 2 + bob, s.w, s.h)
    }
  }

  private drawPickups(w: World): void {
    const ctx = this.ctx
    const bank = this.bank
    for (const pk of w.pickups) {
      if (!pk.alive || !this.inView(pk.x, pk.y, 60)) continue
      const col = PICKUP_COLOR[pk.kind]
      const bob = Math.sin(this.vt * 3 + pk.x * 0.1) * 2.2
      const s = bank.pickup[pk.kind]
      const special = pk.kind === 'chest' || pk.kind === 'cache'
      // 光晕
      const g = bank.glow(col)
      const gs = special ? 62 : 44
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.45 + 0.2 * Math.sin(this.vt * 4 + pk.y * 0.1)
      ctx.drawImage(g.c, pk.x - gs / 2, pk.y + bob - gs / 2, gs, gs)
      if (pk.kind === 'chest') {
        // 宝箱的光柱，远处也能看见
        ctx.globalAlpha = 0.5
        ctx.fillStyle = rgba(col, 0.35)
        ctx.fillRect(pk.x - 2, pk.y - 90, 4, 90)
        ctx.fillStyle = rgba('#ffffff', 0.5)
        ctx.fillRect(pk.x - 0.8, pk.y - 90, 1.6, 90)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(s.c, pk.x - s.w / 2, pk.y + bob - s.h / 2, s.w, s.h)
    }
  }

  // ───────────────────────── 敌人 ─────────────────────────

  private drawEnemiesUnder(w: World): void {
    const ctx = this.ctx
    for (const e of w.enemies) {
      if (!e.alive || e.spawnT > 0) continue
      const ai = e.def.ai
      if (ai === 'charger' && e.state === 1) {
        if (!this.inView(e.x, e.y, 360)) continue
        // 冲锋预警线：最后 0.2s 锁定后变亮
        const locked = e.timer <= 0.2
        const prog = 1 - e.timer / 0.7
        const len = e.speed * 5.4 * 0.55
        ctx.save()
        ctx.translate(e.x, e.y)
        ctx.rotate(Math.atan2(e.ay, e.ax))
        ctx.fillStyle = rgba('#ff6a2e', locked ? 0.3 : 0.08 + 0.12 * prog)
        ctx.fillRect(0, -e.r, len, e.r * 2)
        ctx.strokeStyle = rgba('#ff9a5e', locked ? 0.95 : 0.4 + 0.3 * prog)
        ctx.lineWidth = locked ? 2.4 : 1.4
        ctx.beginPath()
        ctx.moveTo(0, -e.r)
        ctx.lineTo(len, -e.r)
        ctx.moveTo(0, e.r)
        ctx.lineTo(len, e.r)
        ctx.stroke()
        ctx.restore()
      } else if (ai === 'bomber' && e.state === 1) {
        if (!this.inView(e.x, e.y, 100)) continue
        ctx.fillStyle = rgba('#ff2fd6', 0.05 + 0.18 * e.aux)
        ctx.beginPath()
        ctx.arc(e.x, e.y, 84, 0, TAU)
        ctx.fill()
        ctx.strokeStyle = rgba('#ff7fe9', 0.5 + 0.4 * e.aux)
        ctx.lineWidth = 2
        ctx.setLineDash([7, 5])
        ctx.beginPath()
        ctx.arc(e.x, e.y, 84, 0, TAU)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.strokeStyle = rgba('#ffffff', 0.8)
        ctx.lineWidth = 2.4
        ctx.beginPath()
        ctx.arc(e.x, e.y, 84 * e.aux, 0, TAU)
        ctx.stroke()
      } else if (ai === 'shielder') {
        if (!this.inView(e.x, e.y, 140)) continue
        ctx.fillStyle = rgba('#b36bff', 0.035 + 0.015 * Math.sin(this.vt * 3 + e.id))
        ctx.beginPath()
        ctx.arc(e.x, e.y, 130, 0, TAU)
        ctx.fill()
        ctx.strokeStyle = rgba('#b36bff', 0.2)
        ctx.lineWidth = 1.4
        ctx.setLineDash([5, 9])
        ctx.lineDashOffset = -this.vt * 14
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }

  private drawEnemies(w: World): void {
    const ctx = this.ctx
    const bank = this.bank
    const k = this.k
    const ox = this.ox
    const oy = this.oy
    for (const e of w.enemies) {
      if (!e.alive || !this.inView(e.x, e.y, 40)) continue
      const def = e.def
      const pair = bank.enemy[def.id]
      let alpha = 1
      let sc = 1
      if (e.spawnT > 0) {
        const t = clamp01(1 - e.spawnT / ENEMY_SPAWN_FADE)
        alpha = 0.15 + 0.85 * t
        sc = 0.55 + 0.45 * t
      }
      if (def.ai === 'wraith' && e.state !== 0) alpha *= 0.12 + 0.88 * e.aux
      let ang: number
      if (FACES_MOTION[def.shape]) ang = e.angle
      else ang = e.age * (def.shape === 'oct' ? 0.5 : 1.1) * (e.id % 2 === 0 ? 1 : -1) + e.id
      const c = Math.cos(ang) * k * sc
      const s = Math.sin(ang) * k * sc
      ctx.setTransform(c, s, -s, c, ox + e.x * k, oy + e.y * k)
      ctx.globalAlpha = alpha
      const sp = pair.n
      ctx.drawImage(sp.c, -sp.w / 2, -sp.h / 2, sp.w, sp.h)
      // 受击 / 即将爆炸时闪白
      let hot = e.flash > 0 ? clamp01(e.flash / 0.05) : 0
      if (def.ai === 'bomber' && e.state === 1 && Math.floor(this.vt * (8 + e.aux * 14)) % 2 === 0) hot = Math.max(hot, 0.8)
      if (hot > 0) {
        ctx.globalAlpha = alpha * hot
        const f = pair.f
        ctx.drawImage(f.c, -f.w / 2, -f.h / 2, f.w, f.h)
      }
    }
    this.worldT()
  }

  private drawEnemiesOver(w: World): void {
    const ctx = this.ctx
    for (const e of w.enemies) {
      if (!e.alive || e.spawnT <= 0 && !e.elite && e.shielded <= 0 && !(e.def.ai === 'shooter' && e.aux > 0)) {
        continue
      }
      if (!this.inView(e.x, e.y, 50)) continue
      if (e.spawnT > 0) {
        // 传送入场的收束光环
        const t = clamp01(e.spawnT / ENEMY_SPAWN_FADE)
        ctx.strokeStyle = rgba(e.def.color, 0.7 * t)
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(e.x, e.y, e.r * (1 + t * 2.4), 0, TAU)
        ctx.stroke()
        continue
      }
      if (e.shielded > 0) {
        ctx.strokeStyle = rgba('#c58bff', 0.55)
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(e.x, e.y, e.r + 5, 0, TAU)
        ctx.stroke()
      }
      if (e.def.ai === 'shooter' && e.aux > 0) {
        // 开火前摇
        ctx.strokeStyle = rgba('#fff3a8', 0.4 + 0.5 * Math.sin(this.vt * 40) ** 2)
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(e.x, e.y, e.r + 5, 0, TAU)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(e.x, e.y)
        ctx.lineTo(e.x + Math.cos(e.angle) * 46, e.y + Math.sin(e.angle) * 46)
        ctx.stroke()
      }
      if (e.elite) {
        const rr = e.r * 1.35 + 3
        ctx.save()
        ctx.translate(e.x, e.y)
        ctx.rotate(this.vt * 1.4)
        ctx.strokeStyle = rgba('#ffd84a', 0.85)
        ctx.lineWidth = 2.2
        ctx.setLineDash([rr * 0.9, rr * 0.55])
        ctx.beginPath()
        ctx.arc(0, 0, rr, 0, TAU)
        ctx.stroke()
        ctx.restore()
        // 血条
        const bw = Math.max(30, e.r * 2.2)
        const by = e.y - e.r - 14
        ctx.fillStyle = 'rgba(8,8,24,0.7)'
        ctx.fillRect(e.x - bw / 2 - 1, by - 1, bw + 2, 6)
        ctx.fillStyle = '#ffd84a'
        ctx.fillRect(e.x - bw / 2, by, bw * clamp01(e.hp / e.maxHp), 4)
      }
    }
    ctx.setLineDash([])
  }

  // ───────────────────────── 弹幕与特效层 ─────────────────────────

  private drawEnemyBullets(w: World): void {
    const ctx = this.ctx
    const bank = this.bank
    ctx.globalCompositeOperation = 'lighter'
    for (const b of w.ebullets) {
      if (!b.alive || !this.inView(b.x, b.y, 20)) continue
      if (b.kind === 'needle') {
        ctx.strokeStyle = rgba(b.color, 0.85)
        ctx.lineWidth = b.r * 1.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(b.x - b.vx * 0.05, b.y - b.vy * 0.05)
        ctx.stroke()
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'
        ctx.lineWidth = b.r * 0.6
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(b.x - b.vx * 0.032, b.y - b.vy * 0.032)
        ctx.stroke()
      } else {
        const g = bank.glow(b.color)
        const s = b.r * 4
        ctx.drawImage(g.c, b.x - s / 2, b.y - s / 2, s, s)
      }
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawBeams(w: World): void {
    const ctx = this.ctx
    const bank = this.bank
    ctx.globalCompositeOperation = 'lighter'
    for (const bm of w.beams) {
      if (!bm.alive) continue
      if (!this.inView(bm.ox, bm.oy, bm.len + 40)) continue
      const age = bm.maxLife - bm.life
      const life = bm.maxLife > 0 ? clamp01(bm.life / bm.maxLife) : 1
      const env = bm.warn > 0 ? 0.25 : Math.min(1, age / 0.07 + 0.2) * Math.min(1, life / 0.35)
      const width = bm.width * (0.3 + 0.7 * env)
      const flick = 0.92 + 0.08 * Math.sin(this.vt * 70 + bm.ang * 9)
      ctx.save()
      ctx.translate(bm.ox, bm.oy)
      ctx.rotate(bm.ang)
      ctx.fillStyle = rgba(bm.color, 0.2 * env * flick)
      ctx.fillRect(0, -width * 0.9, bm.len, width * 1.8)
      ctx.fillStyle = rgba(bm.color, 0.5 * env * flick)
      ctx.fillRect(0, -width * 0.5, bm.len, width)
      ctx.fillStyle = rgba('#ffffff', 0.92 * env * flick)
      ctx.fillRect(0, -width * 0.2, bm.len, width * 0.4)
      ctx.restore()
      const g = bank.glow(bm.color)
      const gs = width * 3.6
      ctx.globalAlpha = Math.min(1, env)
      ctx.drawImage(g.c, bm.ox - gs / 2, bm.oy - gs / 2, gs, gs)
      ctx.globalAlpha = 1
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawRings(w: World): void {
    const ctx = this.ctx
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'butt'
    for (const rg of w.rings) {
      if (!rg.alive || rg.delay > 0) continue
      if (!this.inView(rg.x, rg.y, rg.r + 30)) continue
      const p = clamp01(rg.r / rg.maxR)
      const a = 1 - p * 0.75
      if (rg.hostile) {
        ctx.strokeStyle = rgba(rg.color, 0.28 * a)
        ctx.lineWidth = 26
        ctx.beginPath()
        ctx.arc(rg.x, rg.y, rg.r, 0, TAU)
        ctx.stroke()
        ctx.strokeStyle = rgba(rg.color, 0.9 * a)
        ctx.lineWidth = 8
        ctx.stroke()
        ctx.strokeStyle = rgba('#ffffff', 0.95 * a)
        ctx.lineWidth = 2.4
        ctx.stroke()
      } else {
        ctx.strokeStyle = rgba(rg.color, 0.22 * a)
        ctx.lineWidth = 22
        ctx.beginPath()
        ctx.arc(rg.x, rg.y, rg.r, 0, TAU)
        ctx.stroke()
        ctx.strokeStyle = rgba(rg.color, 0.75 * a)
        ctx.lineWidth = 6
        ctx.stroke()
        ctx.strokeStyle = rgba('#ffffff', 0.9 * a)
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawBolts(w: World): void {
    const ctx = this.ctx
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const bt of w.bolts) {
      if (!bt.alive) continue
      const f = clamp01(bt.life / bt.maxLife)
      const pts = bt.pts
      // 抖动折线：每段在中点处加一个随机偏移
      const path = (): void => {
        ctx.beginPath()
        ctx.moveTo(pts[0], pts[1])
        for (let i = 2; i < pts.length; i += 2) {
          const x0 = pts[i - 2]
          const y0 = pts[i - 1]
          const x1 = pts[i]
          const y1 = pts[i + 1]
          const dx = x1 - x0
          const dy = y1 - y0
          const len = Math.hypot(dx, dy) || 1
          const nx = -dy / len
          const ny = dx / len
          const j = Math.min(14, len * 0.16)
          const o1 = (Math.random() - 0.5) * 2 * j
          const o2 = (Math.random() - 0.5) * 2 * j
          ctx.lineTo(x0 + dx * 0.33 + nx * o1, y0 + dy * 0.33 + ny * o1)
          ctx.lineTo(x0 + dx * 0.66 + nx * o2, y0 + dy * 0.66 + ny * o2)
          ctx.lineTo(x1, y1)
        }
      }
      path()
      ctx.strokeStyle = rgba(bt.color, 0.28 * f)
      ctx.lineWidth = 11
      ctx.stroke()
      path()
      ctx.strokeStyle = rgba(bt.color, 0.9 * f)
      ctx.lineWidth = 3.6
      ctx.stroke()
      path()
      ctx.strokeStyle = rgba('#ffffff', 0.95 * f)
      ctx.lineWidth = 1.4
      ctx.stroke()
      // 命中点的小闪光
      const g = this.bank.glow(bt.color)
      ctx.globalAlpha = f
      for (let i = 2; i < pts.length; i += 2) {
        ctx.drawImage(g.c, pts[i] - 16, pts[i + 1] - 16, 32, 32)
      }
      ctx.globalAlpha = 1
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawBlasts(w: World): void {
    const ctx = this.ctx
    const bank = this.bank
    ctx.globalCompositeOperation = 'lighter'
    for (const b of w.blasts) {
      if (!b.alive || !this.inView(b.x, b.y, b.r + 40)) continue
      const lp = clamp01(b.life / b.maxLife)
      const grow = 1 - lp * lp
      const g = bank.glow(b.color)
      const gs = b.r * 2.6 * (0.55 + 0.45 * grow)
      ctx.globalAlpha = Math.min(1, lp * 1.3)
      ctx.drawImage(g.c, b.x - gs / 2, b.y - gs / 2, gs, gs)
      ctx.fillStyle = rgba(b.color, 0.28 * lp)
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r * (0.4 + 0.6 * grow), 0, TAU)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  // ───────────────────────── 玩家与武器 ─────────────────────────

  private updateGhosts(w: World, dt: number): void {
    const p = w.player
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].t -= dt
      if (this.ghosts[i].t <= 0) this.ghosts.splice(i, 1)
    }
    if (p.dashT > 0 && dt > 0 && this.ghosts.length < 30) {
      this.ghosts.push({ x: p.x, y: p.y, a: p.face, t: 0.3 })
    }
  }

  private drawGhosts(w: World): void {
    if (this.ghosts.length === 0) return
    const ctx = this.ctx
    const spr = this.bank.ship[w.cfg.ship].n
    ctx.globalCompositeOperation = 'lighter'
    for (const g of this.ghosts) {
      ctx.save()
      ctx.translate(g.x, g.y)
      ctx.rotate(g.a)
      ctx.globalAlpha = (g.t / 0.3) * 0.45
      ctx.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h)
      ctx.restore()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawPlayerWeapons(w: World): void {
    const ctx = this.ctx
    const bank = this.bank
    for (const wi of w.player.weapons) {
      if (wi.id === 'orbit') {
        const col = wi.evolved ? '#fff1b8' : '#8fb8ff'
        const spr = bank.blade(col)
        for (const pt of wi.pts) {
          const sc = (pt.r * 1.5) / 20
          ctx.save()
          ctx.translate(pt.x, pt.y)
          ctx.rotate(pt.a + Math.PI / 2)
          ctx.scale(sc, sc)
          ctx.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h)
          ctx.restore()
        }
        // 拖尾：每片光刃后面一道淡淡的弧
        if (wi.pts.length > 0) {
          ctx.globalCompositeOperation = 'lighter'
          ctx.strokeStyle = rgba(col, 0.18)
          ctx.lineWidth = 3
          const p = w.player
          for (const pt of wi.pts) {
            const rr = Math.hypot(pt.x - p.x, pt.y - p.y)
            ctx.beginPath()
            ctx.arc(p.x, p.y, rr, pt.a - 0.55, pt.a - 0.04)
            ctx.stroke()
          }
          ctx.globalCompositeOperation = 'source-over'
        }
      } else if (wi.id === 'drone') {
        const spr = bank.drone(wi.evolved ? '#c8ffe0' : '#7dffb0')
        for (const pt of wi.pts) {
          ctx.save()
          ctx.translate(pt.x, pt.y)
          ctx.rotate(pt.a + Math.PI / 2)
          ctx.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h)
          ctx.restore()
        }
      }
    }
  }

  private drawPlayerBullets(w: World, animDt: number): void {
    const ctx = this.ctx
    const bank = this.bank
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (const b of w.pbullets) {
      if (!b.alive || !this.inView(b.x, b.y, 40)) continue
      const sp = Math.hypot(b.vx, b.vy) || 1
      const dx = b.vx / sp
      const dy = b.vy / sp
      switch (b.kind) {
        case 'bolt':
        case 'drone': {
          const len = b.kind === 'bolt' ? 20 + b.r * 2 : 14
          ctx.strokeStyle = rgba(b.color, 0.5)
          ctx.lineWidth = b.r * 2.4
          ctx.beginPath()
          ctx.moveTo(b.x, b.y)
          ctx.lineTo(b.x - dx * len, b.y - dy * len)
          ctx.stroke()
          ctx.strokeStyle = 'rgba(255,255,255,0.95)'
          ctx.lineWidth = b.r * 0.9
          ctx.beginPath()
          ctx.moveTo(b.x, b.y)
          ctx.lineTo(b.x - dx * len * 0.6, b.y - dy * len * 0.6)
          ctx.stroke()
          const g = bank.glow(b.color)
          const gs = b.r * 5.5
          ctx.drawImage(g.c, b.x - gs / 2, b.y - gs / 2, gs, gs)
          break
        }
        case 'plasma': {
          const g = bank.glow(b.color)
          const gs = b.r * 7
          ctx.strokeStyle = rgba(b.color, 0.45)
          ctx.lineWidth = b.r * 1.6
          ctx.beginPath()
          ctx.moveTo(b.x, b.y)
          ctx.lineTo(b.x - dx * 26, b.y - dy * 26)
          ctx.stroke()
          ctx.drawImage(g.c, b.x - gs / 2, b.y - gs / 2, gs, gs)
          break
        }
        case 'missile': {
          // 尾焰
          const fl = bank.glow('#ffb347')
          const fs = 22 + 6 * Math.sin(this.vt * 60 + b.x)
          ctx.drawImage(fl.c, b.x - dx * 8 - fs / 2, b.y - dy * 8 - fs / 2, fs, fs)
          ctx.globalCompositeOperation = 'source-over'
          ctx.save()
          ctx.translate(b.x, b.y)
          ctx.rotate(Math.atan2(dy, dx))
          ctx.beginPath()
          ctx.moveTo(8, 0)
          ctx.lineTo(-5, 4.2)
          ctx.lineTo(-2.5, 0)
          ctx.lineTo(-5, -4.2)
          ctx.closePath()
          ctx.fillStyle = rgba(b.color, 0.9)
          ctx.fill()
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.2
          ctx.stroke()
          ctx.restore()
          ctx.globalCompositeOperation = 'lighter'
          // 烟迹
          if (animDt > 0 && Math.random() < 0.55) {
            this.parts.dot(b.x - dx * 9, b.y - dy * 9, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, '#ff9b3d', 5, 0.4)
          }
          break
        }
        case 'shard': {
          const g = bank.glow(b.color)
          const gs = b.r * 5
          ctx.drawImage(g.c, b.x - gs / 2, b.y - gs / 2, gs, gs)
          break
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawPlayer(w: World): void {
    if (w.phase === 'lost') return
    const p = w.player
    const ctx = this.ctx
    const bank = this.bank
    const ship = SHIPS[w.cfg.ship]
    const spr = bank.ship[w.cfg.ship]
    const speed = Math.hypot(p.vx, p.vy)
    const dashing = p.dashT > 0

    // 尾焰
    const fx = p.x - Math.cos(p.face) * 11
    const fy = p.y - Math.sin(p.face) * 11
    const fl = 14 + speed * 0.075 + (dashing ? 26 : 0) + Math.sin(this.vt * 55) * 2.2
    ctx.globalCompositeOperation = 'lighter'
    const g1 = bank.glow(ship.accent)
    ctx.globalAlpha = 0.85
    ctx.drawImage(g1.c, fx - Math.cos(p.face) * fl * 0.25 - fl, fy - Math.sin(p.face) * fl * 0.25 - fl, fl * 2, fl * 2)
    ctx.globalAlpha = 0.9
    const g2 = bank.glow('#ffffff')
    const f2 = fl * 0.7
    ctx.drawImage(g2.c, fx - f2 / 2, fy - f2 / 2, f2, f2)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    // 机身
    let alpha = 1
    if (p.invuln > 0 && !dashing) alpha = Math.floor(this.vt * 18) % 2 === 0 ? 0.4 : 1
    else if (dashing) alpha = 0.8
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.face)
    ctx.globalAlpha = alpha
    ctx.drawImage(spr.n.c, -spr.n.w / 2, -spr.n.h / 2, spr.n.w, spr.n.h)
    if (p.hurtFlash > 0) {
      ctx.globalAlpha = clamp01(p.hurtFlash / 0.12) * alpha
      ctx.drawImage(spr.f.c, -spr.f.w / 2, -spr.f.h / 2, spr.f.w, spr.f.h)
    }
    ctx.restore()
    ctx.globalAlpha = 1

    // 判定核心：小白点，让玩家知道真正会被打中的位置
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 2.2, 0, TAU)
    ctx.fill()

    // 无敌护罩（复活后等较长的无敌）
    if (p.invuln > 0.9) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = rgba(ship.accent, 0.5 + 0.3 * Math.sin(this.vt * 10))
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.arc(p.x, p.y, 27, 0, TAU)
      ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  // ───────────────────────── 后处理与 HUD 层 ─────────────────────────

  private bloomPass(): void {
    const half = this.bloomHalf
    const quarter = this.bloomQuarter
    const eighth = this.bloomEighth
    const hc = this.bhC
    const qc = this.bqC
    const ec = this.beC
    if (!half || !quarter || !eighth || !hc || !qc || !ec) return
    hc.globalCompositeOperation = 'copy'
    hc.drawImage(this.canvas, 0, 0, half.width, half.height)
    qc.globalCompositeOperation = 'copy'
    qc.drawImage(half, 0, 0, quarter.width, quarter.height)
    ec.globalCompositeOperation = 'copy'
    ec.drawImage(quarter, 0, 0, eighth.width, eighth.height)
    const ctx = this.ctx
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.38
    ctx.drawImage(quarter, 0, 0, this.W, this.H)
    ctx.globalAlpha = 0.34
    ctx.drawImage(eighth, 0, 0, this.W, this.H)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  /** 屏幕外的重要目标：Boss / 精英 / 宝箱，在屏幕边缘用小箭头指示 */
  private drawIndicators(w: World, boss: World['boss']): void {
    const ctx = this.ctx
    const m = 30 * this.dpr
    const arrow = (x: number, y: number, color: string, size: number): void => {
      const sx = (x - this.cx) * this.k + this.W / 2
      const sy = (y - this.cy) * this.k + this.H / 2
      if (sx > m && sx < this.W - m && sy > m && sy < this.H - m) return
      const dx = sx - this.W / 2
      const dy = sy - this.H / 2
      const sc = Math.min((this.W / 2 - m) / (Math.abs(dx) || 1e-6), (this.H / 2 - m) / (Math.abs(dy) || 1e-6))
      const px = this.W / 2 + dx * sc
      const py = this.H / 2 + dy * sc
      const a = Math.atan2(dy, dx)
      const s = size * this.dpr
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(a)
      ctx.beginPath()
      ctx.moveTo(s, 0)
      ctx.lineTo(-s * 0.7, s * 0.8)
      ctx.lineTo(-s * 0.35, 0)
      ctx.lineTo(-s * 0.7, -s * 0.8)
      ctx.closePath()
      ctx.fillStyle = rgba(color, 0.85)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 1.2 * this.dpr
      ctx.stroke()
      ctx.restore()
    }
    if (boss) arrow(boss.x, boss.y, '#ff3e6c', 13)
    for (const e of w.enemies) if (e.alive && e.elite) arrow(e.x, e.y, '#ffd84a', 9)
    for (const pk of w.pickups) if (pk.alive && pk.kind === 'chest') arrow(pk.x, pk.y, '#ffd84a', 8)
  }

  private drawOverlays(w: World): void {
    const ctx = this.ctx
    const p = w.player
    const soft = this.settings.reduceFlash ? 0.5 : 1
    // 受击红边
    if (p.hurtFlash > 0) {
      ctx.globalAlpha = clamp01(p.hurtFlash / 0.35) * 0.8 * soft
      ctx.drawImage(this.hurtVig, 0, 0, this.W, this.H)
    }
    // 低血量心跳
    const hpr = p.hp / p.maxHp
    if (hpr < 0.3 && w.phase === 'play') {
      ctx.globalAlpha = (0.18 + 0.2 * Math.sin(this.vt * 6.5)) * (1 - hpr / 0.3) * soft + 0.04
      ctx.drawImage(this.hurtVig, 0, 0, this.W, this.H)
    }
    ctx.globalAlpha = 1
    // 全屏闪光
    if (this.flashA > 0.01) {
      ctx.fillStyle = rgba(this.flashColor, this.flashA * 0.6)
      ctx.fillRect(0, 0, this.W, this.H)
    }
  }
}
