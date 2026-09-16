// 星尘消消乐 —— 对局场景：棋盘渲染 / 拖拽与点击放置 / 合成与消除动画 / 暂停
// 规则计算全部委托给 engine.ts（纯逻辑），本场景只做表现层

import Phaser from 'phaser'
import {
  SIZE,
  playRound,
  generateValue,
  makeHand,
  applyGravity,
} from './engine'
import {
  FONT,
  GAME_W,
  GAME_H,
  COLOR,
  CELL,
  GAP,
  BOARD_PX,
  BOARD_X,
  BOARD_Y,
  HAND_SIZE,
  HAND_SLOT,
  HAND_GAP,
  HAND_Y,
  STORE,
  loadBest,
  saveBest,
  pushRecent,
  storeGet,
  storeSet,
} from './config'
import { sfx } from './Sfx'

interface TileView {
  cont: Phaser.GameObjects.Container
  txt: Phaser.GameObjects.Text
}

interface OverData {
  score: number
  best: number
  isNew: boolean
  maxCombo: number
  merges: number
  clears: number
  duration: number
}

// 格心坐标：第 0 格中心 = (BOARD_X + CELL/2, BOARD_Y + CELL/2)，间距 CELL+GAP
const cellX = (c: number): number => BOARD_X + CELL / 2 + c * (CELL + GAP)
const cellY = (r: number): number => BOARD_Y + CELL / 2 + r * (CELL + GAP)
const slotX = (i: number): number => GAME_W / 2 + (i - 1) * (HAND_SLOT + HAND_GAP)

export class GameScene extends Phaser.Scene {
  private grid: number[] = []
  private views: (TileView | null)[] = []
  private hand: number[] = []
  private handViews: (TileView | null)[] = []
  private handSlots: Phaser.GameObjects.Rectangle[] = []

  private score = 0
  private best = 0
  private maxCombo = 0 // 本局单回合格数峰值
  private emptyTurn = 0 // 连续未触发消除的回合（PRD 4.4：3 次后连击重置）
  private startTime = 0
  private mergeTotal = 0
  private clearTotal = 0

  private scoreText!: Phaser.GameObjects.Text
  private bestText!: Phaser.GameObjects.Text
  private comboText!: Phaser.GameObjects.Text

  // 交互状态
  private picked = -1 // 已拾取的手牌索引；-1 无
  private pickStart = { x: 0, y: 0 }
  private ghost: Phaser.GameObjects.Container | null = null
  private overlays: Phaser.GameObjects.Rectangle[] = []
  private hover: Phaser.GameObjects.Rectangle | null = null

  private busy = false // 回合动画播放中，锁输入
  private over = false
  private paused = false
  private pausePanel: Phaser.GameObjects.Container | null = null

  constructor() {
    super('game')
  }

  create(): void {
    // 重置状态（场景可重开）
    this.grid = new Array<number>(SIZE * SIZE).fill(0)
    this.views = new Array<TileView | null>(SIZE * SIZE).fill(null)
    this.hand = makeHand(HAND_SIZE)
    this.handViews = new Array<TileView | null>(HAND_SIZE).fill(null)
    this.handSlots = []
    this.overlays = []
    this.score = 0
    this.maxCombo = 0
    this.emptyTurn = 0
    this.mergeTotal = 0
    this.clearTotal = 0
    this.picked = -1
    this.ghost = null
    this.busy = false
    this.over = false
    this.paused = false
    this.pausePanel = null
    this.startTime = Date.now()
    this.best = loadBest()

    this.drawBackground()
    this.drawBoard()
    this.drawHud()
    this.drawHand()
    this.bindInput()

    // 首次进入新手引导（A-13：≤3 步可跳过）
    if (storeGet(STORE.tutorial) !== '1') {
      this.showTutorial()
    }
  }

  // ── 绘制 ────────────────────────────────────────────────

  private drawBackground(): void {
    const g = this.add.graphics()
    g.fillGradientStyle(COLOR.bgTop, COLOR.bgTop, COLOR.bgBottom, COLOR.bgBottom, 1)
    g.fillRect(0, 0, GAME_W, GAME_H)
    // 漂浮星尘
    for (let i = 0; i < 26; i += 1) {
      this.add
        .image(Math.random() * GAME_W, Math.random() * GAME_H, 'glow')
        .setScale(0.03 + Math.random() * 0.07)
        .setAlpha(0.15 + Math.random() * 0.3)
        .setTint(0x9fc6ff)
    }
  }

  private drawBoard(): void {
    // 棋盘底板
    const bg = this.add.graphics()
    bg.fillStyle(COLOR.boardBg, 0.92)
    bg.fillRoundedRect(BOARD_X - 10, BOARD_Y - 10, BOARD_PX + 20, BOARD_PX + 20, 14)
    bg.lineStyle(2, 0x2c3570, 1)
    bg.strokeRoundedRect(BOARD_X - 10, BOARD_Y - 10, BOARD_PX + 20, BOARD_PX + 20, 14)
    // 64 个格子
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        const gx = cellX(c) - CELL / 2
        const gy = cellY(r) - CELL / 2
        bg.fillStyle(COLOR.cellBg, 0.9)
        bg.fillRoundedRect(gx, gy, CELL, CELL, 9)
        bg.lineStyle(1.5, COLOR.cellBorder, 0.8)
        bg.strokeRoundedRect(gx, gy, CELL, CELL, 9)
      }
    }
    // 可放置高亮（拾取时显示）
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const x = cellX(i % SIZE)
      const y = cellY(Math.floor(i / SIZE))
      const ov = this.add
        .rectangle(x, y, CELL - 6, CELL - 6, COLOR.cellHover, 0.5)
        .setStrokeStyle(2, COLOR.accent, 0.8)
        .setVisible(false)
      this.overlays.push(ov)
    }
    // 悬停格
    this.hover = this.add
      .rectangle(0, 0, CELL, CELL, 0x000000, 0)
      .setStrokeStyle(3, 0xffffff, 0.9)
      .setVisible(false)
  }

  private drawHud(): void {
    this.add
      .text(48, 40, '分数', { fontFamily: FONT, fontSize: '15px', color: '#9aa3d0' })
      .setOrigin(0, 0.5)
    this.scoreText = this.add
      .text(48, 68, '0', { fontFamily: FONT, fontSize: '36px', fontStyle: 'bold', color: '#eaf0ff' })
      .setOrigin(0, 0.5)

    this.add
      .text(GAME_W - 48, 40, '最佳', { fontFamily: FONT, fontSize: '15px', color: '#9aa3d0' })
      .setOrigin(1, 0.5)
    this.bestText = this.add
      .text(GAME_W - 48, 68, String(this.best), {
        fontFamily: FONT,
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#ffd166',
      })
      .setOrigin(1, 0.5)

    this.comboText = this.add
      .text(GAME_W / 2, 52, '', { fontFamily: FONT, fontSize: '24px', fontStyle: 'bold', color: '#ffd166' })
      .setOrigin(0.5)
      .setShadow(0, 0, '#ff9f43', 14, true, true)

    // 暂停按钮
    const pauseBtn = this.add
      .text(GAME_W - 68, 108, '⏸', { fontFamily: FONT, fontSize: '24px', color: '#9aa3d0' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    pauseBtn.on('pointerover', () => pauseBtn.setColor('#eaf0ff'))
    pauseBtn.on('pointerout', () => pauseBtn.setColor('#9aa3d0'))
    pauseBtn.on('pointerdown', () => {
      sfx.click()
      this.togglePause()
    })
  }

  private drawHand(): void {
    for (let i = 0; i < HAND_SIZE; i += 1) {
      const x = slotX(i)
      const slot = this.add
        .rectangle(x, HAND_Y, HAND_SLOT, HAND_SLOT, COLOR.slotBg, 0.92)
        .setStrokeStyle(2, COLOR.cellBorder, 1)
      slot.setInteractive({ useHandCursor: true })
      this.handSlots.push(slot)
      this.refreshHand(i, false)
    }
  }

  /** 渲染/刷新手牌槽位 i（带放置动画） */
  private refreshHand(i: number, animate = true): void {
    const old = this.handViews[i]
    if (old) {
      old.cont.destroy()
      this.handViews[i] = null
    }
    const value = this.hand[i]
    const view = this.makeTileView(value)
    view.cont.setPosition(slotX(i), HAND_Y)
    this.handViews[i] = view
    if (animate) {
      view.cont.setScale(0.4)
      view.cont.setAlpha(0)
      this.tweens.add({ targets: view.cont, scale: 1, alpha: 1, duration: 160, ease: 'Back.easeOut' })
    }
  }

  // ── 输入 ────────────────────────────────────────────────

  private bindInput(): void {
    const k = this.input.keyboard!
    k.on('keydown-ESC', () => this.cancelPick())
    k.on('keydown-P', () => this.togglePause())

    // 手牌拾取（点击 + 拖拽统一入口）
    this.handSlots.forEach((slot, i) => {
      slot.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (this.busy || this.over || this.paused || this.ghost) return
        sfx.click()
        this.pickUp(i, p)
      })
    })

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.picked < 0 || !this.ghost) return
      this.ghost.setPosition(p.x, p.y)
      const cell = this.cellAt(p.x, p.y)
      if (cell >= 0 && this.grid[cell] === 0) {
        this.hover!.setPosition(cellX(cell % SIZE), cellY(Math.floor(cell / SIZE))).setVisible(true)
      } else {
        this.hover!.setVisible(false)
      }
    })

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPickUp(p))
  }

  private pickUp(i: number, p: Phaser.Input.Pointer): void {
    this.picked = i
    this.pickStart = { x: p.x, y: p.y }
    const view = this.handViews[i]
    if (view) view.cont.setAlpha(0.25)
    // 幽灵方块跟随指针
    const g = this.makeTileView(this.hand[i])
    g.cont.setPosition(p.x, p.y).setScale(1.05).setAlpha(0.92)
    this.ghost = g.cont
    // 高亮所有空位
    for (let j = 0; j < SIZE * SIZE; j += 1) {
      this.overlays[j].setVisible(this.grid[j] === 0)
    }
  }

  private onPickUp(p: Phaser.Input.Pointer): void {
    if (this.picked < 0) return
    const moved = Math.hypot(p.x - this.pickStart.x, p.y - this.pickStart.y) > 12
    const cell = this.cellAt(p.x, p.y)
    if (cell >= 0 && this.grid[cell] === 0) {
      // 拖拽到空格 / 点击空格（选中后松开）→ 放置
      void this.placeAt(cell, this.picked)
      return
    }
    if (cell >= 0 && !moved) {
      // 点击了已占用的格子：保持拾取，仅提示
      this.flashInvalid(cell)
      return
    }
    if (moved && cell < 0) {
      // 拖出棋盘的空白区域 → 回弹取消
      this.cancelPick()
    }
    // 未移动且不在格子上：保持拾取（等待点击空格）
  }

  private cancelPick(): void {
    if (this.picked < 0) return
    const i = this.picked
    this.picked = -1
    if (this.ghost) {
      this.ghost.destroy()
      this.ghost = null
    }
    const view = this.handViews[i]
    if (view) view.cont.setAlpha(1)
    for (const ov of this.overlays) ov.setVisible(false)
    this.hover!.setVisible(false)
  }

  /** 指针 → 格子索引；不在任何格内（含格间空隙）返回 -1 */
  private cellAt(x: number, y: number): number {
    const c = Math.round((x - BOARD_X - CELL / 2) / (CELL + GAP))
    const r = Math.round((y - BOARD_Y - CELL / 2) / (CELL + GAP))
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return -1
    const dx = Math.abs(x - (BOARD_X + CELL / 2 + c * (CELL + GAP)))
    const dy = Math.abs(y - (BOARD_Y + CELL / 2 + r * (CELL + GAP)))
    if (dx > CELL / 2 || dy > CELL / 2) return -1
    return r * SIZE + c
  }

  // ── 回合流程 ────────────────────────────────────────────

  /** 执行一次放置回合：引擎算规则，本方法负责按序播放动画 */
  private async placeAt(cell: number, handIdx: number): Promise<void> {
    if (this.busy || this.over || this.grid[cell] !== 0) return
    this.busy = true
    this.cancelPick()
    sfx.warm()

    const value = this.hand[handIdx]
    const before = [...this.grid]
    const result = playRound(this.grid, cell, value) // 就地得到终态 + 每步详情
    this.mergeTotal += result.merges.length
    this.clearTotal += result.chains.reduce((s, c) => s + c.cleared.length, 0)

    // 手牌补充（PRD 4.1：放置后从待放区补入）
    this.hand[handIdx] = generateValue()
    this.refreshHand(handIdx)

    // 1. 放置：新方块弹入
    const view = this.setView(cell, value)
    view.cont.setScale(0)
    sfx.place()
    await this.anim(view.cont, { scale: 1, duration: 140, ease: 'Back.easeOut' })

    // 2. 合成链：旁邻逐个被吸收，放置格翻倍跳动
    for (const m of result.merges) {
      const victim = this.views[m.from]
      if (victim) {
        this.views[m.from] = null
        this.burst(victim.cont.x, victim.cont.y, m.value)
        await this.anim(victim.cont, {
          scale: 0,
          alpha: 0,
          duration: 90,
          onComplete: () => victim.cont.destroy(),
        })
      }
      this.setViewValue(m.to, m.value)
      sfx.merge(m.step)
      const target = this.views[m.to]!
      this.anim(target.cont, { scale: 1.18, duration: 70, yoyo: true, ease: 'Quad.easeOut' })
      await this.delay(110)
    }

    // 3. 消除链：段段重演（引擎保证：有合成则链为空，故 chains 均基于「放置后」盘面，
    //    用 before + 放置格重演即可与引擎完全同步）
    if (result.chains.length > 0) {
      const stage = [...before]
      stage[cell] = value
      for (const chain of result.chains) {
        // 3a. 本段所有组并行消失（PRD 4.3.5）
        sfx.clear(chain.index)
        for (const i of chain.cleared) {
          const v = this.views[i]
          if (v) {
            this.views[i] = null
            this.burst(v.cont.x, v.cont.y, stage[i] || chain.value)
            this.anim(v.cont, { scale: 0, alpha: 0, duration: 130, ease: 'Cubic.easeIn' })
          }
        }
        await this.delay(90)
        // 3b. 同步 stage 并播放下落
        for (const i of chain.cleared) stage[i] = 0
        applyGravity(stage)
        for (const f of chain.falls) {
          const v = this.views[f.from]
          if (v) {
            this.views[f.to] = v
            this.views[f.from] = null
            this.anim(v.cont, {
              x: cellX(f.to % SIZE),
              y: cellY(Math.floor(f.to / SIZE)),
              duration: 150,
              ease: 'Cubic.easeIn',
            })
          }
        }
        // 3c. 更新落定后各格显示值
        for (let i = 0; i < SIZE * SIZE; i += 1) {
          if (stage[i] !== 0 && this.views[i]) this.setViewValue(i, stage[i])
        }
        await this.delay(170)
        // 3d. 连击提示
        this.showCombo(chain.index)
        this.floatScore(result.placed, chain.score)
      }
    }

    // 4. 结算本回合
    this.score += result.scoreGain
    this.updateScoreHud()
    if (result.merges.length > 0) this.floatScore(result.placed, result.merges.reduce((s, m) => s + m.score, 0))
    if (result.chains.length > 0) {
      this.maxCombo = Math.max(this.maxCombo, result.chains.length)
      this.emptyTurn = 0
    } else {
      this.emptyTurn += 1
      if (this.emptyTurn >= 3) this.comboText.setText('')
    }

    this.busy = false
    if (result.dead) {
      this.time.delayedCall(650, () => this.endGame())
    } else if (this.picked < 0) {
      // 无拾取时不动作；有则保持（空位高亮仍有效）
    }
  }

  private endGame(): void {
    if (this.over) return
    this.over = true
    const duration = Date.now() - this.startTime
    const prevBest = loadBest()
    const isNew = this.score > prevBest
    if (isNew) saveBest(this.score)
    pushRecent({ score: this.score, maxCombo: this.maxCombo, date: Date.now() })
    sfx.gameOver()
    const data: OverData = {
      score: this.score,
      best: Math.max(prevBest, this.score),
      isNew,
      maxCombo: this.maxCombo,
      merges: this.mergeTotal,
      clears: this.clearTotal,
      duration,
    }
    this.time.delayedCall(950, () => this.scene.start('over', data))
    if (isNew) this.time.delayedCall(500, () => sfx.record())
  }

  // ── 视图工具 ────────────────────────────────────────────

  private makeTileView(value: number): TileView {
    const cont = this.add.container(0, 0)
    const img = this.add.image(0, 0, `tile-${value}`)
    const fontSize = value >= 128 ? 17 : value >= 16 ? 21 : 25
    const txt = this.add
      .text(0, 0, String(value), {
        fontFamily: FONT,
        fontSize: `${fontSize}px`,
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setShadow(0, 1, 'rgba(0,0,0,0.55)', 3)
    cont.add([img, txt])
    return { cont, txt }
  }

  private setView(cell: number, value: number): TileView {
    const v = this.makeTileView(value)
    v.cont.setPosition(cellX(cell % SIZE), cellY(Math.floor(cell / SIZE)))
    this.views[cell] = v
    return v
  }

  private setViewValue(cell: number, value: number): void {
    const v = this.views[cell]
    if (!v) return
    // 数字位数变化时更新纹理与字号
    const key = `tile-${value}`
    const img = v.cont.list[0] as Phaser.GameObjects.Image
    if (img.texture.key !== key) img.setTexture(key)
    v.txt.setText(String(value))
    v.txt.setFontSize(value >= 128 ? 17 : value >= 16 ? 21 : 25)
  }

  private updateScoreHud(): void {
    this.scoreText.setText(String(this.score))
    if (this.score > this.best) {
      this.best = this.score
      this.bestText.setText(String(this.best))
      this.bestText.setColor('#7dff9b')
    }
  }

  /** 垂直上浮分数提示 */
  private floatScore(cell: number, amount: number): void {
    if (amount <= 0) return
    const x = cellX(cell % SIZE)
    const y = cellY(Math.floor(cell / SIZE)) - 26
    const t = this.add
      .text(x, y, `+${amount}`, { fontFamily: FONT, fontSize: '20px', fontStyle: 'bold', color: '#ffd166' })
      .setOrigin(0.5)
      .setDepth(50)
      .setShadow(0, 1, 'rgba(0,0,0,0.6)', 3)
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => t.destroy() })
  }

  private showCombo(n: number): void {
    if (n < 2) return
    this.comboText.setText(`连击 ×${n}`)
    this.comboText.setScale(1.6)
    this.tweens.add({ targets: this.comboText, scale: 1, duration: 160, ease: 'Back.easeOut' })
    // 连击段数越高，提示越醒目
    this.comboText.setColor(n >= 4 ? '#ff9f43' : '#ffd166')
  }

  /** 消除粒子：四射星尘 + 光晕 */
  private burst(x: number, y: number, value: number): void {
    const colors = [0x8ad8ff, 0xffd166, 0xb04ae0]
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2 + Math.random() * 0.6
      const dist = 20 + Math.random() * 26
      const p = this.add.image(x, y, 'spark').setScale(0.5 + Math.random() * 0.6).setTint(colors[i % 3])
      this.tweens.add({
        targets: p,
        x: x + Math.cos(a) * dist,
        y: y + Math.sin(a) * dist,
        alpha: 0,
        scale: 0.1,
        duration: 320 + Math.random() * 180,
        ease: 'Cubic.easeOut',
        onComplete: () => p.destroy(),
      })
    }
    const glow = this.add.image(x, y, 'glow').setScale(0.5).setTint(0x8ad8ff).setAlpha(0.8)
    this.tweens.add({ targets: glow, scale: 1.1, alpha: 0, duration: 300, onComplete: () => glow.destroy() })
  }

  /** 无效位置红闪提示 */
  private flashInvalid(cell: number): void {
    const x = cellX(cell % SIZE)
    const y = cellY(Math.floor(cell / SIZE))
    const r = this.add.rectangle(x, y, CELL, CELL, COLOR.warn, 0.45)
    this.tweens.add({ targets: r, alpha: 0, duration: 260, onComplete: () => r.destroy() })
    sfx.invalid()
  }

  private anim(
    target: unknown,
    props: Record<string, unknown> & { onComplete?: () => void },
  ): Promise<void> {
    return new Promise((resolve) => {
      const userCb = props.onComplete
      this.tweens.add({
        targets: target as object,
        ...props,
        onComplete: () => {
          if (userCb) userCb()
          resolve()
        },
      })
    })
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, () => resolve()))
  }

  // ── 暂停 ────────────────────────────────────────────────

  private togglePause(): void {
    if (this.over) return
    if (this.paused) {
      this.paused = false
      this.tweens.resumeAll()
      this.time.paused = false
      if (this.pausePanel) {
        this.pausePanel.destroy()
        this.pausePanel = null
      }
    } else {
      this.cancelPick()
      this.paused = true
      this.tweens.pauseAll()
      this.time.paused = true
      this.showPausePanel()
    }
  }

  private showPausePanel(): void {
    const c = this.add.container(0, 0).setDepth(200)
    const mask = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.6)
    const panel = this.add.container(GAME_W / 2, GAME_H / 2)
    const bg = this.add.rectangle(0, 0, 360, 300, 0x161d45, 0.98).setStrokeStyle(2, 0x4a5aa8, 1)
    const title = this.add
      .text(0, -104, '已暂停', { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: '#eaf0ff' })
      .setOrigin(0.5)
    panel.add([bg, title])
    const mk = (y: number, label: string, cb: () => void): void => {
      const r = this.add
        .rectangle(0, y, 260, 52, 0x232c5c, 1)
        .setStrokeStyle(2, 0x4a5aa8, 0.9)
        .setInteractive({ useHandCursor: true })
      const t = this.add.text(0, y, label, { fontFamily: FONT, fontSize: '20px', color: '#eaf0ff' }).setOrigin(0.5)
      r.on('pointerover', () => r.setFillStyle(0x2d3a78, 1))
      r.on('pointerout', () => r.setFillStyle(0x232c5c, 1))
      r.on('pointerdown', () => {
        sfx.click()
        cb()
      })
      panel.add([r, t])
    }
    mk(-30, '继续游戏', () => this.togglePause())
    mk(36, '重新开始', () => {
      this.togglePause()
      this.scene.restart()
    })
    mk(102, '返回主页', () => {
      this.togglePause()
      this.scene.start('menu')
    })
    c.add([mask, panel])
    this.pausePanel = c
  }

  // ── 新手引导（A-13：≤3 步可跳过）──────────────────────────

  private showTutorial(): void {
    const steps = [
      { title: '拿起方块', body: '点击或拖动下方待放区的方块，然后点击棋盘上的空格放下。' },
      { title: '相同相邻 · 合成', body: '放下的数字若与上下左右相同，会合并翻倍（2+2→4→8…），链式合成得分更高。' },
      { title: '三连消除', body: '一行或一列出现 3 个及以上相同数字即消除，上方方块下落，可触发连锁！' },
    ]
    let idx = 0
    const c = this.add.container(0, 0).setDepth(300)
    const mask = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.72).setInteractive()
    const panel = this.add.container(GAME_W / 2, GAME_H / 2)
    const bg = this.add.rectangle(0, 0, 560, 320, 0x161d45, 0.98).setStrokeStyle(2, 0x4a5aa8, 1)
    panel.add(bg)
    const title = this.add
      .text(0, -102, '', { fontFamily: FONT, fontSize: '28px', fontStyle: 'bold', color: '#8ad8ff' })
      .setOrigin(0.5)
    const body = this.add
      .text(0, -20, '', {
        fontFamily: FONT,
        fontSize: '19px',
        color: '#c3cbf2',
        align: 'center',
        wordWrap: { width: 480 },
        lineSpacing: 8,
      })
      .setOrigin(0.5)
    const next = this.add
      .rectangle(0, 100, 200, 50, 0x3b2d8f, 1)
      .setStrokeStyle(2, 0x7d6bff, 1)
      .setInteractive({ useHandCursor: true })
    const nextTxt = this.add.text(0, 100, '', { fontFamily: FONT, fontSize: '19px', color: '#eaf0ff' }).setOrigin(0.5)
    const skip = this.add
      .text(0, 138, '', { fontFamily: FONT, fontSize: '15px', color: '#5f6ba0' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    panel.add([title, body, next, nextTxt, skip])
    c.add([mask, panel])

    const render = (): void => {
      const s = steps[idx]
      title.setText(`第 ${idx + 1} 步 · ${s.title}`)
      body.setText(s.body)
      nextTxt.setText(idx < steps.length - 1 ? '下一步' : '开始游戏')
      skip.setText('跳过')
    }
    const finish = (): void => {
      storeSet(STORE.tutorial, '1')
      c.destroy()
    }
    next.on('pointerover', () => next.setFillStyle(0x4d3db8, 1))
    next.on('pointerout', () => next.setFillStyle(0x3b2d8f, 1))
    next.on('pointerdown', () => {
      sfx.click()
      if (idx < steps.length - 1) {
        idx += 1
        render()
      } else {
        finish()
      }
    })
    skip.on('pointerdown', () => {
      sfx.click()
      finish()
    })
    render()
  }
}