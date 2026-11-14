import type { WeaponId } from '../data/ids'
import { SHIPS } from '../data/ships'
import { WEAPONS } from '../data/weapons'
import { DMG_TIERS, EVOLVE_CHARGE, EVOLVE_ZOOM, HEAL_STYLE, HURT_STYLE, NUM_LOOKS, budgetClass, dmgTier, fmtDmg } from '../engine/feel'
import { TAU, clamp, clamp01, turnToward } from '../engine/math'
import type { Shell, Telegraph, WeaponInst } from '../game/entities'
import type { GameEvent } from '../game/events'
import type { World } from '../game/world'
import { Background } from './background'
import { BossArt } from './bossart'
import { paintBeam, paintBolt, paintRing } from './beams'
import { Camera } from './camera'
import { FloatTexts } from './floattext'
import { GroundFx } from './groundfx'
import { NumberFont } from './numfont'
import { Particles } from './particles'
import { ink } from './matte'
import { lighten, rgba } from './palette'
import { CREATURES } from './creatures'
import { GEM_COLORS, PICKUP_COLOR, SpriteBank, engineMounts } from './sprites'

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
  /** 敌人 / 飞船脚下的接触阴影 */
  shadows: boolean
}

const QUALITY: Record<Quality, QualityCfg> = {
  high: { pixels: 3.4e6, dprMax: 2, bloom: true, density: 1, cap: 2000, nebula: true, shadows: true },
  medium: { pixels: 2.1e6, dprMax: 1.5, bloom: true, density: 0.65, cap: 1200, nebula: true, shadows: true },
  low: { pixels: 1.2e6, dprMax: 1, bloom: false, density: 0.35, cap: 600, nebula: false, shadows: false },
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

/** 命中火花数量：随伤害档位增长 */
const HIT_SPARKS = [2, 3, 3, 5, 7, 9, 12, 16]
/** 重击（T4+）的屏幕震动 */
const HIT_TRAUMA = [0, 0, 0, 0, 0.02, 0.035, 0.055, 0.1]
/** 飘字限流桶（小数字 / 中等 / 重击）：容量与每秒补充量 */
const NUM_CAP = [12, 6, 4]
const NUM_RATE = [30, 12, 6]
/**
 * 爆炸这一路的震屏累计上限：连环爆炸（榴弹炮的子弹药、地雷阵、导弹齐射）每一下都加一点，
 * 不设上限会很快把震屏顶满，整局像地震。重击 / Boss / 受伤 / 进化各走各的，不受这个上限影响。
 */
const BLAST_SHAKE_CAP = 0.75
const BLAST_SHAKE_DECAY = 1.4
const NO_DASH: number[] = []
const DASH: number[] = [0, 0]
/** 虹吸索的软管折线段数 / 能量包从目标流回机身的用时（秒） */
const HOSE_SEG = 14
const PACKET_TRAVEL = 0.5
const HOSE_X = new Float32Array(HOSE_SEG + 1)
const HOSE_Y = new Float32Array(HOSE_SEG + 1)

/** 炮弹在某个飞行进度 u 上的位置：地面投影（gx, gy）、离地高度 h、屏幕位置（ax, ay）和机头朝向 ang */
const SH = { gx: 0, gy: 0, h: 0, hMax: 0, ax: 0, ay: 0, ang: 0 }
function shellAt(sh: Shell, u: number): void {
  const dx = sh.x - sh.x0
  const dy = sh.y - sh.y0
  const hMax = clamp(Math.hypot(dx, dy) * 0.32, 38, 130)
  SH.gx = sh.x0 + dx * u
  SH.gy = sh.y0 + dy * u
  SH.hMax = hMax
  SH.h = 4 * hMax * u * (1 - u)
  SH.ax = SH.gx
  SH.ay = SH.gy - SH.h
  // 屏幕上的运动方向 = 地面速度 + 高度变化（抛物线）
  SH.ang = Math.atan2(dy - 4 * hMax * (1 - 2 * u), dx)
}

/** 进化武器每轮开火时的微震 */
const EVO_SHOT_TRAUMA: Partial<Record<WeaponId, number>> = {
  pulse: 0.02,
  arc: 0.03,
  missile: 0.05,
  laser: 0.05,
  mine: 0.04,
  nova: 0.1,
  chakram: 0.04,
  howitzer: 0.05,
}

export class Renderer {
  readonly canvas: HTMLCanvasElement
  readonly cam = new Camera()
  settings: RenderSettings

  private readonly ctx: CanvasRenderingContext2D
  private readonly bank = new SpriteBank(2.5)
  private readonly bossArt = new BossArt(2.5)
  /** 光束类的画法：运行时每帧用，导出指南小图的脚本（scripts/gen-sprites.mjs）也直接调用同一套 */
  readonly paint = { beam: paintBeam, bolt: paintBolt, ring: paintRing }
  private readonly bg = new Background()
  private readonly parts: Particles
  private readonly texts = new FloatTexts()
  /** 伤害数字的字形图集（预渲染渐变 / 光晕 / 描边，运行时只做 drawImage） */
  private readonly numFont = new NumberFont(NUM_LOOKS)

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
  /** 飘字额度：小数字 / 中等 / 重击 三个桶 */
  private readonly numBudget = [12, 6, 4]
  private bossDmgBudget = 4
  /** 重击特效（冲击环 + 震屏）额度，防止一次大范围爆炸触发几十次 */
  private fxBudget = 3
  /** 视口基础缩放（不含进化变焦） */
  private kBase = 1
  /** 进化爆发的镜头变焦（比例）与蓄力阶段的目标变焦 */
  private zoom = 0
  private charging = false
  /** 各进化武器的颜色（每帧刷新，给光环用） */
  private readonly evoCols: string[] = []
  private auraT = 0
  private readonly evoShotAt: Partial<Record<WeaponId, number>> = {}
  private readonly ghosts: Ghost[] = []
  /** 弹坑焦痕与烟团（榴弹炮落地后的实物痕迹） */
  private readonly gfx = new GroundFx()
  private readonly inViewFn = (x: number, y: number, m: number): boolean => this.inView(x, y, m)
  /** 爆炸震屏的累计量（见 BLAST_SHAKE_CAP） */
  private blastTrauma = 0
  private readonly scheduled: Scheduled[] = []

  // 泛光缓冲
  private bloomHalf: HTMLCanvasElement | null = null
  private bloomQuarter: HTMLCanvasElement | null = null
  private bloomEighth: HTMLCanvasElement | null = null
  private bhC: CanvasRenderingContext2D | null = null
  private bqC: CanvasRenderingContext2D | null = null
  private beC: CanvasRenderingContext2D | null = null
  /** 阈值化用的半分辨率暂存（把画面和自己相乘时不能原地读写） */
  private bloomTmp: HTMLCanvasElement | null = null
  private btC: CanvasRenderingContext2D | null = null

  private readonly hurtVig: HTMLCanvasElement
  /** 聚焦暗角（进化演出时把视线收向飞船）与它的强度（0..1，由 App 按时间流速给出） */
  private readonly focusVig: HTMLCanvasElement
  private focusV = 0
  private shadowsOn = true

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
    this.focusVig = this.makeVignette('#01030b')
    this.applyQuality()
  }

  /**
   * 聚焦强度（0 = 无，1 = 最强）：进化演出时 App 传入"1 - 时间流速"，
   * 屏息 → 定格 → 恢复的过程里四周暗下去再亮回来，视线自然收到飞船和冲击波上。
   */
  setFocus(v: number): void {
    this.focusV = clamp01(v)
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
    this.shadowsOn = q.shadows
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
    this.kBase = Camera.scaleFor(this.cssW, this.cssH) * this.dpr
    this.k = this.kBase * (1 + this.zoom)
    this.halfW = W / (2 * this.kBase)
    this.halfH = H / (2 * this.kBase)
    this.ctx.imageSmoothingEnabled = true
    // 注意：'high' 会在 GPU 画布上触发逐帧 mipmap / 双三次采样，实测慢约 6 倍；双线性对 2:1 降采样已经是正确的盒式滤波
    this.ctx.imageSmoothingQuality = 'low'
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
      g.imageSmoothingQuality = 'low'
      return [c, g]
    }
    ;[this.bloomHalf, this.bhC] = mk(this.W >> 1, this.H >> 1)
    ;[this.bloomQuarter, this.bqC] = mk(this.W >> 2, this.H >> 2)
    ;[this.bloomEighth, this.beC] = mk(this.W >> 3, this.H >> 3)
    ;[this.bloomTmp, this.btC] = mk(this.W >> 2, this.H >> 2)
  }

  // ───────────────────────── 生命周期 ─────────────────────────

  attach(w: World): void {
    this.world = w
    this.parts.clear()
    this.texts.clear()
    this.gfx.clear()
    this.blastTrauma = 0
    this.scheduled.length = 0
    this.ghosts.length = 0
    this.flashA = 0
    this.bossMix = 0
    this.zoom = 0
    this.charging = false
    this.k = this.kBase
    this.numBudget[0] = NUM_CAP[0]
    this.numBudget[1] = NUM_CAP[1]
    this.numBudget[2] = NUM_CAP[2]
    this.fxBudget = 3
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
        this.shotFx(e)
        break
      case 'hit':
        this.hitFx(e)
        break
      case 'kill': {
        const big = e.big || e.elite
        // 击杀瞬间的白色闪点：让每一次击杀都有"啪"的一下
        P.dot(e.x, e.y, 0, 0, '#ffffff', 11 + e.r * 0.55, 0.11)
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
        if (this.settings.dmgNumbers) this.texts.add(p.x, p.y - 20, `-${Math.round(e.dmg)}`, { size: NUM_LOOKS[HURT_STYLE].size, style: HURT_STYLE, life: 0.9, pop: 1.7, tier: 4, rise: 0.8 })
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
        this.cam.addTrauma(this.blastShake(Math.min(0.42, e.r / 420)))
        break
      }
      case 'shellLand':
        this.shellLandFx(e)
        break
      case 'scorch': {
        // 陨火 / 熔渣的落点：只留痕迹（焦痕 + 几缕烟 + 溅开的火星和碎渣）；冲击与闪光是同时发出的 blast 事件的事
        const R = e.r
        this.gfx.scorch(e.x, e.y, R)
        this.parts.spark(e.x, e.y, '#ffb35a', 8 + R * 0.1, R * 3, 0.5, 2)
        this.parts.shards(e.x, e.y, '#2f2420', 5, R * 1.8, 4.4, 0.8)
        const n = this.settings.quality === 'low' ? 2 : 4
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU
          const sp = R * (0.5 + Math.random() * 0.6)
          this.gfx.smoke(e.x + Math.cos(a) * R * 0.2, e.y + Math.sin(a) * R * 0.2, Math.cos(a) * sp, Math.sin(a) * sp - 10, R * 0.2, R * 0.55, 0.9 + Math.random() * 0.5, 0.4)
        }
        break
      }
      case 'heal': {
        P.spark(p.x, p.y, '#7dffb0', 5, 110, 0.5, 1.8)
        P.ring(p.x, p.y, 8, 30, '#7dffb0', 0.3, 2)
        if (this.settings.dmgNumbers) this.texts.add(p.x, p.y - 22, `+${e.n}`, { size: NUM_LOOKS[HEAL_STYLE].size, style: HEAL_STYLE, life: 0.85, pop: 1.5, tier: 3, rise: 0.85 })
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
        // 菜单里的演示局没有"演出导演"，只放一个简化版；正式对局由 App 调用 evolveCharge / evolveBoom
        const col = WEAPONS[e.w].color
        P.ring(p.x, p.y, 10, 190, '#ffd84a', 0.7, 4)
        P.ring(p.x, p.y, 10, 130, col, 0.6, 3)
        P.burst(p.x, p.y, '#ffd84a', 26, 320, 8, 0.8)
        this.flash('#ffd84a', 0.2)
        this.cam.addTrauma(0.25)
        break
      }
      case 'end':
        if (!e.won) this.playerExplosion()
        break
      default:
        break
    }
  }

  private shotFx(e: Extract<GameEvent, { t: 'shot' }>): void {
    const P = this.parts
    const ca = Math.cos(e.a)
    const sa = Math.sin(e.a)
    const mx = e.x + ca * 12
    const my = e.y + sa * 12
    switch (e.w) {
      case 'pulse':
        P.sparkCone(mx, my, e.a, 0.5, '#3df2ff', 2, 140, 0.16)
        P.dot(mx, my, 0, 0, '#aefcff', 9, 0.07)
        break
      case 'arc':
        P.sparkCone(e.x, e.y, e.a, 1.5, '#ffe66b', 4, 230, 0.18)
        P.dot(mx, my, 0, 0, '#fff6a0', 15, 0.1)
        break
      case 'missile':
        // 尾喷：向后喷一团火花
        P.sparkCone(e.x - ca * 8, e.y - sa * 8, e.a + Math.PI, 0.9, '#ffb15c', 5, 200, 0.22)
        P.dot(mx, my, 0, 0, '#ffd9a0', 12, 0.09)
        break
      case 'laser':
        // 向内收缩的蓄能环 + 炮口亮点
        P.ring(e.x, e.y, 34, 6, '#ff9db0', 0.2, 2)
        P.dot(mx, my, 0, 0, '#ffd1dc', 18, 0.12)
        break
      case 'mine':
        P.ring(e.x, e.y, 3, 26, '#5dff9e', 0.22, 2)
        break
      case 'nova':
        P.ring(e.x, e.y, 10, 74, '#e8fbff', 0.3, 3)
        this.cam.addTrauma(0.04)
        break
      case 'chakram':
        P.sparkCone(e.x, e.y, e.a, 0.9, '#ff7ae0', 4, 170, 0.22)
        break
      case 'rail': {
        // 磁轨炮：炮口闪光 + 沿光轨洒一串火花 + 一点后坐力震屏
        P.sparkCone(e.x, e.y, e.a, 0.4, '#ff8aa0', 9, 420, 0.3)
        P.ring(e.x, e.y, 4, 44, '#ff4d6d', 0.26, 3)
        for (let k = 0; k < 9; k++) {
          const d = 70 + k * 85
          P.spark(e.x + ca * d, e.y + sa * d, '#ffb3c1', 2, 110, 0.4, 1.6)
        }
        this.cam.addTrauma(0.14)
        break
      }
      case 'howitzer': {
        // 炮口：一团火光 + 两团向后喷的烟 + 一点后坐力
        P.sparkCone(mx, my, e.a, 0.7, '#ffe9a0', 7, 320, 0.2)
        P.dot(mx, my, 0, 0, '#f4ffd0', 17, 0.09)
        for (let k = 0; k < 2; k++) this.gfx.smoke(mx, my, ca * (70 + k * 45) + (Math.random() - 0.5) * 30, sa * (70 + k * 45) + (Math.random() - 0.5) * 30, 3.5, 10 + k * 3, 0.5 + k * 0.15, 0.4)
        this.cam.addTrauma(0.025)
        break
      }
      case 'siphon':
        // 索扣住目标的一瞬间：机身这头一圈小环 + 一撮紫色火花
        P.ring(e.x, e.y, 6, 26, '#a96bff', 0.25, 2)
        P.sparkCone(mx, my, e.a, 0.9, '#d9b8ff', 4, 160, 0.2)
        break
      default:
        break
    }
    // 虹吸索的"开火"只是新扣住了目标，不是一次齐射，不配进化炮口的光环和震屏
    if (e.evo && e.w !== 'siphon') this.evoShotFx(e, ca, sa)
  }

  /** 爆炸震屏：累计有上限（见 BLAST_SHAKE_CAP），返回真正该加的量 */
  private blastShake(a: number): number {
    const add = Math.min(a, Math.max(0, BLAST_SHAKE_CAP - this.blastTrauma))
    this.blastTrauma += add
    return add
  }

  /** 炮弹落地：冲击环 + 火星 + 碎石，再留下焦痕和烟；闪光与基础震屏由随后的 blast 事件负责 */
  private shellLandFx(e: Extract<GameEvent, { t: 'shellLand' }>): void {
    const P = this.parts
    const R = e.r
    const col = e.evo ? '#e6ff9a' : '#b8f03a'
    P.ring(e.x, e.y, R * 0.18, R * 1.35, col, 0.55, 5)
    P.ring(e.x, e.y, R * 0.1, R * 0.85, '#ffffff', 0.3, 3)
    P.spark(e.x, e.y, '#ffe9a0', 18 + R * 0.14, R * 3.6, 0.55, 2)
    P.shards(e.x, e.y, '#7c869e', 9, R * 2.8, 4.6, 0.75)
    P.shards(e.x, e.y, '#3b3126', 7, R * 1.9, 5.4, 0.9)
    this.gfx.scorch(e.x, e.y, R)
    // 烟：一圈向外推开的 + 几团慢慢升起的；低画质减半
    const n = this.settings.quality === 'low' ? 3 : 6
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.8
      const sp = R * (0.9 + Math.random() * 0.9)
      this.gfx.smoke(e.x + Math.cos(a) * R * 0.15, e.y + Math.sin(a) * R * 0.15, Math.cos(a) * sp, Math.sin(a) * sp, R * 0.16, R * 0.5, 0.9 + Math.random() * 0.5, 0.5)
    }
    for (let i = 0; i < (n >> 1); i++) {
      this.gfx.smoke(e.x + (Math.random() - 0.5) * R * 0.5, e.y + (Math.random() - 0.5) * R * 0.4, (Math.random() - 0.5) * 20, -26 - Math.random() * 30, R * 0.25, R * 0.75, 1.3 + Math.random() * 0.6, 0.42)
    }
    this.cam.addTrauma(this.blastShake(0.1 + R / 1200))
  }

  /** 进化武器每轮开火：炮口多一圈光环 + 光爆 + 微震（按武器限频，不然连发会糊成一片） */
  private evoShotFx(e: Extract<GameEvent, { t: 'shot' }>, ca: number, sa: number): void {
    if (this.vt - (this.evoShotAt[e.w] ?? -9) < 0.22) return
    this.evoShotAt[e.w] = this.vt
    const P = this.parts
    const col = WEAPONS[e.w].color
    P.ring(e.x, e.y, 8, 54, col, 0.3, 3.2)
    P.ring(e.x, e.y, 5, 32, '#ffffff', 0.22, 2)
    P.burst(e.x, e.y, col, 7, 170, 5.5, 0.32)
    P.dot(e.x + ca * 14, e.y + sa * 14, 0, 0, '#ffffff', 24, 0.11)
    const tr = EVO_SHOT_TRAUMA[e.w]
    if (tr) this.cam.addTrauma(tr)
  }

  /** 命中：火花数量 / 大小 / 颜色随伤害档位增长；重击再加冲击环、碎片和震屏 */
  private hitFx(e: Extract<GameEvent, { t: 'hit' }>): void {
    const P = this.parts
    const tier = dmgTier(e.dmg, e.crit)
    const T = DMG_TIERS[tier]
    const hot = tier >= 3
    P.spark(
      e.x,
      e.y,
      hot ? T.color : e.crit ? '#ffe66b' : lighten(e.color, 0.3),
      HIT_SPARKS[tier] + (e.crit ? 2 : 0),
      150 + tier * 35,
      0.26 + tier * 0.025,
      1.6 + tier * 0.14,
    )
    if (hot) P.dot(e.x, e.y, 0, 0, T.color, 9 + tier * 2.5, 0.14)
    if (tier >= 4 && this.fxBudget >= 1) {
      // 一次大范围爆炸会同时命中几十个敌人，所以重击特效要限流
      this.fxBudget -= 1
      P.ring(e.x, e.y, 5, 24 + tier * 9, T.color, 0.22 + tier * 0.02, 1.6 + tier * 0.45)
      if (tier >= 5) P.shards(e.x, e.y, T.color, 3 + tier, 200 + tier * 25, 3.4, 0.5)
      this.cam.addTrauma(HIT_TRAUMA[tier])
    }
    if (this.settings.dmgNumbers) this.hitNumber(e.x, e.y, e.dmg, e.crit, e.boss, tier)
  }

  /** 先用自己那一档的额度，用完了向下"借"——重击不该因为额度被丢掉 */
  private takeNumberToken(cls: number): boolean {
    for (let c = cls; c >= 0; c--) {
      if (this.numBudget[c] >= 1) {
        this.numBudget[c] -= 1
        return true
      }
    }
    return false
  }

  private hitNumber(x: number, y: number, dmg: number, crit: boolean, boss: boolean, tier: number): void {
    const cls = budgetClass(tier)
    // Boss 身上的小数字额外限流，不然会糊成一片
    if (cls === 0 && boss && this.bossDmgBudget < 1) return
    if (!this.takeNumberToken(cls)) return
    if (cls === 0 && boss) this.bossDmgBudget -= 1
    const T = DMG_TIERS[tier]
    this.texts.add(
      x + (boss ? (Math.random() - 0.5) * (52 + tier * 8) : 0),
      boss ? y - 24 - Math.random() * 26 - tier * 3 : y - 8 - tier * 2,
      fmtDmg(dmg),
      { size: T.size, style: tier, life: T.life, pop: T.pop, tier, rise: tier >= 3 ? 0.72 : 1 },
    )
  }

  // ───────────────────────── 武器进化演出 ─────────────────────────

  /** 镜头猛地推近一下（比例），随后自然回落；"减少晃动"的玩家不会有这个效果 */
  private zoomPunch(a: number): void {
    if (this.settings.shake) this.zoom = Math.max(this.zoom, a)
  }

  /** 向飞船收拢的光点：速度按拖拽衰减反推，保证正好在 life 结束时到达中心 */
  private converge(x: number, y: number, color: string, n: number, rMin: number, rMax: number, life: number): void {
    const P = this.parts
    const f = 1 - Math.exp(-3.2 * life)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU
      const r = rMin + Math.random() * (rMax - rMin)
      const v = (3.2 * r) / f
      P.dot(x + Math.cos(a) * r, y + Math.sin(a) * r, -Math.cos(a) * v, -Math.sin(a) * v, color, 5 + Math.random() * 3, life)
    }
  }

  /**
   * 进化 · 第一幕「蓄力」：光环和光点向飞船收拢，镜头慢慢拉近。
   * 紧接着模拟层的冲击波引爆，由 App 调用 evolveBoom 进入第二幕。
   */
  evolveCharge(id: WeaponId): void {
    const w = this.world
    if (!w) return
    const p = w.player
    const P = this.parts
    const col = WEAPONS[id].color
    const gold = '#ffd84a'
    this.charging = true
    const cols = [col, '#ffffff', gold]
    for (let i = 0; i < 3; i++) {
      this.schedule(i * 0.07, () => P.ring(p.x, p.y, 330 - i * 50, 20, cols[i], EVOLVE_CHARGE - i * 0.05, 3.5))
    }
    this.converge(p.x, p.y, col, 22, 120, 280, EVOLVE_CHARGE)
    this.converge(p.x, p.y, gold, 12, 90, 220, EVOLVE_CHARGE * 0.8)
    this.cam.addTrauma(0.2)
  }

  /**
   * 进化 · 第二幕「爆发」：整屏冲击波、光爆、放射光线、白闪、猛推镜头。
   * 此刻 App 把时间流速砸到近乎静止，所以这些粒子会"慢放"出来。
   */
  evolveBoom(id: WeaponId): void {
    const w = this.world
    if (!w) return
    const p = w.player
    const P = this.parts
    const col = WEAPONS[id].color
    const gold = '#ffd84a'
    this.charging = false
    const R = Math.hypot(this.halfW, this.halfH)
    P.ring(p.x, p.y, 14, R * 1.05, '#ffffff', 0.85, 9)
    P.ring(p.x, p.y, 14, R * 0.8, col, 0.95, 6)
    P.ring(p.x, p.y, 14, R * 0.55, gold, 1.0, 4)
    this.schedule(0.1, () => P.ring(p.x, p.y, 10, R * 0.7, '#ffffff', 0.7, 4))
    this.schedule(0.2, () => P.ring(p.x, p.y, 10, R * 0.45, col, 0.7, 3))
    P.burst(p.x, p.y, col, 70, 620, 11, 1.0)
    P.burst(p.x, p.y, gold, 50, 480, 9, 0.9)
    P.burst(p.x, p.y, '#ffffff', 24, 360, 12, 0.5)
    P.spark(p.x, p.y, '#ffffff', 56, 900, 0.75, 2.6)
    P.spark(p.x, p.y, col, 44, 700, 0.9, 2.2)
    P.shards(p.x, p.y, col, 30, 560, 5, 1.0)
    P.dot(p.x, p.y, 0, 0, '#ffffff', 170, 0.35)
    this.flash('#ffffff', 0.9)
    this.schedule(0.18, () => this.flash(col, 0.3))
    this.cam.addTrauma(0.8)
    this.zoomPunch(EVOLVE_ZOOM)
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

  /**
   * animDt 是"视觉时间步长"：暂停/升级选择时传 0，粒子与镜头就会定格；进化慢动作里它被拖慢。
   * realDt 是真实时间步长：全屏白闪按它衰减——否则定格期间白闪会被拖成一层迟迟不退的白雾，把暗角和冲击波都洗掉。
   */
  frame(w: World, animDt: number, realDt: number = animDt): void {
    const t0 = performance.now()
    if (this.world !== w) this.attach(w)
    const ctx = this.ctx
    const p = w.player

    this.vt += animDt
    // 镜头变焦：蓄力时缓缓拉近，爆发时猛地一推再自然回落（进化演出）
    if (!this.settings.shake) this.zoom = 0
    else if (this.charging && (w.phase === 'play' || w.phase === 'levelup')) {
      this.zoom += (EVOLVE_ZOOM * 0.45 - this.zoom) * Math.min(1, animDt * 6)
    } else {
      this.charging = false
      if (this.zoom > 0) {
        this.zoom *= Math.exp(-4.2 * animDt)
        if (this.zoom < 0.0008) this.zoom = 0
      }
    }
    this.k = this.kBase * (1 + this.zoom)
    const k = this.k

    // 额度回填
    const nb = this.numBudget
    for (let c = 0; c < nb.length; c++) nb[c] = Math.min(NUM_CAP[c], nb[c] + animDt * NUM_RATE[c])
    this.bossDmgBudget = Math.min(4, this.bossDmgBudget + animDt * 7)
    this.fxBudget = Math.min(3, this.fxBudget + animDt * 5)

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
    this.gfx.update(animDt)
    this.blastTrauma = Math.max(0, this.blastTrauma - animDt * BLAST_SHAKE_DECAY)
    this.texts.update(animDt)
    this.flashA = Math.max(0, this.flashA - realDt * 2.4)
    this.updateEvoAura(w, animDt)
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
    this.gfx.drawMarks(ctx, this.bank, this.inViewFn)
    this.drawTelegraphs(w)
    this.drawGems(w)
    this.drawPickups(w)
    this.drawEnemiesUnder(w)
    this.drawEnemies(w, animDt)
    this.drawEnemiesOver(w)
    if (boss) this.bossArt.draw(ctx, boss, p.x, p.y, this.vt, this.bank)
    this.drawShellMarks(w)
    this.drawBeams(w)
    this.drawRings(w)
    this.drawEnemyBullets(w)
    this.drawAirborne(w)
    this.drawGhosts(w)
    this.drawPlayerWeapons(w)
    this.drawPlayerBullets(w, animDt)
    this.drawShells(w)
    this.drawBolts(w)
    this.gfx.drawSmoke(ctx, this.bank, this.inViewFn)
    this.drawBlasts(w)
    this.parts.draw(ctx, this.bank)
    // 玩家画在所有加色特效之上：再乱的场面也要一眼看到自己
    this.drawPlayer(w)
    this.texts.draw(ctx, this.numFont, this.k)

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
      // 地雷本体：带尖刺的圆盘，缓慢自转；布设阶段半透明且略小，装填完成后实心
      const prog = armed ? 1 : m.age / m.arm
      const spr = this.bank.mine(col)
      const k = 0.72 + 0.28 * prog
      ctx.rotate(this.vt * 1.2 + m.x)
      ctx.globalAlpha = 0.5 + 0.5 * prog
      ctx.drawImage(spr.c, (-spr.w * k) / 2, (-spr.h * k) / 2, spr.w * k, spr.h * k)
      ctx.globalAlpha = 1
      ctx.restore()
      if (armed) {
        // 信号灯闪烁
        const g = this.bank.glow(col)
        const blink = 0.4 + 0.4 * Math.sin(this.vt * 9 + m.y)
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = blink
        ctx.drawImage(g.c, m.x - 10, m.y - 10, 20, 20)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }
    }
  }

  /** 斜纹警示带：只填进调用方已经裁好的矩形里（整组平行四边形一次 fill，条纹缓慢流动） */
  private hatch(x0: number, y0: number, w: number, h: number, color: string, alpha: number): void {
    const ctx = this.ctx
    const period = 24
    const sw = 8
    const off = (this.vt * 28) % period
    ctx.fillStyle = rgba(color, alpha)
    ctx.beginPath()
    for (let x = x0 - h - sw - period + off; x < x0 + w; x += period) {
      ctx.moveTo(x, y0 + h)
      ctx.lineTo(x + sw, y0 + h)
      ctx.lineTo(x + sw + h, y0)
      ctx.lineTo(x + h, y0)
      ctx.closePath()
    }
    ctx.fill()
  }

  /**
   * Boss 预警：工业"危险区"的画法——淡底色 + 斜纹警示带 + 利落的边线，不用任何加色光。
   * 前半程平稳，临近出手（p > 0.78）整块快闪，让玩家知道"现在就要打下来了"。
   */
  private drawTelegraphs(w: World): void {
    const ctx = this.ctx
    for (const tl of w.teles) {
      if (!tl.alive) continue
      const p = 1 - tl.t / tl.maxT
      const fl = p > 0.78 ? (Math.sin(this.vt * 55) > 0 ? 1 : 0.6) : 1
      if (tl.kind === 'circle') {
        if (!this.inView(tl.x, tl.y, tl.r + 40)) continue
        ctx.save()
        ctx.beginPath()
        ctx.arc(tl.x, tl.y, tl.r, 0, TAU)
        ctx.clip()
        ctx.fillStyle = rgba(tl.color, (0.04 + 0.1 * p) * fl)
        ctx.fillRect(tl.x - tl.r, tl.y - tl.r, tl.r * 2, tl.r * 2)
        this.hatch(tl.x - tl.r, tl.y - tl.r, tl.r * 2, tl.r * 2, tl.color, (0.08 + 0.18 * p) * fl)
        ctx.restore()
        ctx.beginPath()
        ctx.arc(tl.x, tl.y, tl.r, 0, TAU)
        ctx.strokeStyle = rgba(tl.color, (0.55 + 0.4 * p) * fl)
        ctx.lineWidth = 2
        ctx.setLineDash([8, 6])
        ctx.stroke()
        ctx.setLineDash([])
        // 收拢的实线圈：画到边线上就是出手的一刻
        ctx.strokeStyle = rgba(tl.color, 0.9)
        ctx.lineWidth = 2.5
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
        ctx.fillStyle = rgba(tl.color, (0.04 + 0.08 * p) * fl)
        ctx.fillRect(0, -tl.r, len, tl.r * 2)
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, -tl.r, len, tl.r * 2)
        ctx.clip()
        this.hatch(0, -tl.r, len, tl.r * 2, tl.color, (0.1 + 0.2 * p) * fl)
        ctx.restore()
        ctx.strokeStyle = rgba(tl.color, (0.55 + 0.4 * p) * fl)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(0, -tl.r)
        ctx.lineTo(len, -tl.r)
        ctx.moveTo(0, tl.r)
        ctx.lineTo(len, tl.r)
        ctx.stroke()
        // 中线：先是虚线（还在瞄准），越接近出手越实、越亮、越粗
        ctx.strokeStyle = rgba('#ffffff', (0.22 + 0.6 * p) * fl)
        ctx.lineWidth = 1 + 2.2 * p
        ctx.setLineDash(p < 0.7 ? [16, 10] : [])
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(len, 0)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      }
    }
  }

  /**
   * 预警圈上方"飞着的东西"（只在 fx > 0 的预警里有）：
   *  · fx 1：Boss 抛出的熔渣团，沿抛物线飞向预警圈，飞到一半最高最大；
   *  · fx 2：陨火——预警进行到一半后从屏幕外斜着砸下来，地上先出现越来越大的影子。
   * 画在敌人和 Boss 之上，让人看见"东西正在飞过来"，而不只是地上亮了个圈。
   */
  private drawAirborne(w: World): void {
    const ctx = this.ctx
    let any = false
    for (const tl of w.teles) {
      if (!tl.alive || tl.fx === 0 || tl.kind !== 'circle') continue
      any = true
      const p = 1 - tl.t / tl.maxT
      if (tl.fx === 1) this.drawLob(tl, p)
      else this.drawMeteor(tl, p)
    }
    if (any) ctx.globalAlpha = 1
  }

  private drawLob(tl: Telegraph, p: number): void {
    const ctx = this.ctx
    const s = this.bank.ebullet('ember', tl.color)
    const dx = tl.x - tl.x2
    const dy = tl.y - tl.y2
    const top = Math.min(170, 55 + Math.hypot(dx, dy) * 0.3)
    const gx = tl.x2 + dx * p
    const gy = tl.y2 + dy * p
    const h = Math.sin(Math.PI * p)
    if (!this.inView(gx, gy - h * top, 80)) return
    // 影子：贴着地面走，越高越小越淡
    ctx.globalAlpha = 0.3 * (1 - 0.5 * h)
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(gx, gy + 3, 12 * (1 - 0.35 * h), 6.5 * (1 - 0.35 * h), 0, 0, TAU)
    ctx.fill()
    // 朝着弹道切线飞；后面跟几个更早的位置，越早越小越淡
    const ang = Math.atan2(dy - Math.PI * Math.cos(Math.PI * p) * top, dx)
    for (let g = 4; g >= 0; g--) {
      const pg = Math.max(0, p - g * 0.03)
      const hg = Math.sin(Math.PI * pg)
      const sc = (1.9 + hg * 1.1) * (1 - g * 0.1)
      ctx.save()
      ctx.globalAlpha = g === 0 ? 1 : 0.3 * (1 - g / 5)
      ctx.translate(tl.x2 + dx * pg, tl.y2 + dy * pg - hg * top)
      ctx.rotate(ang + (g === 0 ? Math.sin(this.vt * 14 + tl.x) * 0.12 : 0))
      ctx.scale(sc, sc)
      ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h)
      ctx.restore()
    }
  }

  private drawMeteor(tl: Telegraph, p: number): void {
    const ctx = this.ctx
    const q = clamp01((p - 0.5) / 0.5)
    if (q <= 0) return
    // 影子比陨石先到：越靠近越大越浓
    ctx.globalAlpha = 0.34 * q
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(tl.x, tl.y + 4, tl.r * 0.5 * q, tl.r * 0.3 * q, 0, 0, TAU)
    ctx.fill()
    const s = this.bank.ebullet('ember', tl.color)
    const H = 560
    const ang = Math.atan2(1, -0.34)
    for (let g = 5; g >= 0; g--) {
      const f = 1 - q + g * 0.045
      const mx = tl.x + f * H * 0.34
      const my = tl.y - f * H
      if (!this.inView(mx, my, 100)) continue
      const sc = (2.1 + 1.5 * q) * (1 - g * 0.09)
      ctx.save()
      ctx.globalAlpha = g === 0 ? 1 : 0.3 * (1 - g / 6)
      ctx.translate(mx, my)
      ctx.rotate(ang)
      ctx.scale(sc, sc)
      ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h)
      ctx.restore()
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
      // 光晕：普通拾取物的淡光已经画进精灵里；宝箱 / 补给箱再加一圈呼吸光
      if (special) {
        const g = bank.glow(col)
        const gs = 50
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.26 + 0.12 * Math.sin(this.vt * 4 + pk.y * 0.1)
        ctx.drawImage(g.c, pk.x - gs / 2, pk.y + bob - gs / 2, gs, gs)
      }
      if (pk.kind === 'chest') {
        // 宝箱的光柱：渐隐的一束光，远处也能看见
        const beam = ctx.createLinearGradient(0, pk.y - 96, 0, pk.y)
        beam.addColorStop(0, rgba(col, 0))
        beam.addColorStop(1, rgba(col, 0.42))
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 1
        ctx.fillStyle = beam
        ctx.fillRect(pk.x - 2.5, pk.y - 96, 5, 96)
        const core = ctx.createLinearGradient(0, pk.y - 96, 0, pk.y)
        core.addColorStop(0, 'rgba(255,255,255,0)')
        core.addColorStop(1, 'rgba(255,255,255,0.5)')
        ctx.fillStyle = core
        ctx.fillRect(pk.x - 0.8, pk.y - 96, 1.6, 96)
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

  private drawEnemies(w: World, animDt: number): void {
    const ctx = this.ctx
    const bank = this.bank
    const k = this.k
    const ox = this.ox
    const oy = this.oy
    // 接触阴影：先把所有阴影画完再画机体，状态切换最少
    if (this.shadowsOn) {
      const sh = bank.shadow
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      for (const e of w.enemies) {
        // 小个子（蜂群 / 碎片）的影子看不出来，却占了一半的张数：跳过
        if (!e.alive || e.r < 9 || !this.inView(e.x, e.y, 40)) continue
        let a = 0.55
        if (e.spawnT > 0) a *= 0.15 + 0.85 * clamp01(1 - e.spawnT / ENEMY_SPAWN_FADE)
        if (e.def.ai === 'wraith' && e.state !== 0) a *= 0.12 + 0.88 * e.aux
        const sz = e.r * 2.8 * k
        ctx.globalAlpha = a
        ctx.drawImage(sh.c, ox + (e.x + e.r * 0.2) * k - sz / 2, oy + (e.y + e.r * 0.36) * k - sz / 2, sz, sz)
      }
    }
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
      // 精英的画面也跟着碰撞体放大，不然金色虚线圈里是一只"普通大小"的怪
      sc *= e.r / def.radius
      let ang: number
      if (CREATURES[def.shape].faces) {
        // 朝向平滑转过去：怪是"转身"而不是瞬间换方向（冲锋兽转得快一点，瞄得准）
        e.ra = turnToward(e.ra, e.angle, animDt * (def.ai === 'charger' ? 16 : 9))
        ang = e.ra
      } else ang = e.age * 1.1 * (e.id % 2 === 0 ? 1 : -1) + e.id
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
    const { k, ox, oy } = this
    // 有造型的弹丸直接写屏幕矩阵（比 save / translate / rotate / scale / restore 便宜得多，弹幕战里一屏上百颗）
    let screen = false
    for (const b of w.ebullets) {
      if (!b.alive || !this.inView(b.x, b.y, 24)) continue
      if (b.kind === 'orb') {
        // 圆弹：带墨色描边的实心球。和玩家那种"加色光弹"一眼分得开：描边的是危险的
        if (screen) {
          this.worldT()
          screen = false
        }
        const s = bank.bead(b.color)
        const d = s.w * ((b.r * 1.35) / 8)
        ctx.drawImage(s.c, b.x - d / 2, b.y - d / 2, d, d)
        continue
      }
      // 有造型的弹丸（酸液 / 瞳孔 / 飞镖 / 晶刺 / 獠牙）：精灵朝 +x，按弹道旋转，按碰撞半径缩放
      const s = bank.ebullet(b.kind, b.color)
      const sc = (b.r / 6) * k
      const ang = b.kind === 'lens' ? 0 : Math.atan2(b.vy, b.vx)
      const c = Math.cos(ang) * sc
      const sn = Math.sin(ang) * sc
      ctx.setTransform(c, sn, -sn, c, ox + b.x * k, oy + b.y * k)
      screen = true
      ctx.drawImage(s.c, -s.w / 2, -s.h / 2, s.w, s.h)
    }
    if (screen) this.worldT()
  }

  private drawBeams(w: World): void {
    const ctx = this.ctx
    ctx.globalCompositeOperation = 'lighter'
    for (const bm of w.beams) {
      if (!bm.alive) continue
      if (!this.inView(bm.ox, bm.oy, bm.len + 40)) continue
      const age = bm.maxLife - bm.life
      const life = bm.maxLife > 0 ? clamp01(bm.life / bm.maxLife) : 1
      // 重炮光轨：出膛瞬间最亮、最粗，随后快速收细熄灭
      const env = bm.punch
        ? Math.pow(life, 1.4)
        : bm.warn > 0
          ? 0.25
          : Math.min(1, age / 0.07 + 0.2) * Math.min(1, life / 0.35)
      const width = bm.punch ? bm.width * (0.3 + 0.7 * Math.sqrt(life)) : bm.width * (0.3 + 0.7 * env)
      const flick = 0.92 + 0.08 * Math.sin(this.vt * 70 + bm.ang * 9)
      ctx.save()
      ctx.translate(bm.ox, bm.oy)
      ctx.rotate(bm.ang)
      paintBeam(ctx, bm.style, bm.len, bm.color, { env: env * flick, width, life, vt: this.vt })
      ctx.restore()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawRings(w: World): void {
    const ctx = this.ctx
    ctx.globalCompositeOperation = 'lighter'
    for (const rg of w.rings) {
      if (!rg.alive || rg.delay > 0) continue
      if (!this.inView(rg.x, rg.y, rg.r + 40)) continue
      paintRing(ctx, rg.x, rg.y, rg.r, rg.maxR, rg.color, rg.hostile, this.vt)
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineCap = 'round'
  }

  private drawBolts(w: World): void {
    const ctx = this.ctx
    ctx.globalCompositeOperation = 'lighter'
    for (const bt of w.bolts) {
      if (!bt.alive) continue
      paintBolt(ctx, bt.pts, bt.color, clamp01(bt.life / bt.maxLife))
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
      // 白热的闪光芯：很快收缩熄灭
      const g = bank.glow(b.color)
      const gs = b.r * 1.9 * (0.5 + 0.5 * grow)
      ctx.globalAlpha = Math.min(0.85, lp * 1.15)
      ctx.drawImage(g.c, b.x - gs / 2, b.y - gs / 2, gs, gs)
      // 淡淡的范围底色 + 向外扩散的冲击环（环越走越细）
      const rr = b.r * (0.4 + 0.6 * grow)
      ctx.globalAlpha = 1
      ctx.fillStyle = rgba(b.color, 0.09 * lp)
      ctx.beginPath()
      ctx.arc(b.x, b.y, rr, 0, TAU)
      ctx.fill()
      ctx.strokeStyle = rgba(lighten(b.color, 0.55), 0.7 * lp)
      ctx.lineWidth = 0.8 + 3.2 * lp
      ctx.beginPath()
      ctx.arc(b.x, b.y, rr, 0, TAU)
      ctx.stroke()
      // 星芒：十道长短不一的尖刺向外炸开——"爆炸"该有的剪影，而不只是一个圈
      const rot = b.x * 0.013 + b.y * 0.007
      const reach = (0.4 + 0.6 * grow) * rr
      ctx.fillStyle = rgba(lighten(b.color, 0.7), 0.6 * lp)
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const a = rot + (i / 10) * TAU
        const len = reach * (0.6 + 0.4 * (((i * 7) % 5) / 4))
        ctx.moveTo(b.x + Math.cos(a - 0.12) * rr * 0.26, b.y + Math.sin(a - 0.12) * rr * 0.26)
        ctx.lineTo(b.x + Math.cos(a) * len, b.y + Math.sin(a) * len)
        ctx.lineTo(b.x + Math.cos(a + 0.12) * rr * 0.26, b.y + Math.sin(a + 0.12) * rr * 0.26)
      }
      ctx.fill()
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
        const col = wi.evolved ? '#ffd24d' : '#8fb8ff'
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
          ctx.strokeStyle = rgba(col, 0.14)
          ctx.lineWidth = 2.6
          const p = w.player
          for (const pt of wi.pts) {
            const rr = Math.hypot(pt.x - p.x, pt.y - p.y)
            ctx.beginPath()
            ctx.arc(p.x, p.y, rr, pt.a - 0.55, pt.a - 0.04)
            ctx.stroke()
          }
          ctx.globalCompositeOperation = 'source-over'
        }
      } else if (wi.id === 'chakram') {
        const col = wi.evolved ? '#ffd2f6' : '#ff7ae0'
        const spr = bank.chakram(col)
        const gl = bank.glow(col)
        const p = w.player
        for (const pt of wi.pts) {
          // 运动方向：去程是掷出的方向，回程是朝机身
          let dx = pt.vx
          let dy = pt.vy
          if (pt.ph === 1) {
            dx = p.x - pt.x
            dy = p.y - pt.y
            const dl = Math.hypot(dx, dy) || 1
            dx /= dl
            dy /= dl
          }
          // 拖影：沿来路留三个渐淡的光点
          ctx.globalCompositeOperation = 'lighter'
          for (let k = 1; k <= 3; k++) {
            const gs = pt.r * (3.4 - k * 0.5)
            ctx.globalAlpha = 0.24 / k
            ctx.drawImage(gl.c, pt.x - dx * k * 11 - gs / 2, pt.y - dy * k * 11 - gs / 2, gs, gs)
          }
          ctx.globalAlpha = 1
          ctx.globalCompositeOperation = 'source-over'
          const sc = (pt.r * 1.3) / 14
          ctx.save()
          ctx.translate(pt.x, pt.y)
          ctx.rotate(pt.a)
          ctx.scale(sc, sc)
          ctx.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h)
          ctx.restore()
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
      } else if (wi.id === 'siphon') {
        this.drawTethers(w, wi)
      }
    }
  }

  // ───────────────────────── 榴弹炮：落点标记与炮弹 ─────────────────────────

  /**
   * 落点标记（地面层）：圈出爆炸范围，一圈向内收拢的环倒数"还有多久落地"，炮弹的影子也画在这一层。
   * 全是哑光的细线（墨线衬底 + 一道亮色），不发光；临近落地时线条变白，提示"马上炸"。
   */
  private drawShellMarks(w: World): void {
    if (w.shells.length === 0) return
    const ctx = this.ctx
    const shadow = this.bank.shadow
    ctx.lineCap = 'butt'
    for (const sh of w.shells) {
      if (!sh.alive) continue
      const u = clamp01(sh.t / sh.T)
      // 影子沿地面走：越高越小越淡
      if (u > 0.03 && u < 0.985) {
        shellAt(sh, u)
        if (this.inView(SH.gx, SH.gy, 30)) {
          const hr = SH.h / SH.hMax
          const sw = 24 * (1 - 0.32 * hr)
          ctx.globalAlpha = 0.55 * (1 - 0.45 * hr)
          ctx.drawImage(shadow.c, SH.gx - sw / 2, SH.gy - sw * 0.24, sw, sw * 0.48)
          ctx.globalAlpha = 1
        }
      }
      const R = sh.blast
      if (!this.inView(sh.x, sh.y, R + 24)) continue
      const hot = clamp01((u - 0.78) / 0.22)
      const line = hot > 0 ? lighten(sh.color, hot * 0.75) : sh.color
      const k = sh.evolved ? 1.2 : 1
      ctx.save()
      ctx.translate(sh.x, sh.y)
      ctx.globalAlpha = Math.min(1, sh.t / 0.1)
      // 范围底色：只是一层很淡的色，让人一眼知道炸多大
      ctx.fillStyle = rgba(sh.color, 0.045 + 0.075 * u)
      ctx.beginPath()
      ctx.arc(0, 0, R, 0, TAU)
      ctx.fill()
      // 外圈：虚线，缓慢自转
      DASH[0] = R * 0.2
      DASH[1] = R * 0.115
      ctx.setLineDash(DASH)
      ctx.lineDashOffset = -this.vt * R * 0.22
      ctx.beginPath()
      ctx.arc(0, 0, R, 0, TAU)
      ctx.lineWidth = 3.6 * k
      ctx.strokeStyle = ink(0.4)
      ctx.stroke()
      ctx.lineWidth = 1.7 * k
      ctx.strokeStyle = rgba(line, 0.34 + 0.5 * u)
      ctx.stroke()
      ctx.setLineDash(NO_DASH)
      // 收拢环：从爆炸半径一路缩到 0.2R，缩到头就是落地
      const ease = u * u * (3 - 2 * u)
      ctx.beginPath()
      ctx.arc(0, 0, R * (1 - 0.8 * ease), 0, TAU)
      ctx.lineWidth = 4.6 * k
      ctx.strokeStyle = ink(0.5)
      ctx.stroke()
      ctx.lineWidth = 2.4 * k
      ctx.strokeStyle = rgba(line, 0.5 + 0.5 * u)
      ctx.stroke()
      // 十字准星：四根短线横跨外圈
      ctx.beginPath()
      for (let i = 0; i < 4; i++) {
        const c = Math.cos((i * Math.PI) / 2)
        const sn = Math.sin((i * Math.PI) / 2)
        ctx.moveTo(c * (R - 6), sn * (R - 6))
        ctx.lineTo(c * (R + 8), sn * (R + 8))
      }
      ctx.lineWidth = 3.6 * k
      ctx.strokeStyle = ink(0.5)
      ctx.stroke()
      ctx.lineWidth = 1.7 * k
      ctx.strokeStyle = rgba(line, 0.85)
      ctx.stroke()
      // 中心：一枚小菱形
      const dm = 3.4 + 1.2 * hot
      ctx.beginPath()
      ctx.moveTo(0, -dm)
      ctx.lineTo(dm, 0)
      ctx.lineTo(0, dm)
      ctx.lineTo(-dm, 0)
      ctx.closePath()
      ctx.fillStyle = rgba(line, 0.95)
      ctx.fill()
      ctx.lineWidth = 1.2
      ctx.strokeStyle = ink(0.8)
      ctx.stroke()
      ctx.restore()
    }
    ctx.lineCap = 'round'
  }

  /** 空中的炮弹：抛物线飞行，机头始终朝着运动方向（落下来时就是头朝下砸），身后一道渐淡的尾迹 */
  private drawShells(w: World): void {
    if (w.shells.length === 0) return
    const ctx = this.ctx
    for (const sh of w.shells) {
      if (!sh.alive) continue
      const u = clamp01(sh.t / sh.T)
      if (u > 0.985) continue
      shellAt(sh, u)
      const px = SH.ax
      const py = SH.ay
      const hr = SH.h / SH.hMax
      const ang = SH.ang
      if (!this.inView(px, py, 70)) continue
      // 尾迹：沿来路退几个点，越远越细越淡
      let lx = px
      let ly = py
      for (let j = 1; j <= 6; j++) {
        const uj = u - j * 0.03
        if (uj < 0) break
        shellAt(sh, uj)
        const f = 1 - j / 7
        ctx.beginPath()
        ctx.moveTo(lx, ly)
        ctx.lineTo(SH.ax, SH.ay)
        ctx.lineWidth = 3.4 * f
        ctx.strokeStyle = rgba(sh.color, 0.36 * f)
        ctx.stroke()
        lx = SH.ax
        ly = SH.ay
      }
      const spr = this.bank.shell(sh.color)
      const sc = (0.92 + 0.4 * hr) * (sh.evolved ? 1.22 : 1)
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(ang)
      ctx.scale(sc, sc)
      ctx.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h)
      ctx.restore()
    }
  }

  // ───────────────────────── 虹吸索 ─────────────────────────

  /**
   * 虹吸索：钢灰色的软管（暗肋 + 一线紫色导能芯）从机身连到目标；
   * 每"一跳"有一个薄荷色的能量包顺着软管流回机身；目标身上扣着钢制夹爪，每一跳夹爪咬紧一下。
   * 进化后是两股绞在一起的软管。
   */
  private drawTethers(w: World, wi: WeaponInst): void {
    const pts = wi.pts
    if (pts.length === 0) return
    const ctx = this.ctx
    const bank = this.bank
    const p = w.player
    const evo = wi.evolved
    const coreCol = evo ? '#e0c4ff' : '#a96bff'
    const clampSpr = bank.clamp(evo ? '#d9b8ff' : '#a96bff')
    const packet = bank.glow('#7dffb0')
    const tick = wi.s.tick
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i]
      const t = pt.tgt
      if (!t || !t.alive) continue
      const ax = p.x
      const ay = p.y
      let dx = t.x - ax
      let dy = t.y - ay
      const dist = Math.hypot(dx, dy)
      if (dist < 8) continue
      dx /= dist
      dy /= dist
      // 夹爪的位置：小怪扣在中心；大个子（Boss 等）扣在朝向机身的那一侧
      const cr = Math.min(t.r + 2.5, 14)
      const off = Math.max(0, t.r - cr + 3)
      const cx = t.x - dx * off
      const cy = t.y - dy * off
      const L = Math.hypot(cx - ax, cy - ay)
      if (!this.inView((ax + cx) / 2, (ay + cy) / 2, L / 2 + 30)) continue
      // 软管走一条轻轻摆动的二次曲线
      const nx = -dy
      const ny = dx
      const bow = Math.sin(this.vt * 1.9 + pt.a) * Math.min(12, L * 0.07)
      const kx = (ax + cx) / 2 + nx * bow
      const ky = (ay + cy) / 2 + ny * bow
      // 刚扣上的 0.16 秒：软管从机身甩出去
      const grow = clamp01(pt.d / 0.16)
      const umax = 1 - (1 - grow) * (1 - grow)
      const trace = (sign: number, amp: number, oy = 0): void => {
        ctx.beginPath()
        for (let k = 0; k <= HOSE_SEG; k++) {
          const u = (k / HOSE_SEG) * umax
          const iu = 1 - u
          let x = iu * iu * ax + 2 * iu * u * kx + u * u * cx
          let y = iu * iu * ay + 2 * iu * u * ky + u * u * cy
          if (amp > 0) {
            const wv = Math.sin(u * 19 + this.vt * 6 + pt.a) * amp * Math.sin(Math.PI * u) * sign
            x += nx * wv
            y += ny * wv
          }
          if (k === 0) ctx.moveTo(x, y + oy)
          else ctx.lineTo(x, y + oy)
        }
      }
      if (!evo) {
        trace(1, 0)
        ctx.lineWidth = 5.6
        ctx.strokeStyle = ink(0.8)
        ctx.stroke()
        ctx.lineWidth = 3.6
        ctx.strokeStyle = '#58627c'
        ctx.stroke()
        // 软管的暗肋：一圈圈横跨管身的短线
        DASH[0] = 1.2
        DASH[1] = 4.2
        ctx.setLineDash(DASH)
        ctx.lineCap = 'butt'
        ctx.strokeStyle = rgba('#04060d', 0.42)
        ctx.stroke()
        ctx.setLineDash(NO_DASH)
        ctx.lineCap = 'round'
        // 受光的一线 + 导能芯
        trace(1, 0, -0.9)
        ctx.lineWidth = 1
        ctx.strokeStyle = rgba('#ffffff', 0.22)
        ctx.stroke()
        trace(1, 0)
        ctx.lineWidth = 1.2
        ctx.strokeStyle = rgba(coreCol, 0.9)
        ctx.stroke()
      } else {
        // 两股绞线：先把两股的墨线都画好，再画钢身，最后是各自的导能芯，交叉处才干净
        for (let s = 0; s < 3; s++) {
          for (const sign of [1, -1]) {
            trace(sign, 2.8)
            ctx.lineWidth = s === 0 ? 4.4 : s === 1 ? 2.5 : 0.9
            ctx.strokeStyle = s === 0 ? ink(0.8) : s === 1 ? '#6b6f90' : rgba(coreCol, 0.95)
            ctx.stroke()
          }
        }
      }
      // 能量包：每一跳放出一个，用 PACKET_TRAVEL 秒顺着软管流回机身
      const age0 = tick - pt.cd
      for (let m = 0; m < 3; m++) {
        const age = age0 + m * tick
        if (age >= PACKET_TRAVEL || age > pt.d + 0.001) break
        const u = (1 - age / PACKET_TRAVEL) * umax
        const iu = 1 - u
        const x = iu * iu * ax + 2 * iu * u * kx + u * u * cx
        const y = iu * iu * ay + 2 * iu * u * ky + u * u * cy
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.5
        ctx.drawImage(packet.c, x - 7, y - 7, 14, 14)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
        // 菱形包体：朝着机身的一头尖
        ctx.beginPath()
        ctx.moveTo(x - dx * 4.4, y - dy * 4.4)
        ctx.lineTo(x - dy * 2.8, y + dx * 2.8)
        ctx.lineTo(x + dx * 3, y + dy * 3)
        ctx.lineTo(x + dy * 2.8, y - dx * 2.8)
        ctx.closePath()
        ctx.fillStyle = '#9dffc4'
        ctx.fill()
        ctx.lineWidth = 1.2
        ctx.strokeStyle = ink(0.85)
        ctx.stroke()
      }
      // 夹爪：刚扣上时从小变大，每一跳咬紧一下
      const bite = age0 <= pt.d ? Math.max(0, 1 - age0 / 0.1) : 0
      const cs = clamp01((pt.d - 0.1) / 0.1)
      if (cs > 0) {
        const sc = (cr / 10) * (0.6 + 0.4 * cs) * (1 + 0.18 * bite)
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(this.vt * 1.5 + pt.a)
        ctx.scale(sc, sc)
        ctx.globalAlpha = cs
        ctx.drawImage(clampSpr.c, -clampSpr.w / 2, -clampSpr.h / 2, clampSpr.w, clampSpr.h)
        ctx.restore()
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
          // 尖头弹丸 + 身后一道淡淡的曳光
          const len = b.kind === 'bolt' ? 20 + b.r * 2 : 14
          ctx.strokeStyle = rgba(b.color, 0.42)
          ctx.lineWidth = b.r * 1.2
          ctx.beginPath()
          ctx.moveTo(b.x - dx * 8, b.y - dy * 8)
          ctx.lineTo(b.x - dx * (len + 8), b.y - dy * (len + 8))
          ctx.stroke()
          const g = bank.glow(b.color)
          const gs = b.r * 3
          ctx.globalAlpha = 0.7
          ctx.drawImage(g.c, b.x - gs / 2, b.y - gs / 2, gs, gs)
          ctx.globalAlpha = 1
          // 弹丸本体是不透明的金属件，临时切回正常混合
          const bs = bank.bolt(b.color)
          const k = b.kind === 'bolt' ? b.r / 5 : 0.72
          ctx.globalCompositeOperation = 'source-over'
          ctx.save()
          ctx.translate(b.x, b.y)
          ctx.rotate(Math.atan2(dy, dx))
          ctx.scale(k, k)
          ctx.drawImage(bs.c, -bs.w / 2, -bs.h / 2, bs.w, bs.h)
          ctx.restore()
          ctx.globalCompositeOperation = 'lighter'
          break
        }
        case 'plasma': {
          // 等离子球：旋涡状的能量球，身后拖一道光尾
          const ps = bank.plasma(b.color)
          const sz = b.r * 4.4
          ctx.strokeStyle = rgba(b.color, 0.4)
          ctx.lineWidth = b.r * 1.2
          ctx.beginPath()
          ctx.moveTo(b.x, b.y)
          ctx.lineTo(b.x - dx * 26, b.y - dy * 26)
          ctx.stroke()
          ctx.save()
          ctx.translate(b.x, b.y)
          ctx.rotate(this.vt * 9 + b.x * 0.05)
          ctx.drawImage(ps.c, -sz / 2, -sz / 2, sz, sz)
          ctx.restore()
          break
        }
        case 'missile': {
          const ang = Math.atan2(dy, dx)
          // 尾焰：水滴形火舌（白芯 → 橙），随速度闪烁
          const fl = bank.flame('#ffb347')
          const len = 15 + 5 * Math.sin(this.vt * 60 + b.x)
          ctx.save()
          ctx.translate(b.x - dx * 4.5, b.y - dy * 4.5)
          ctx.rotate(ang + Math.PI)
          ctx.scale(len / 36, 5.2 / 12)
          ctx.drawImage(fl.c, 17 - fl.w / 2, -fl.h / 2, fl.w, fl.h)
          ctx.restore()
          // 弹体：不透明的金属弹头
          ctx.globalCompositeOperation = 'source-over'
          const ms = bank.missile(b.color)
          ctx.save()
          ctx.translate(b.x, b.y)
          ctx.rotate(ang)
          ctx.drawImage(ms.c, -ms.w / 2, -ms.h / 2, ms.w, ms.h)
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
          const gs = b.r * 3.8
          ctx.drawImage(g.c, b.x - gs / 2, b.y - gs / 2, gs, gs)
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.beginPath()
          ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU)
          ctx.fill()
          break
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  /** 记下进化武器的颜色，并让光环上不时飘出一粒光点（顺着飞船的运动方向拖出尾迹） */
  private updateEvoAura(w: World, animDt: number): void {
    const p = w.player
    const cols = this.evoCols
    cols.length = 0
    for (const wi of p.weapons) if (wi.evolved) cols.push(WEAPONS[wi.id].color)
    if (cols.length === 0 || animDt <= 0 || w.phase !== 'play') return
    this.auraT -= animDt
    if (this.auraT > 0) return
    this.auraT = 0.1 / (1 + cols.length * 0.35)
    const a = Math.random() * TAU
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    this.parts.dot(p.x + ca * 30, p.y + sa * 30, ca * 26 + p.vx * 0.15, sa * 26 + p.vy * 0.15, cols[(Math.random() * cols.length) | 0], 4.6, 0.6)
  }

  /**
   * 进化光环：只要有任何一把武器进化过，飞船周围就常驻金色光晕 + 每把进化武器一段旋转的弧（用该武器的颜色）。
   * 一眼就能数出"我现在有几把神装"。
   */
  private drawEvoAura(p: World['player']): void {
    const cols = this.evoCols
    const n = cols.length
    if (n === 0) return
    const ctx = this.ctx
    const vt = this.vt
    ctx.globalCompositeOperation = 'lighter'
    const g = this.bank.glow('#ffd84a')
    const gs = 78 + n * 6 + 8 * Math.sin(vt * 3.2)
    ctx.globalAlpha = Math.min(0.4, 0.17 + n * 0.05)
    ctx.drawImage(g.c, p.x - gs / 2, p.y - gs / 2, gs, gs)
    ctx.globalAlpha = 1
    const span = Math.min(1.9, (TAU / n) * 0.7)
    const rot = vt * 1.9
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i / n) * TAU
      const r = 31 + Math.sin(vt * 3 + i * 1.7) * 1.2
      // 弧线底下垫一层宽而淡的同色光
      ctx.strokeStyle = rgba(cols[i], 0.15)
      ctx.lineWidth = 5.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, a0, a0 + span)
      ctx.stroke()
      ctx.strokeStyle = rgba(cols[i], 0.9)
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, a0, a0 + span)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, a0 + span * 0.15, a0 + span * 0.85)
      ctx.stroke()
    }
    ctx.setLineDash([3, 7])
    ctx.lineDashOffset = -vt * 12
    ctx.strokeStyle = rgba('#ffd84a', 0.35)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(p.x, p.y, 38, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
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

    // 接触阴影：让机身"浮"在地面之上
    if (this.shadowsOn) {
      ctx.globalAlpha = 0.5
      ctx.drawImage(bank.shadow.c, p.x - 22 + 3, p.y - 22 + 5, 44, 44)
      ctx.globalAlpha = 1
    }

    // 尾焰：从每个喷口各喷一道水滴形火舌，长度随速度 / 冲刺变化
    const fcos = Math.cos(p.face)
    const fsin = Math.sin(p.face)
    const fl = 10 + speed * 0.05 + (dashing ? 18 : 0) + Math.sin(this.vt * 55) * 1.6
    const flame = bank.flame(ship.color)
    ctx.globalCompositeOperation = 'lighter'
    for (const [mx, my] of engineMounts(w.cfg.ship)) {
      ctx.save()
      ctx.translate(p.x + fcos * mx - fsin * my, p.y + fsin * mx + fcos * my)
      ctx.rotate(p.face + Math.PI)
      ctx.scale(fl / 36, (dashing ? 6.2 : 5) / 12)
      ctx.drawImage(flame.c, 17 - flame.w / 2, -flame.h / 2, flame.w, flame.h)
      ctx.restore()
    }
    ctx.globalCompositeOperation = 'source-over'

    this.drawEvoAura(p)

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
    ctx.fillStyle = ink(0.8)
    ctx.beginPath()
    ctx.arc(p.x, p.y, 3.4, 0, TAU)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.97)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 2.1, 0, TAU)
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

  /**
   * 泛光：只让"真正很亮"的东西（弹芯、爆炸、灯、激光）向外晕开。
   * 先降到 1/4 分辨率，再把它和自己相乘两次（c⁴ 会把中间调压得很暗、只留高光），
   * 然后继续降到 1/8，两层用 screen 叠回去。旧版没有阈值，整张画面都被加亮，人群里就成了一团粉雾。
   * 阈值放在 1/4 分辨率做：像素数只有半分辨率的 1/4，纯软件光栅化下省下约一半的泛光耗时；
   * 代价是几像素大的小亮点（单颗子弹）在阈值里被压没了——正好符合"克制"：只有爆炸 / 光束 / 大面积的亮才会晕。
   */
  private bloomPass(): void {
    const half = this.bloomHalf
    const quarter = this.bloomQuarter
    const eighth = this.bloomEighth
    const hc = this.bhC
    const qc = this.bqC
    const ec = this.beC
    const tmp = this.bloomTmp
    const tc = this.btC
    if (!half || !quarter || !eighth || !hc || !qc || !ec || !tmp || !tc) return
    hc.globalCompositeOperation = 'copy'
    hc.drawImage(this.canvas, 0, 0, half.width, half.height)
    qc.globalCompositeOperation = 'copy'
    qc.drawImage(half, 0, 0, quarter.width, quarter.height)
    // 阈值：c² 两次近似 c⁴（高光 0.9→0.66，中间调 0.5→0.06）
    for (let i = 0; i < 2; i++) {
      tc.globalCompositeOperation = 'copy'
      tc.drawImage(quarter, 0, 0)
      qc.globalCompositeOperation = 'multiply'
      qc.drawImage(tmp, 0, 0)
    }
    qc.globalCompositeOperation = 'source-over'
    ec.globalCompositeOperation = 'copy'
    ec.drawImage(quarter, 0, 0, eighth.width, eighth.height)
    const ctx = this.ctx
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = 0.9
    ctx.drawImage(quarter, 0, 0, this.W, this.H)
    ctx.globalAlpha = 0.8
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
    // 进化聚焦暗角（在闪光之下：爆发那一下的白闪盖过它，随后它慢慢退去）
    if (this.focusV > 0.01) {
      ctx.globalAlpha = this.focusV * 0.62 * soft
      ctx.drawImage(this.focusVig, 0, 0, this.W, this.H)
      ctx.globalAlpha = 1
    }
    // 全屏闪光
    if (this.flashA > 0.01) {
      ctx.fillStyle = rgba(this.flashColor, this.flashA * 0.6)
      ctx.fillRect(0, 0, this.W, this.H)
    }
  }
}
