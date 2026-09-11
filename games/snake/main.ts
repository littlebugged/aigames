import Phaser from 'phaser'

const GAME_W = 960
const GAME_H = 540
const GRID = 30
const COLS = GAME_W / GRID
const ROWS = GAME_H / GRID

const TICK_MS_START = 130
const TICK_MS_MIN = 78
const TICK_MS_STEP = 4

const START_LEN = 3
const SWIPE_THRESHOLD = 24
const FOOD_GLOW_SIZE = 40
const FOOD_SIZE = 18

const BEST_KEY = 'neon-snake:best'
const RESTART_LOCK_MS = 420

const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

const COLOR = {
  grid: 0x161c2b,
  frame: 0x252c3d,
  head: 0x4cc9f0,
  tail: 0x7b61ff,
  food: 0xff4f9a,
  foodGlow: 0xff4f9a,
}

const DIR_VEC: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

const randInt = (min: number, max: number): number =>
  Math.floor(min + Math.random() * (max - min + 1))

type Dir = 'up' | 'down' | 'left' | 'right'
type Phase = 'idle' | 'playing' | 'over'

type Cell = { x: number; y: number }

type Debris = {
  node: Phaser.GameObjects.Rectangle
  vx: number
  vy: number
  life: number
  maxLife: number
}

class Sfx {
  private ctx: AudioContext | null = null

  private ensure(): AudioContext | null {
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

  eat(): void {
    this.tone(660, 880, 0.08, 'square', 0.09)
    this.tone(990, 1320, 0.1, 'square', 0.07, 0.06)
  }

  hit(): void {
    this.tone(300, 60, 0.3, 'sawtooth', 0.14)
  }

  win(): void {
    this.tone(440, 440, 0.12, 'square', 0.1)
    this.tone(660, 660, 0.12, 'square', 0.1, 0.1)
    this.tone(880, 880, 0.18, 'square', 0.1, 0.2)
  }
}

class SnakeScene extends Phaser.Scene {
  private headGlow!: Phaser.GameObjects.Rectangle
  private foodNode!: Phaser.GameObjects.Rectangle
  private foodGlow!: Phaser.GameObjects.Rectangle
  private scoreText!: Phaser.GameObjects.Text
  private bestText!: Phaser.GameObjects.Text
  private overlay!: Phaser.GameObjects.Container
  private overlayTitle!: Phaser.GameObjects.Text
  private overlayDetail!: Phaser.GameObjects.Text
  private overlayHint!: Phaser.GameObjects.Text

  private readonly segmentNodes: Phaser.GameObjects.Rectangle[] = []
  private readonly debris: Debris[] = []
  private readonly sfx = new Sfx()

  private phase: Phase = 'idle'
  private paused = false
  private snake: Cell[] = []
  private dir: Dir = 'right'
  private dirQueue: Dir[] = []
  private food: Cell = { x: 0, y: 0 }

  private score = 0
  private best = 0
  private tickMs = TICK_MS_START
  private accum = 0
  private scorePulse = 0
  private overAt = 0
  private swipeStart: { x: number; y: number } | null = null

  constructor() {
    super('snake')
  }

  create(): void {
    this.best = this.readBest()

    this.buildBoard()
    this.buildHeadGlow()
    this.buildFood()
    this.buildHud()
    this.buildOverlay()

    this.input.keyboard?.addCapture('SPACE,UP,DOWN,LEFT,RIGHT,W,A,S,D,P')
    this.input.keyboard?.on('keydown-SPACE', this.onAction, this)
    this.input.keyboard?.on('keydown-P', this.togglePause, this)
    this.input.keyboard?.on('keydown-UP', () => this.queueDir('up'), this)
    this.input.keyboard?.on('keydown-DOWN', () => this.queueDir('down'), this)
    this.input.keyboard?.on('keydown-LEFT', () => this.queueDir('left'), this)
    this.input.keyboard?.on('keydown-RIGHT', () => this.queueDir('right'), this)
    this.input.keyboard?.on('keydown-W', () => this.queueDir('up'), this)
    this.input.keyboard?.on('keydown-S', () => this.queueDir('down'), this)
    this.input.keyboard?.on('keydown-A', () => this.queueDir('left'), this)
    this.input.keyboard?.on('keydown-D', () => this.queueDir('right'), this)
    this.input.on('pointerdown', this.onPointerDown, this)
    this.input.on('pointerup', this.onPointerUp, this)

    this.showIdle()
  }

  update(_time: number, delta: number): void {
    this.updateScorePulse(delta)
    this.updateDebris(delta)

    if (this.phase !== 'playing' || this.paused) return

    this.accum += delta
    while (this.accum >= this.tickMs) {
      this.accum -= this.tickMs
      this.tick()
      if (this.phase !== 'playing') return
    }
  }

  private buildBoard(): void {
    // 网格线 + 外框，静态画一次
    const g = this.add.graphics()
    g.lineStyle(1, COLOR.grid, 0.6)
    for (let c = 1; c < COLS; c += 1) {
      g.lineBetween(c * GRID, 0, c * GRID, GAME_H)
    }
    for (let r = 1; r < ROWS; r += 1) {
      g.lineBetween(0, r * GRID, GAME_W, r * GRID)
    }
    g.lineStyle(2, COLOR.frame, 1)
    g.strokeRect(1, 1, GAME_W - 2, GAME_H - 2)
  }

  private buildHeadGlow(): void {
    this.headGlow = this.add
      .rectangle(0, 0, GRID + 2, GRID + 2, COLOR.head, 0.16)
      .setDepth(7)
      .setVisible(false)
  }

  private buildFood(): void {
    this.foodGlow = this.add
      .rectangle(0, 0, FOOD_GLOW_SIZE, FOOD_GLOW_SIZE, COLOR.foodGlow, 0.18)
      .setDepth(5)
    this.foodNode = this.add.rectangle(0, 0, FOOD_SIZE, FOOD_SIZE, COLOR.food, 1).setDepth(6)
  }

  private buildHud(): void {
    this.scoreText = this.add
      .text(30, 22, '0', { fontFamily: FONT, fontSize: '42px', color: '#e9edf6' })
      .setDepth(20)
    this.bestText = this.add
      .text(GAME_W - 30, 34, `BEST ${this.best}`, {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#8b95ab',
      })
      .setOrigin(1, 0)
      .setDepth(20)
  }

  private buildOverlay(): void {
    this.overlay = this.add.container(0, 0).setDepth(50)

    this.overlayTitle = this.add
      .text(GAME_W / 2, 186, '', { fontFamily: FONT, fontSize: '54px', color: '#e9edf6' })
      .setOrigin(0.5)
    this.overlayDetail = this.add
      .text(GAME_W / 2, 256, '', { fontFamily: FONT, fontSize: '18px', color: '#8b95ab' })
      .setOrigin(0.5)
    this.overlayHint = this.add
      .text(GAME_W / 2, 312, '', { fontFamily: FONT, fontSize: '16px', color: '#4cc9f0' })
      .setOrigin(0.5)

    this.overlay.add([this.overlayTitle, this.overlayDetail, this.overlayHint])
  }

  private showIdle(): void {
    this.overlayTitle.setText('NEON SNAKE')
    this.overlayDetail.setText('无墙模式：穿墙从对面出来，吃光点变长')
    this.overlayHint.setText('方向键 / WASD 控制，点击屏幕开始')
    this.overlay.setVisible(true)
  }

  private showOver(reason: 'self' | 'win'): void {
    const title = reason === 'win' ? '通关了！' : '咬到自己了'
    this.overlayTitle.setText(title)
    this.overlayDetail.setText(`本次得分 ${this.score}　·　最高分 ${this.best}`)
    this.overlayHint.setText('点击屏幕 / 空格 再来一次')
    this.overlay.setVisible(true)
  }

  private onAction(): void {
    if (this.phase === 'idle') {
      this.startRun()
      return
    }
    if (this.phase === 'over') {
      if (this.time.now - this.overAt < RESTART_LOCK_MS) return
      this.startRun()
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.phase === 'idle' || this.phase === 'over') {
      this.onAction()
      return
    }
    if (this.paused) {
      this.togglePause()
      return
    }
    this.swipeStart = { x: pointer.x, y: pointer.y }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.phase !== 'playing' || !this.swipeStart) return
    const dx = pointer.x - this.swipeStart.x
    const dy = pointer.y - this.swipeStart.y
    this.swipeStart = null
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return
    if (Math.abs(dx) > Math.abs(dy)) {
      this.queueDir(dx > 0 ? 'right' : 'left')
    } else {
      this.queueDir(dy > 0 ? 'down' : 'up')
    }
  }

  private togglePause(): void {
    if (this.phase !== 'playing') return
    this.paused = !this.paused
    this.overlayTitle.setText(this.paused ? '已暂停' : '')
    this.overlayDetail.setText(this.paused ? '按 P 或点击屏幕继续' : '')
    this.overlayHint.setText('')
    this.overlay.setVisible(this.paused)
  }

  private queueDir(dir: Dir): void {
    if (this.phase !== 'playing' || this.paused) return
    const last = this.dirQueue.length > 0 ? (this.dirQueue[this.dirQueue.length - 1] as Dir) : this.dir
    if (dir === last || dir === OPPOSITE[last]) return
    if (this.dirQueue.length >= 3) return
    this.dirQueue.push(dir)
  }

  private startRun(): void {
    this.clearDebris()
    this.sfx.warm()

    this.snake = []
    const startX = Math.floor(COLS / 2) - 2
    const startY = Math.floor(ROWS / 2)
    // 头在最前（初始朝右），身体依次排在身后
    for (let i = 0; i < START_LEN; i += 1) {
      this.snake.push({ x: startX - i, y: startY })
    }
    this.dir = 'right'
    this.dirQueue = []

    this.score = 0
    this.tickMs = TICK_MS_START
    this.accum = 0
    this.scorePulse = 0
    this.paused = false

    this.renderSnake()
    this.spawnFood()
    this.scoreText.setText('0').setScale(1)
    this.headGlow.setVisible(true)
    this.playerAlpha(1)

    this.overlay.setVisible(false)
    this.phase = 'playing'
  }

  private playerAlpha(alpha: number): void {
    for (const node of this.segmentNodes) {
      node.setAlpha(alpha)
    }
    this.headGlow.setAlpha(alpha * 0.16)
  }

  private tick(): void {
    const next = this.dirQueue.shift()
    if (next) this.dir = next

    const head = this.snake[0] as Cell
    // 无墙模式：出界从另一侧穿回
    const nx = (head.x + DIR_VEC[this.dir].x + COLS) % COLS
    const ny = (head.y + DIR_VEC[this.dir].y + ROWS) % ROWS

    // 撞自己：尾部本 tick 会让位，故只查 [0, len-2]；吃到食物时尾部不动，查全
    const eating = nx === this.food.x && ny === this.food.y
    const bodyLen = eating ? this.snake.length : this.snake.length - 1
    for (let i = 0; i < bodyLen; i += 1) {
      const part = this.snake[i] as Cell
      if (part.x === nx && part.y === ny) {
        this.endRun('self')
        return
      }
    }

    this.snake.unshift({ x: nx, y: ny })
    if (eating) {
      this.onEat()
    } else {
      this.snake.pop()
    }
    this.renderSnake()
  }

  private onEat(): void {
    this.score += 1
    this.scoreText.setText(String(this.score))
    this.scorePulse = 1
    this.tickMs = Math.max(TICK_MS_MIN, this.tickMs - TICK_MS_STEP)
    this.sfx.eat()
    this.spawnFood()
  }

  private spawnFood(): void {
    // 拒绝采样，命中太差时全盘扫描兜底
    let x = 0
    let y = 0
    let found = false
    for (let i = 0; i < 512 && !found; i += 1) {
      x = randInt(0, COLS - 1)
      y = randInt(0, ROWS - 1)
      found = !this.isOnSnake(x, y)
    }
    if (!found) {
      const free: Cell[] = []
      for (let cy = 0; cy < ROWS; cy += 1) {
        for (let cx = 0; cx < COLS; cx += 1) {
          if (!this.isOnSnake(cx, cy)) free.push({ x: cx, y: cy })
        }
      }
      if (free.length === 0) {
        this.endRun('win')
        return
      }
      const cell = free[Math.floor(Math.random() * free.length)]
      x = cell!.x
      y = cell!.y
    }
    this.food = { x, y }
    this.setFoodPosition()
  }

  private setFoodPosition(): void {
    const px = (this.food.x + 0.5) * GRID
    const py = (this.food.y + 0.5) * GRID
    this.foodNode.setPosition(px, py).setScale(1)
    this.foodGlow.setPosition(px, py).setScale(1)
    // 呼吸脉冲
    this.tweens.killTweensOf([this.foodNode, this.foodGlow])
    this.tweens.add({
      targets: [this.foodNode, this.foodGlow],
      scale: 1.22,
      duration: 450,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inout',
    })
  }

  private isOnSnake(x: number, y: number): boolean {
    return this.snake.some((s) => s.x === x && s.y === y)
  }

  private segmentColor(index: number, len: number): number {
    if (index === 0) return COLOR.head
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(COLOR.head),
      Phaser.Display.Color.ValueToColor(COLOR.tail),
      Math.max(1, len - 1),
      index,
    )
    return Phaser.Display.Color.GetColor(c.r, c.g, c.b)
  }

  private renderSnake(): void {
    // 按当前蛇长补齐 / 裁剪可见节
    while (this.segmentNodes.length < this.snake.length) {
      const node = this.add
        .rectangle(0, 0, GRID - 4, GRID - 4, COLOR.head)
        .setOrigin(0.5)
        .setDepth(8)
      this.segmentNodes.push(node)
    }
    while (this.segmentNodes.length > this.snake.length) {
      this.segmentNodes.pop()?.destroy()
    }

    // 环绕展开：从头出发按相邻单元格差渲染，穿墙时蛇身保持连续不撕裂
    let screenX = 0
    let screenY = 0
    this.snake.forEach((cell, i) => {
      const node = this.segmentNodes[i]
      if (!node) return
      if (i === 0) {
        screenX = (cell.x + 0.5) * GRID
        screenY = (cell.y + 0.5) * GRID
      } else {
        const prev = this.snake[i - 1] as Cell
        let offX = cell.x - prev.x
        let offY = cell.y - prev.y
        if (offX > 1) offX -= COLS
        if (offX < -1) offX += COLS
        if (offY > 1) offY -= ROWS
        if (offY < -1) offY += ROWS
        screenX += offX * GRID
        screenY += offY * GRID
      }
      node
        .setPosition(screenX, screenY)
        .setFillStyle(this.segmentColor(i, this.snake.length))
    })

    // 蛇头光晕跟随（头永远在画布内）
    const head = this.snake[0] as Cell
    this.headGlow.setPosition((head.x + 0.5) * GRID, (head.y + 0.5) * GRID)
  }

  private updateScorePulse(delta: number): void {
    const dt = Math.min(delta, 50) / 1000
    if (this.scorePulse <= 0) return
    this.scorePulse = Math.max(0, this.scorePulse - dt * 6)
    this.scoreText.setScale(1 + this.scorePulse * 0.18)
  }

  private updateDebris(delta: number): void {
    const dt = Math.min(delta, 50) / 1000
    for (let i = this.debris.length - 1; i >= 0; i -= 1) {
      const d = this.debris[i] as Debris
      d.life += dt
      d.vy += 900 * dt
      d.node.x += d.vx * dt
      d.node.y += d.vy * dt
      d.node.setAlpha(Math.max(0, 1 - d.life / d.maxLife))
      if (d.life >= d.maxLife) {
        d.node.destroy()
        this.debris.splice(i, 1)
      }
    }
  }

  private burstDebris(
    x: number,
    y: number,
    color: number,
    count: number,
    speedMin: number,
    speedMax: number,
  ): void {
    for (let i = 0; i < count; i += 1) {
      const size = randInt(2, 5)
      const node = this.add.rectangle(x, y, size, size, color).setDepth(8)
      const angle = Math.random() * Math.PI * 2
      const speed = speedMin + Math.random() * (speedMax - speedMin)
      this.debris.push({
        node,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: 0,
        maxLife: 0.25 + Math.random() * 0.3,
      })
    }
  }

  private clearDebris(): void {
    for (const d of this.debris) {
      d.node.destroy()
    }
    this.debris.length = 0
  }

  private endRun(reason: 'self' | 'win'): void {
    this.phase = 'over'
    this.overAt = this.time.now
    this.paused = false
    this.tweens.killTweensOf([this.foodNode, this.foodGlow])

    if (this.score > this.best) {
      this.best = this.score
      this.writeBest(this.best)
    }
    this.bestText.setText(`BEST ${this.best}`)

    const head = this.snake[0] as Cell
    const px = (head.x + 0.5) * GRID
    const py = (head.y + 0.5) * GRID
    this.burstDebris(px, py, COLOR.head, 10, 100, 340)
    this.burstDebris(px, py, 0xffffff, 4, 60, 200)
    this.cameras.main.shake(140, 0.008)
    if (reason === 'win') {
      this.sfx.win()
    } else {
      this.sfx.hit()
    }

    this.playerAlpha(0.3)
    this.showOver(reason)
  }

  private readBest(): number {
    try {
      const raw = localStorage.getItem(BEST_KEY)
      if (!raw) return 0
      const value = Number.parseInt(raw, 10)
      return Number.isFinite(value) && value > 0 ? value : 0
    } catch {
      return 0
    }
  }

  private writeBest(value: number): void {
    try {
      localStorage.setItem(BEST_KEY, String(value))
    } catch {
      return
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0b0d12',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [SnakeScene],
})