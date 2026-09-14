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
const FOOD_R = 9.5
const STAR_COUNT = 26

const BEST_KEY = 'neon-snake:best'
const RESTART_LOCK_MS = 420

const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

const COLOR = {
  checker: 0x0f1626,
  grid: 0x1b2233,
  frame: 0x252c3d,
  outline: 0x0b0d12,
  head: 0x4cc9f0,
  tail: 0x7b61ff,
  food: 0xff4f9a,
  foodGlow: 0xff4f9a,
  star: 0x4c8fd6,
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min)

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

type Star = {
  node: Phaser.GameObjects.Rectangle
  speed: number
  phase: number
}

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
  private snakeGfx!: Phaser.GameObjects.Graphics
  private foodContainer!: Phaser.GameObjects.Container
  private foodStar!: Phaser.GameObjects.Graphics
  private scoreText!: Phaser.GameObjects.Text
  private bestText!: Phaser.GameObjects.Text
  private overlay!: Phaser.GameObjects.Container
  private overlayTitle!: Phaser.GameObjects.Text
  private overlayDetail!: Phaser.GameObjects.Text
  private overlayHint!: Phaser.GameObjects.Text

  private readonly stars: Star[] = []
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

    this.buildBackground()
    this.buildStars()
    this.buildBoard()
    this.buildSnake()
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

  update(time: number, delta: number): void {
    this.updateStars(time)
    this.updateFoodFx(time)
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

  private buildBackground(): void {
    // 一张 Canvas 纹理：竖向渐变 + 中心淡光 + 四周暗角
    const tex = this.textures.createCanvas('bg', GAME_W, GAME_H)
    if (tex) {
      const ctx = tex.getContext()
      const grad = ctx.createLinearGradient(0, 0, 0, GAME_H)
      grad.addColorStop(0, '#0e1526')
      grad.addColorStop(0.55, '#0a0e1a')
      grad.addColorStop(1, '#070910')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, GAME_W, GAME_H)

      const glow = ctx.createRadialGradient(
        GAME_W / 2, GAME_H / 2, 60,
        GAME_W / 2, GAME_H / 2, 520,
      )
      glow.addColorStop(0, 'rgba(76, 201, 240, 0.055)')
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, GAME_W, GAME_H)

      const vig = ctx.createRadialGradient(
        GAME_W / 2, GAME_H / 2, 190,
        GAME_W / 2, GAME_H / 2, 660,
      )
      vig.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vig.addColorStop(1, 'rgba(0, 0, 0, 0.42)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, GAME_W, GAME_H)

      tex.refresh()
    }
    this.add.image(0, 0, 'bg').setOrigin(0).setDepth(0)
  }

  private buildStars(): void {
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const size = randInt(1, 2)
      const node = this.add
        .rectangle(rand(0, GAME_W), rand(0, GAME_H), size, size, COLOR.star, 0)
        .setDepth(1)
      this.stars.push({ node, speed: rand(0.6, 1.8), phase: Math.random() * Math.PI * 2 })
    }
  }

  private updateStars(time: number): void {
    for (const s of this.stars) {
      const t = (time / 1000) * s.speed + s.phase
      s.node.setAlpha(0.1 + 0.24 * (0.5 + 0.5 * Math.sin(t)))
    }
  }

  private buildBoard(): void {
    const g = this.add.graphics().setDepth(2)
    // 2×2 棋盘格，画在渐变之上产生"板面"感
    g.fillStyle(COLOR.checker, 0.5)
    for (let cy = 0; cy < ROWS; cy += 2) {
      for (let cx = 0; cx < COLS; cx += 2) {
        if (((cx + cy) / 2) % 2 === 0) {
          g.fillRect(cx * GRID, cy * GRID, GRID * 2, GRID * 2)
        }
      }
    }
    // 细网格线
    g.lineStyle(1, COLOR.grid, 0.5)
    for (let c = 1; c < COLS; c += 1) {
      g.lineBetween(c * GRID, 0, c * GRID, GAME_H)
    }
    for (let r = 1; r < ROWS; r += 1) {
      g.lineBetween(0, r * GRID, GAME_W, r * GRID)
    }
    // 外框：内层微光 + 实线
    g.lineStyle(1, COLOR.head, 0.18)
    g.strokeRect(3, 3, GAME_W - 6, GAME_H - 6)
    g.lineStyle(2, COLOR.frame, 1)
    g.strokeRect(1, 1, GAME_W - 2, GAME_H - 2)
  }

  private buildSnake(): void {
    this.snakeGfx = this.add.graphics().setDepth(8)
  }

  private buildFood(): void {
    // 发光宝珠：光晕 + 半透明环 + 主体 + 高光 + 旋转星芒
    this.foodContainer = this.add.container(0, 0).setDepth(6).setVisible(false)
    const glow = this.add.circle(0, 0, GRID * 0.78, COLOR.foodGlow, 0.15)
    const halo = this.add.circle(0, 0, FOOD_R + 6, COLOR.food, 0.2)
    const orb = this.add.circle(0, 0, FOOD_R, COLOR.food, 1)
    const core = this.add.circle(-FOOD_R * 0.36, -FOOD_R * 0.4, FOOD_R * 0.34, 0xffffff, 0.9)
    this.foodStar = this.add.graphics()
    this.foodStar.lineStyle(2, 0xffffff, 0.38)
    this.foodStar.lineBetween(-18, 0, -12, 0)
    this.foodStar.lineBetween(12, 0, 18, 0)
    this.foodStar.lineBetween(0, -18, 0, -12)
    this.foodStar.lineBetween(0, 12, 0, 18)
    this.foodContainer.add([glow, halo, orb, core, this.foodStar])
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
    this.snakeGfx.setAlpha(1)

    this.overlay.setVisible(false)
    this.phase = 'playing'
  }

  private playerAlpha(alpha: number): void {
    this.snakeGfx.setAlpha(alpha)
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
    // 蛇身占棋盘过半时，随机采样大概率命中蛇身，直接全盘扫描
    let cell: Cell | undefined
    if (this.snake.length * 2 <= COLS * ROWS) {
      for (let i = 0; i < 512 && !cell; i += 1) {
        const x = randInt(0, COLS - 1)
        const y = randInt(0, ROWS - 1)
        if (!this.isOnSnake(x, y)) cell = { x, y }
      }
    }
    cell ??= this.pickFreeCell()
    if (!cell) {
      this.endRun('win')
      return
    }
    this.food = cell
    this.setFoodPosition()
  }

  // 全盘扫描随机返回一个空位，棋盘已满返回 undefined
  private pickFreeCell(): Cell | undefined {
    const free: Cell[] = []
    for (let cy = 0; cy < ROWS; cy += 1) {
      for (let cx = 0; cx < COLS; cx += 1) {
        if (!this.isOnSnake(cx, cy)) free.push({ x: cx, y: cy })
      }
    }
    if (free.length === 0) return undefined
    return free[Math.floor(Math.random() * free.length)]!
  }

  private setFoodPosition(): void {
    const px = (this.food.x + 0.5) * GRID
    const py = (this.food.y + 0.5) * GRID
    this.foodContainer.setPosition(px, py).setScale(1).setAlpha(1).setVisible(true)
  }

  // 呼吸 + 星芒旋转，由 update 驱动（与暂停状态无关，纯视觉）
  private updateFoodFx(time: number): void {
    if (!this.foodContainer.visible) return
    this.foodContainer.setScale(1 + Math.sin(time / 200) * 0.08)
    this.foodStar.rotation = (time / 2600) * Math.PI * 2
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
    const g = this.snakeGfx
    g.clear()

    // 环绕展开：从头出发按相邻单元格差计算屏幕坐标，穿墙时蛇身保持连续不撕裂
    const len = this.snake.length
    const pts: { x: number; y: number }[] = []
    let sx = 0
    let sy = 0
    this.snake.forEach((cell, i) => {
      if (i === 0) {
        sx = (cell.x + 0.5) * GRID
        sy = (cell.y + 0.5) * GRID
      } else {
        const prev = this.snake[i - 1] as Cell
        let offX = cell.x - prev.x
        let offY = cell.y - prev.y
        if (offX > 1) offX -= COLS
        if (offX < -1) offX += COLS
        if (offY > 1) offY -= ROWS
        if (offY < -1) offY += ROWS
        sx += offX * GRID
        sy += offY * GRID
      }
      pts.push({ x: sx, y: sy })
    })

    // 身体：从尾画到第二节，圆角矩形 + 深色描边，尾部渐细
    for (let i = len - 1; i >= 1; i -= 1) {
      const p = pts[i] as { x: number; y: number }
      const taper = Math.max(0, i - (len - 4)) * 2.5
      const size = GRID - 5 - taper
      const color = this.segmentColor(i, len)
      g.fillStyle(color, 1)
      g.fillRoundedRect(p.x - size / 2, p.y - size / 2, size, size, 8)
      g.lineStyle(1.5, COLOR.outline, 0.3)
      g.strokeRoundedRect(p.x - size / 2, p.y - size / 2, size, size, 8)
    }

    // 头部：光晕 + 圆头 + 高光 + 朝移动方向的眼睛
    const head = pts[0] as { x: number; y: number }
    g.fillStyle(COLOR.head, 0.1)
    g.fillCircle(head.x, head.y, GRID * 0.95)
    g.fillStyle(COLOR.head, 1)
    g.fillCircle(head.x, head.y, GRID / 2 - 3)
    g.fillStyle(0xffffff, 0.26)
    g.fillCircle(head.x - 4, head.y - 4.5, 4.5)

    const dv = DIR_VEC[this.dir]
    const px = -dv.y
    const py = dv.x
    for (const side of [-1, 1] as const) {
      const ex = head.x + dv.x * 6 + px * 7.5 * side
      const ey = head.y + dv.y * 6 + py * 7.5 * side
      g.fillStyle(0xffffff, 1)
      g.fillCircle(ex, ey, 4.6)
      g.fillStyle(COLOR.outline, 1)
      g.fillCircle(ex + dv.x * 1.8, ey + dv.y * 1.8, 2.3)
    }
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