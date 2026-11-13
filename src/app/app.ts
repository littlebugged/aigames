import { SECTORS } from '../data/sectors'
import { SECTOR_IDS, type WeaponId } from '../data/ids'
import { AudioEngine } from '../engine/audio'
import { EVOLVE_CHARGE, EVOLVE_TOTAL, evolveTimeScale } from '../engine/feel'
import { canInstall, promptInstall } from './pwa'
import { Input } from '../engine/input'
import type { InputState } from '../game/entities'
import type { GameEvent } from '../game/events'
import { Bot } from '../game/bot'
import {
  isSectorUnlocked,
  settleRun,
  type Lang,
  type RunSummary,
  type SaveData,
} from '../game/progress'
import { World } from '../game/world'
import { dyn, getLang, onLangChange, setLang, t } from '../i18n'
import { Renderer, type Quality, type RenderSettings } from '../render/renderer'
import type { Screen, ScreenId, Selection, ToastKind, UiCtx } from '../ui/ctx'
import { createAchievements } from '../ui/achievements'
import { createDeploy } from '../ui/deploy'
import { clear, h, moveFocus } from '../ui/dom'
import { createHangar } from '../ui/hangar'
import { Hud } from '../ui/hud'
import { LevelUpOverlay } from '../ui/levelup'
import { createMenu } from '../ui/menu'
import { PauseOverlay } from '../ui/pause'
import { ResultsScreen } from '../ui/results'
import { SettingsModal } from '../ui/settings'
import { detectLang, loadSave, writeSave } from './storage'

type State = 'menu' | 'play' | 'results'

const MAX_STEP = 1 / 30

export class App {
  private save: SaveData
  private readonly audio = new AudioEngine()
  private readonly input = new Input()
  private readonly renderer: Renderer
  private readonly stage: HTMLElement
  private readonly ui: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly screenHost = h('div', { class: 'screens' })
  private readonly gtoasts = h('div', { class: 'gtoasts' })
  private readonly ctx: UiCtx
  private readonly screens: Record<ScreenId, Screen>
  private readonly settingsUi: SettingsModal
  private readonly hud: Hud
  private readonly levelup: LevelUpOverlay
  private readonly pauseUi: PauseOverlay
  private readonly results: ResultsScreen

  private state: State = 'menu'
  private current: ScreenId | null = null
  private world: World | null = null
  private demo: World | null = null
  private bot: Bot | null = null
  private demoClock = 0
  private paused = false
  /**
   * 武器进化的"演出导演"：蓄力（慢下来）→ 冲击波引爆（砸到定格）→ 慢慢恢复。
   * t 是事件发生后的真实秒数，只在对局进行中才走（暂停 / 选卡时冻结）。
   */
  private cine: { t: number; w: WeaponId; boomed: boolean } | null = null
  private endT = -1
  private lastT = 0
  private sel: Selection
  private tutStep = 0
  private lastBonus = 0
  private touch = false

  // 自适应画质
  private readonly forcedQuality: Quality | null
  private autoQuality: Quality
  private frameEma = 16.7
  private adaptT = 0
  private slowCount = 0
  private readonly e2e: boolean
  /** 仅 ?e2e=1 调试用：机器人代打 / 无敌，便于无头浏览器截取中后期画面 */
  autoPilot = false
  godMode = false
  private pilot: Bot | null = null

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, stage: HTMLElement) {
    this.canvas = canvas
    this.ui = ui
    this.stage = stage

    const params = new URLSearchParams(location.search)
    this.e2e = params.get('e2e') === '1'
    const q = params.get('q')
    this.forcedQuality = q === 'high' || q === 'medium' || q === 'low' ? q : null

    const lang = detectLang()
    this.save = loadSave(lang)
    // 页面语言（URL）决定界面语言
    this.save.settings.lang = lang
    setLang(lang)

    this.touch = window.matchMedia('(pointer: coarse)').matches
    this.input.lastDevice = this.touch ? 'touch' : 'kbd'
    this.autoQuality = this.forcedQuality ?? (this.touch ? 'medium' : 'high')

    const rs: RenderSettings = {
      quality: this.forcedQuality ?? this.effectiveQuality(),
      shake: this.save.settings.shake,
      dmgNumbers: this.save.settings.dmgNumbers,
      reduceFlash: this.save.settings.reduceFlash,
    }
    this.renderer = new Renderer(canvas, rs)

    const self = this
    this.ctx = {
      get save() {
        return self.save
      },
      audio: this.audio,
      input: this.input,
      persist: () => writeSave(this.save),
      replaceSave: (s) => {
        this.save = s
        this.save.settings.lang = getLang()
        writeSave(this.save)
        this.applySettings()
        this.refreshAll()
      },
      go: (id) => this.go(id),
      start: (sel) => this.startRun(sel),
      sfx: (k) => this.audio.ui(k),
      toast: (text, kind, ms) => this.toast(text, kind, ms),
      applySettings: () => this.applySettings(),
      setLang: (l) => this.changeLang(l),
      openSettings: (cb) => this.settingsUi.open(cb),
      toggleFullscreen: () => this.toggleFullscreen(),
      canInstall: () => canInstall(),
      install: () => void promptInstall(),
    }

    this.screens = {
      menu: createMenu(this.ctx),
      deploy: createDeploy(this.ctx),
      hangar: createHangar(this.ctx),
      ach: createAchievements(this.ctx),
    }
    this.settingsUi = new SettingsModal(this.ctx)
    this.hud = new Hud(this.ctx, () => this.pause())
    this.levelup = new LevelUpOverlay(this.ctx, {
      choose: (i) => this.chooseOffer(i),
      reroll: () => this.world?.reroll() ?? false,
      banish: (i) => this.world?.banish(i) ?? false,
    })
    this.pauseUi = new PauseOverlay(this.ctx, {
      resume: () => this.resume(),
      abandon: () => this.abandon(),
      settings: () => this.settingsUi.open(),
    })
    this.results = new ResultsScreen(this.ctx, {
      again: () => this.startRun(this.sel),
      menu: () => this.go('menu'),
      hangar: () => this.go('hangar'),
    })

    const joy = h('div', { class: 'joy-zone' })
    clear(this.ui)
    this.ui.append(joy, this.screenHost, this.hud.el, this.levelup.el, this.pauseUi.el, this.results.el, this.settingsUi.el, this.gtoasts)
    this.input.attachJoystick(joy)

    this.sel = { ...this.save.last }
    this.bindGlobal()
    this.applySettings()
    this.hud.setTouch(this.touch)
    document.body.classList.toggle('touch', this.touch)

    onLangChange(() => this.refreshAll())

    // 先建一个演示世界，再显示主菜单
    this.startDemo()
    this.go('menu')
    this.renderer.resize(this.stage.clientWidth, this.stage.clientHeight)

    if (this.e2e) {
      ;(window as unknown as { __neon: unknown }).__neon = this
    }
    requestAnimationFrame((t0) => {
      this.lastT = t0
      requestAnimationFrame(this.loop)
    })
  }

  // ───────────────────────── 全局事件 ─────────────────────────

  private bindGlobal(): void {
    new ResizeObserver(() => this.renderer.resize(this.stage.clientWidth, this.stage.clientHeight)).observe(this.stage)

    // 第一次交互时解锁音频，并开始菜单音乐
    const unlock = (): void => {
      this.audio.unlock()
      this.syncMusic()
    }
    window.addEventListener('pointerdown', unlock, { capture: true })
    window.addEventListener('keydown', unlock, { capture: true })

    // 捕获阶段先于 Input 处理：覆盖层（暂停/升级/设置…）吃掉的按键不会再触发战斗输入
    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true })

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause('blur')
    })
    window.addEventListener('pagehide', () => writeSave(this.save))
    if (!this.e2e) window.addEventListener('blur', () => this.pause('blur'))

    this.input.onPause = () => this.pause()
    this.input.onNav = (dir) => {
      if (this.levelup.isOpen) return this.levelup.navigate(dir)
      if (dir === 'confirm') {
        ;(document.activeElement as HTMLElement | null)?.click()
        return
      }
      if (dir === 'back') {
        this.onKey(new KeyboardEvent('keydown', { key: 'Escape' }))
        return
      }
      const scope = this.settingsUi.isOpen ? this.settingsUi.el : this.pauseUi.isOpen ? this.pauseUi.el : this.results.isOpen ? this.results.el : this.ui
      moveFocus(scope, dir)
      this.audio.ui('hover')
    }
    this.input.onDeviceChange = (d) => {
      this.hud.setTouch(d === 'touch')
      document.body.classList.toggle('touch', d === 'touch')
    }

    // 防止触屏上的双击缩放、长按菜单、下拉刷新干扰操作
    this.stage.addEventListener('contextmenu', (e) => e.preventDefault())

    window.addEventListener('offline', () => this.toast(t('page.offline'), 'info', 2800))
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const consume = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (this.settingsUi.onKey(e)) return consume()
    if (this.results.onKey(e)) return consume()
    if (this.pauseUi.onKey(e)) return consume()
    if (this.levelup.onKey(e)) return consume()
    if (this.state === 'menu' && this.current) {
      if (this.screens[this.current].onKey?.(e)) return consume()
      const dirs: Record<string, 'left' | 'right' | 'up' | 'down'> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      }
      const d = dirs[e.key]
      if (d && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        consume()
        moveFocus(this.ui, d)
      }
    }
  }

  // ───────────────────────── 设置 ─────────────────────────

  private effectiveQuality(): Quality {
    const q = this.save.settings.quality
    return this.forcedQuality ?? (q === 'auto' ? this.autoQuality : q)
  }

  private applySettings(): void {
    const s = this.save.settings
    this.audio.setVolumes(s.master, s.sfx, s.music)
    const rs = this.renderer.settings
    rs.shake = s.shake
    rs.dmgNumbers = s.dmgNumbers
    rs.reduceFlash = s.reduceFlash
    const q = this.effectiveQuality()
    if (q !== rs.quality) this.renderer.setQuality(q)
    this.input.leftHanded = s.leftHanded
    this.input.vibration = s.vibration
    document.body.classList.toggle('left-handed', s.leftHanded)
    document.body.classList.toggle('reduce-flash', s.reduceFlash)
  }

  private changeLang(l: Lang): void {
    if (l === getLang()) return
    this.save.settings.lang = l
    writeSave(this.save)
    if (this.state === 'play') {
      // 战斗中只切换界面语言，避免丢进度
      setLang(l)
      return
    }
    location.assign(l === 'zh' ? '/' : '/en/')
  }

  private refreshAll(): void {
    if (this.current) this.screens[this.current].refresh()
    this.settingsUi.refresh()
    this.pauseUi.refresh()
    this.results.refresh()
    document.title = `${t('app.title')} · NEON SURGE`
  }

  private toggleFullscreen(): void {
    const el = document.documentElement
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => this.toast(t('page.fullscreenFail'), 'info'))
    } else {
      this.toast(t('page.fullscreenFail'), 'info')
    }
  }

  // ───────────────────────── PWA：新版本 / 安装 / 网络 ─────────────────────────

  private updateReady = false
  private updateShown = false

  /** Service Worker 已接管新版本：不打断战斗，回到菜单后再提示刷新 */
  notifyUpdate(): void {
    this.updateReady = true
    this.showUpdate()
  }

  private showUpdate(): void {
    if (!this.updateReady || this.updateShown || this.state === 'play') return
    this.updateShown = true
    this.gtoasts.appendChild(
      h(
        'div',
        { class: 'toast gold update' },
        h('span', null, t('page.updated')),
        h('button', { class: 'btn sm primary', onClick: () => location.reload() }, t('page.refresh')),
      ),
    )
  }

  /** "可安装"状态变化时重绘菜单（出现 / 隐藏安装按钮） */
  refreshMenu(): void {
    if (this.current === 'menu') this.screens.menu.refresh()
  }

  toast(text: string, kind: ToastKind = 'info', ms = 2400): void {
    if (this.state === 'play' && !this.hud.el.hidden) {
      this.hud.toast(text, kind, ms)
      return
    }
    const el = h('div', { class: `toast ${kind}` }, text)
    this.gtoasts.appendChild(el)
    while (this.gtoasts.children.length > 3) this.gtoasts.firstElementChild?.remove()
    setTimeout(() => {
      el.classList.add('out')
      setTimeout(() => el.remove(), 400)
    }, ms)
  }

  // ───────────────────────── 屏幕切换 ─────────────────────────

  private go(id: ScreenId): void {
    // 菜单下方有可滚动的说明文字；进入其它屏幕前回到顶部，避免界面被滚出视口
    if (id !== 'menu') window.scrollTo(0, 0)
    this.leaveRun()
    this.state = 'menu'
    if (!this.demo) this.startDemo()
    const s = this.screens[id]
    s.refresh()
    this.screenHost.replaceChildren(s.el)
    s.el.classList.remove('enter')
    void s.el.offsetWidth
    s.el.classList.add('enter')
    this.current = id
    document.body.dataset.screen = id
    this.syncMusic()
    const first = s.el.querySelector<HTMLElement>('.btn.primary') ?? s.el.querySelector<HTMLElement>('.card.active .card-hit') ?? s.el.querySelector<HTMLElement>('button')
    if (first && this.input.lastDevice !== 'touch') first.focus({ preventScroll: true })
    this.showUpdate()
  }

  /** 离开战斗/结算：收起所有战斗 UI */
  private leaveRun(): void {
    this.results.hide()
    this.hud.hide()
    this.levelup.hide()
    this.pauseUi.hide()
    this.paused = false
    this.endT = -1
    this.input.enabled = false
    this.input.reset()
    document.body.classList.remove('in-run')
    this.world = null
  }

  private syncMusic(): void {
    if (this.state === 'play') return
    this.audio.musicMode('menu')
  }

  // ───────────────────────── 演示世界（主菜单背景） ─────────────────────────

  private startDemo(): void {
    const unlocked = SECTOR_IDS.filter((id) => isSectorUnlocked(this.save, id))
    const sector = unlocked[Math.floor(Math.random() * unlocked.length)] ?? 'fields'
    const seed = (Math.random() * 0xffffffff) >>> 0
    const ships = this.save.ships
    const w = new World({
      seed,
      ship: ships[Math.floor(Math.random() * ships.length)] ?? 'vanguard',
      sector,
      threat: 0,
      meta: {},
      demo: true,
    })
    w.sink = (e) => this.renderer.onEvent(e)
    this.demo = w
    this.bot = new Bot(seed, 1, 0.15)
    this.demoClock = 0
    this.renderer.attach(w)
  }

  private updateDemo(dt: number): void {
    const w = this.demo
    const bot = this.bot
    if (!w || !bot) return
    this.demoClock += dt
    if (this.demoClock > 150) {
      this.startDemo()
      return
    }
    const inp: InputState = { mx: 0, my: 0, dash: false }
    bot.drive(w, dt, inp)
    w.update(dt, inp)
    if (w.phase === 'levelup') w.choose(bot.pick(w))
  }

  // ───────────────────────── 一局游戏 ─────────────────────────

  private startRun(sel: Selection): void {
    this.audio.unlock()
    this.sel = { ...sel }
    this.save.last = { ...sel }
    writeSave(this.save)

    this.leaveRun()
    this.screenHost.replaceChildren()
    this.current = null
    delete document.body.dataset.screen
    document.body.classList.add('in-run')
    window.scrollTo(0, 0)

    const seed = (Math.random() * 0xffffffff) >>> 0
    const w = new World({
      seed,
      ship: sel.ship,
      sector: sel.sector,
      threat: sel.threat,
      meta: { ...this.save.meta },
      endless: sel.endless,
    })
    w.sink = (e) => this.onGameEvent(e)
    this.world = w
    this.demo = null
    this.state = 'play'
    this.paused = false
    this.endT = -1
    this.cine = null
    this.tutStep = 0
    this.lastBonus = 0
    this.renderer.attach(w)
    this.hud.reset(w)
    this.hud.show()
    this.input.enabled = true
    this.input.reset()
    this.audio.musicMode('play', sel.sector)
    this.audio.setIntensity(0.05)
    this.audio.setPaused(false)

    // 竖屏手机上提示一次：横屏视野更开阔（本次访问只提示一次）
    if (this.touch && !this.rotateHinted && window.innerHeight > window.innerWidth * 1.15) {
      this.rotateHinted = true
      this.hud.toast(t('page.rotate'), 'info', 3600)
    }
  }

  private rotateHinted = false

  private chooseOffer(i: number): void {
    const w = this.world
    if (!w) return
    w.choose(i)
    if (w.phase === 'levelup') {
      this.levelup.refresh()
    } else {
      this.levelup.hide()
      // 选完卡给一小段缓冲，避免暂停回来立刻被打
      w.player.invuln = Math.max(w.player.invuln, 0.7)
      this.input.enabled = !this.paused
    }
  }

  private pause(reason?: 'blur'): void {
    const w = this.world
    if (this.state !== 'play' || !w || w.phase !== 'play' || this.paused || this.endT >= 0) return
    this.paused = true
    this.input.enabled = false
    this.input.reset()
    this.pauseUi.show(w)
    this.audio.setPaused(true)
    if (reason === 'blur') this.toast(t('page.paused.blur'), 'info', 2600)
  }

  private resume(): void {
    this.paused = false
    this.pauseUi.hide()
    this.settingsUi.isOpen && this.settingsUi.close()
    this.input.enabled = !this.levelup.isOpen
    this.audio.setPaused(false)
  }

  private abandon(): void {
    const w = this.world
    if (!w) return
    this.paused = false
    this.pauseUi.hide()
    this.input.enabled = false
    this.audio.setPaused(false)
    w.abandon()
  }

  private onGameEvent(e: GameEvent): void {
    const w = this.world
    // 进化由下面的演出导演接管（蓄力 / 爆发两幕），不走渲染层的简化版
    if (e.t !== 'evolve') this.renderer.onEvent(e)
    this.audio.onEvent(e, w)
    switch (e.t) {
      case 'warn':
        if (e.key.startsWith('boss.')) this.hud.showBanner(`⚠ ${t(dyn(e.key))}`, 2, true)
        else this.hud.showBanner(`⚠ ${t(dyn(e.key))}`, e.sev)
        break
      case 'pickup':
        if (e.kind === 'heal') this.hud.toast(t('toast.heal'), 'good', 1400)
        else if (e.kind === 'magnet') this.hud.toast(t('toast.magnet'), 'info', 1400)
        else if (e.kind === 'bomb') this.hud.toast(t('toast.bomb'), 'info', 1400)
        else if (e.kind === 'chest') this.hud.toast(t('hud.chest'), 'gold', 1400)
        break
      case 'evolve':
        // 第一幕：蓄力。已经有一次演出在爆发阶段时，别打断它
        if (!this.cine || this.cine.boomed) this.cine = { t: 0, w: e.w, boomed: false }
        this.renderer.evolveCharge(e.w)
        this.input.buzz([15, 30, 15])
        break
      case 'evolveBoom':
        // 第二幕：冲击波引爆。画面、横幅、手机震动在这一刻一起砸下来，时间流速从这里开始"定格 → 恢复"
        this.cine = { t: EVOLVE_CHARGE, w: e.w, boomed: true }
        this.renderer.evolveBoom(e.w)
        this.hud.showEvolve(e.w)
        this.input.buzz([30, 30, 70])
        break
      case 'revive':
        this.hud.toast(t('hud.revived'), 'good', 2800)
        this.input.buzz([40, 30, 80])
        break
      case 'boss':
        if (e.what === 'spawn' && w) this.audio.musicMode('boss', w.cfg.sector)
        else if (e.what === 'dead' && w) {
          this.audio.musicMode('play', w.cfg.sector)
          this.audio.setIntensity(0.6)
          this.hud.toast(t('hud.bossDown'), 'gold', 3600)
          if (w.cfg.endless) setTimeout(() => this.hud.toast(t('hud.endlessOn'), 'info', 3600), 1800)
        }
        break
      case 'hurt':
        this.input.buzz(e.dmg > 15 ? 50 : 25)
        break
      case 'levelup':
        this.input.buzz(18)
        break
      case 'end':
        this.cine = null
        this.endT = e.won ? 1.0 : 1.6
        this.input.enabled = false
        this.audio.musicMode('off')
        break
      default:
        break
    }
  }

  private finishRun(): void {
    const w = this.world
    if (!w) return
    const st = w.stats
    st.level = w.player.level
    const summary: RunSummary = {
      ship: w.cfg.ship,
      sector: w.cfg.sector,
      threat: w.cfg.threat,
      endless: !!w.cfg.endless,
      stats: st,
      bonusCores: w.bonusCores,
    }
    const settlement = settleRun(this.save, summary)
    this.save.tutorialDone = true
    writeSave(this.save)
    this.state = 'results'
    this.input.enabled = false
    this.hud.hide()
    this.levelup.hide()
    this.pauseUi.hide()
    this.results.show({ summary, settlement, won: st.bossKilled })
    for (const a of settlement.newAch) void a
    if (settlement.newAch.length > 0) this.audio.ui('achievement')
    else this.audio.ui(st.bossKilled ? 'confirm' : 'back')
  }

  // ───────────────────────── 主循环 ─────────────────────────

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop)
    const dtMs = Math.min(100, now - this.lastT)
    this.lastT = now
    this.frame(dtMs / 1000, dtMs)
  }

  private frame(dt: number, dtMs: number): void {
    try {
      // 菜单 / 结算：手柄在这里导航。轮询可能触发界面切换（比如按 A 开始出击），
      // 所以必须先轮询，再按"最新状态"决定画什么。
      if (this.state !== 'play') this.input.poll(dt)
      if (this.state === 'play' && this.world) this.framePlay(dt)
      else if (this.state === 'results' && this.world) this.renderer.frame(this.world, dt * 0.5)
      else if (this.demo) {
        this.updateDemo(Math.min(dt, MAX_STEP))
        this.renderer.frame(this.demo, dt)
      }
      this.adapt(dtMs)
    } catch (err) {
      // 渲染/逻辑异常不应该让整个页面卡死：暂停并提示
      console.error(err)
      this.crash(err)
    }
  }

  private crashed = false
  private crash(err: unknown): void {
    if (this.crashed) return
    this.crashed = true
    const box = h(
      'div',
      { class: 'overlay crash' },
      h('div', { class: 'pause-panel' }, h('h2', null, t('page.error')), h('p', { class: 'crash-msg' }, String((err as Error)?.message ?? err)), h('button', { class: 'btn primary lg', onClick: () => location.reload() }, t('page.refresh'))),
    )
    this.ui.appendChild(box)
  }

  private framePlay(dt: number): void {
    const w = this.world
    if (!w) return
    const playing = !this.paused && w.phase === 'play'
    let ts = 1

    if (playing) {
      const inp = this.input.poll(dt)
      if (this.autoPilot) {
        this.pilot ??= new Bot(11, 1, 0)
        this.pilot.drive(w, dt, inp)
      }
      if (this.godMode) w.player.hp = w.player.maxHp
      // 进化演出的时间流速（1 = 正常）
      ts = this.cineScale(dt)
      const sdt = dt * ts
      // 帧率低时分多步模拟，保持游戏速度；单步不超过 1/30 秒
      const steps = Math.min(3, Math.max(1, Math.ceil(sdt / MAX_STEP)))
      const sd = Math.min(sdt, MAX_STEP * 3) / steps
      for (let i = 0; i < steps && w.phase === 'play'; i++) {
        w.update(sd, i === 0 ? inp : { mx: inp.mx, my: inp.my, dash: false })
      }
      this.runHints(w)
      this.watchBonus(w)
      this.audio.setIntensity(this.intensityOf(w))
    } else {
      this.input.poll(dt)
    }

    // 升级面板的开合由世界阶段驱动
    if (this.autoPilot && w.phase === 'levelup' && this.pilot) this.chooseOffer(this.pilot.pick(w))
    if (w.phase === 'levelup' && !this.levelup.isOpen && !this.paused) {
      this.levelup.show(w)
      this.input.enabled = false
      this.input.reset()
    }

    this.renderer.frame(w, playing ? dt * ts : w.phase === 'won' || w.phase === 'lost' ? dt : 0)
    this.hud.update(w, playing ? dt : 0)

    if (this.endT >= 0) {
      this.endT -= dt
      if (this.endT < 0) this.finishRun()
    }
  }

  /** 推进进化演出的时钟，返回这一帧的时间流速 */
  private cineScale(dt: number): number {
    const c = this.cine
    if (!c) return 1
    c.t += dt
    if (!c.boomed) {
      // 蓄力阶段：停在"屏息"的流速上等冲击波引爆（由模拟层的 evolveBoom 事件触发）；超时保险
      if (c.t > EVOLVE_CHARGE + 0.6) {
        this.cine = null
        return 1
      }
      return evolveTimeScale(Math.min(c.t, EVOLVE_CHARGE - 0.001))
    }
    if (c.t >= EVOLVE_TOTAL) {
      this.cine = null
      return 1
    }
    return evolveTimeScale(c.t)
  }

  private intensityOf(w: World): number {
    const prog = Math.min(1, w.time / w.sector.length)
    return Math.min(0.95, 0.08 + prog * 0.55 + Math.min(0.3, w.enemies.length / 260))
  }

  private watchBonus(w: World): void {
    if (w.bonusCores > this.lastBonus) {
      this.hud.toast(t('toast.cores', { n: w.bonusCores - this.lastBonus }), 'gold', 1600)
      this.lastBonus = w.bonusCores
    }
  }

  /** 新手引导：只在第一次游玩时按时间点依次提示 */
  private runHints(w: World): void {
    if (this.save.tutorialDone) return
    const tm = w.time
    if (this.tutStep === 0 && tm > 0.6) {
      this.hud.showHint(t(this.input.lastDevice === 'touch' ? 'tut.moveTouch' : 'tut.move'), 8)
      this.tutStep = 1
    } else if (this.tutStep === 1 && tm > 15) {
      this.hud.showHint(t('tut.gems'), 6)
      this.tutStep = 2
    } else if (this.tutStep === 2 && tm > 32) {
      this.hud.showHint(t(this.input.lastDevice === 'touch' ? 'tut.dashTouch' : 'tut.dash'), 7)
      this.tutStep = 3
    } else if (this.tutStep === 3 && w.player.weapons.some((x) => x.level >= 4)) {
      this.hud.showHint(t('tut.evolve'), 8)
      this.tutStep = 4
    }
  }

  // ───────────────────────── 自适应画质 ─────────────────────────

  private adapt(dtMs: number): void {
    if (this.forcedQuality || this.save.settings.quality !== 'auto' || this.state !== 'play' || this.paused) return
    this.frameEma += (dtMs - this.frameEma) * 0.06
    this.adaptT += dtMs
    if (this.adaptT < 1500) return
    this.adaptT = 0
    if (this.frameEma > 22) {
      this.slowCount++
      if (this.slowCount >= 2 && this.autoQuality !== 'low') {
        this.autoQuality = this.autoQuality === 'high' ? 'medium' : 'low'
        this.slowCount = 0
        this.frameEma = 16.7
        this.renderer.setQuality(this.autoQuality)
      }
    } else this.slowCount = 0
  }

  // ───────────────────────── 调试 / e2e ─────────────────────────

  /** 以机器人操控快速推进当前世界（不渲染），用来截取后期画面。仅 ?e2e=1 时可见。 */
  fastForward(seconds: number, god = true): void {
    const w = this.world
    if (!w) return
    const bot = new Bot(7, 1, 0)
    const inp: InputState = { mx: 0, my: 0, dash: false }
    const end = w.time + seconds
    let guard = 0
    while (w.time < end && w.phase !== 'won' && w.phase !== 'lost' && guard++ < 200000) {
      if (w.phase === 'levelup') {
        w.choose(bot.pick(w))
        continue
      }
      bot.drive(w, MAX_STEP, inp)
      w.update(MAX_STEP, inp)
      if (god) w.player.hp = w.player.maxHp
    }
    while (w.phase === 'levelup') w.choose(bot.pick(w))
    this.levelup.hide()
    this.input.enabled = true
  }

  debug(): Record<string, unknown> {
    const w = this.world ?? this.demo
    return {
      state: this.state,
      screen: this.current,
      paused: this.paused,
      phase: w?.phase,
      time: w?.time,
      hp: w?.player.hp,
      level: w?.player.level,
      enemies: w?.enemies.length,
      kills: w?.stats.kills,
      weapons: w?.player.weapons.map((x) => `${x.id}:${x.level}${x.evolved ? '*' : ''}`),
      quality: this.renderer.settings.quality,
      frameMs: Math.round(this.renderer.frameMs * 100) / 100,
      canvas: [this.renderer.W, this.renderer.H],
      boss: w?.boss ? { id: w.boss.id, hp: w.boss.hp, phase: w.boss.phase } : null,
      levelupOpen: this.levelup.isOpen,
      cores: this.save.cores,
    }
  }

  /** 仅 e2e：主输出电平 */
  audioLevel(): { state: string; rms: number; peak: number } | null {
    return this.audio.meter()
  }

  get game(): World | null {
    return this.world
  }

  get sectors(): typeof SECTORS {
    return SECTORS
  }
}
