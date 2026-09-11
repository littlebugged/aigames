import Phaser from 'phaser'

const GAME_W = 960
const GAME_H = 540
const GROUND_TOP = GAME_H - 96

const GRAVITY = 2600
const JUMP_V = -1050

const SPEED_START = 320
const SPEED_MAX = 700
const SPEED_GROWTH = 18
const SPAWN_INTERVAL = 1250

const PLAYER_X = 190
const PLAYER_W = 40
const PLAYER_H = 56

const OBSTACLE_HEIGHTS = [50, 72, 96] as const
const OBSTACLE_WIDTHS = [34, 44] as const

const PIT_WIDTHS = [90, 120, 150] as const
const PIT_CHANCE = 0.3
const PIT_SINK_DEPTH = 30

const BEST_KEY = 'neon-dash:best'
const RESTART_LOCK_MS = 420

const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

const COLOR = {
  bg: 0x0b0d12,
  groundFill: 0x6e5238,
  groundLine: 0x4ade80,
  player: 0x4cc9f0,
  obstacle: 0x7b61ff,
  star: 0x232c44,
  pitFill: 0x05070c,
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min)
const randInt = (min: number, max: number): number => Math.floor(rand(min, max + 1))
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T

type Obstacle = {
  node: Phaser.GameObjects.Rectangle
  glow: Phaser.GameObjects.Rectangle
  x: number
  w: number
  h: number
  scored: boolean
}

type Star = {
  node: Phaser.GameObjects.Rectangle
  factor: number
}

type Pit = {
  node: Phaser.GameObjects.Rectangle
  x: number
  w: number
  scored: boolean
}

type Phase = 'idle' | 'playing' | 'over'

class DashScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle
  private playerGlow!: Phaser.GameObjects.Rectangle
  private scoreText!: Phaser.GameObjects.Text
  private bestText!: Phaser.GameObjects.Text
  private overlay!: Phaser.GameObjects.Container
  private overlayTitle!: Phaser.GameObjects.Text
  private overlayDetail!: Phaser.GameObjects.Text
  private overlayHint!: Phaser.GameObjects.Text

  private readonly obstacles: Obstacle[] = []
  private readonly pits: Pit[] = []
  private readonly stars: Star[] = []

  private phase: Phase = 'idle'
  private playerY = GROUND_TOP - PLAYER_H / 2
  private playerVY = 0
  private onGround = true
  private sunk = false

  private score = 0
  private best = 0
  private speed = SPEED_START
  private elapsed = 0
  private spawnAcc = 0
  private scorePulse = 0
  private overAt = 0
  private deathBy: 'hit' | 'pit' = 'hit'
  private lastWasPit = false

  constructor() {
    super('dash')
  }

  create(): void {
    this.best = this.readBest()

    this.buildBackdrop()
    this.buildGround()
    this.buildPlayer()
    this.buildHud()
    this.buildOverlay()

    this.input.keyboard?.addCapture('SPACE,UP,W')
    this.input.keyboard?.on('keydown-SPACE', this.onAction, this)
    this.input.keyboard?.on('keydown-UP', this.onAction, this)
    this.input.keyboard?.on('keydown-W', this.onAction, this)
    this.input.on('pointerdown', this.onAction, this)

    this.showIdle()
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000

    this.updateBackdrop(dt)
    this.updateScorePulse(dt)

    if (this.phase !== 'playing') return

    this.elapsed += dt
    this.speed = Math.min(SPEED_MAX, SPEED_START + this.elapsed * SPEED_GROWTH)

    this.updatePlayer(dt)
    if (this.phase !== 'playing') return
    this.updateObstacles(dt)
    if (this.phase !== 'playing') return
    this.updatePits(dt)

    this.spawnAcc += delta
    if (this.spawnAcc >= SPAWN_INTERVAL) {
      this.spawnAcc -= SPAWN_INTERVAL
      this.spawnNext()
    }
  }

  private buildBackdrop(): void {
    for (let i = 0; i < 34; i += 1) {
      const size = randInt(2, 4)
      const node = this.add
        .rectangle(
          rand(0, GAME_W),
          rand(40, GROUND_TOP - 40),
          size,
          size,
          COLOR.star,
        )
        .setDepth(1)
      this.stars.push({ node, factor: rand(0.25, 1) })
    }
  }

  private buildGround(): void {
    this.add
      .rectangle(GAME_W / 2, (GROUND_TOP + GAME_H) / 2, GAME_W, GAME_H - GROUND_TOP, COLOR.groundFill)
      .setDepth(2)
    this.add
      .rectangle(GAME_W / 2, GROUND_TOP, GAME_W, 3, COLOR.groundLine, 0.85)
      .setDepth(3)
  }

  private buildPlayer(): void {
    this.playerGlow = this.add
      .rectangle(PLAYER_X, this.playerY, PLAYER_W + 14, PLAYER_H + 14, COLOR.player, 0.16)
      .setDepth(9)
    this.player = this.add
      .rectangle(PLAYER_X, this.playerY, PLAYER_W, PLAYER_H, COLOR.player)
      .setDepth(10)
    this.player.setStrokeStyle(2, 0xffffff, 0.35)
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
    this.overlayTitle.setText('NEON DASH')
    this.overlayDetail.setText('跳过障碍和坑洞，速度会越来越快')
    this.overlayHint.setText('点击屏幕 / 空格 开始')
    this.overlay.setVisible(true)
  }

  private showOver(): void {
    this.overlayTitle.setText(this.deathBy === 'pit' ? '掉坑里了' : '撞上了')
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
      return
    }
    this.tryJump()
  }

  private startRun(): void {
    this.clearObstacles()
    this.clearPits()

    this.score = 0
    this.elapsed = 0
    this.speed = SPEED_START
    this.spawnAcc = 0
    this.scorePulse = 0
    this.lastWasPit = false

    this.playerY = GROUND_TOP - PLAYER_H / 2
    this.playerVY = 0
    this.onGround = true
    this.sunk = false
    this.deathBy = 'hit'
    this.player.y = this.playerY
    this.playerGlow.y = this.playerY
    this.player.setAlpha(1)
    this.playerGlow.setAlpha(0.16)
    this.scoreText.setText('0').setScale(1)

    this.overlay.setVisible(false)
    this.phase = 'playing'
  }

  private tryJump(): void {
    if (!this.onGround) return
    this.playerVY = JUMP_V
    this.onGround = false
  }

  private updatePlayer(dt: number): void {
    this.playerVY += GRAVITY * dt
    this.playerY += this.playerVY * dt

    const floor = GROUND_TOP - PLAYER_H / 2
    const overPit = this.isOverPit(PLAYER_X)
    // 中心已沉到站立高度以下却还在坑上：踩空了，取消地面开始下坠
    if (overPit && this.playerY > floor) this.sunk = true

    if (this.playerY >= floor && !this.sunk) {
      this.playerY = floor
      this.playerVY = 0
      this.onGround = true
    } else {
      this.onGround = false
    }

    // 下沉到一定深度视为掉坑
    if (this.sunk && this.playerY > floor + PIT_SINK_DEPTH) {
      this.endRun('pit')
      return
    }

    this.player.y = this.playerY
    this.playerGlow.y = this.playerY
  }

  private updateObstacles(dt: number): void {
    const playerLeft = PLAYER_X - PLAYER_W / 2 + 5
    const playerRight = PLAYER_X + PLAYER_W / 2 - 5
    const playerTop = this.playerY - PLAYER_H / 2 + 4
    const playerBottom = this.playerY + PLAYER_H / 2

    for (let i = this.obstacles.length - 1; i >= 0; i -= 1) {
      const obstacle = this.obstacles[i] as Obstacle
      obstacle.x -= this.speed * dt
      obstacle.node.x = obstacle.x
      obstacle.glow.x = obstacle.x

      if (obstacle.x + obstacle.w / 2 < -24) {
        obstacle.node.destroy()
        obstacle.glow.destroy()
        this.obstacles.splice(i, 1)
        continue
      }

      if (!obstacle.scored && obstacle.x + obstacle.w / 2 < PLAYER_X - PLAYER_W / 2) {
        obstacle.scored = true
        this.addScore()
      }

      const obstacleLeft = obstacle.x - obstacle.w / 2
      const obstacleRight = obstacle.x + obstacle.w / 2
      const obstacleTop = GROUND_TOP - obstacle.h

      const hitX = playerRight > obstacleLeft && playerLeft < obstacleRight
      const hitY = playerBottom > obstacleTop && playerTop < GROUND_TOP

      if (hitX && hitY) {
        this.endRun()
        return
      }
    }
  }

  private updatePits(dt: number): void {
    for (let i = this.pits.length - 1; i >= 0; i -= 1) {
      const pit = this.pits[i] as Pit
      pit.x -= this.speed * dt
      pit.node.x = pit.x

      if (pit.x + pit.w / 2 < -24) {
        pit.node.destroy()
        this.pits.splice(i, 1)
        continue
      }

      if (!pit.scored && pit.x + pit.w / 2 < PLAYER_X - PLAYER_W / 2) {
        pit.scored = true
        this.addScore()
      }
    }
  }

  private isOverPit(x: number): boolean {
    for (const pit of this.pits) {
      if (x > pit.x - pit.w / 2 && x < pit.x + pit.w / 2) return true
    }
    return false
  }

  private updateBackdrop(dt: number): void {
    const drift = this.phase === 'playing' ? this.speed : 90
    for (const star of this.stars) {
      star.node.x -= drift * star.factor * dt
      if (star.node.x < -6) {
        star.node.x = GAME_W + 6
        star.node.y = rand(40, GROUND_TOP - 40)
      }
    }
  }

  private updateScorePulse(dt: number): void {
    if (this.scorePulse <= 0) return
    this.scorePulse = Math.max(0, this.scorePulse - dt * 6)
    this.scoreText.setScale(1 + this.scorePulse * 0.18)
  }

  private addScore(): void {
    this.score += 1
    this.scoreText.setText(String(this.score))
    this.scorePulse = 1
  }

  private spawnNext(): void {
    const usePit = !this.lastWasPit && Math.random() < PIT_CHANCE
    this.lastWasPit = usePit
    if (usePit) {
      this.spawnPit()
      return
    }
    this.spawnObstacle()
  }

  private spawnPit(): void {
    const w = pick(PIT_WIDTHS)
    const x = GAME_W + w / 2

    const node = this.add
      .rectangle(x, (GROUND_TOP + GAME_H) / 2, w, GAME_H - GROUND_TOP, COLOR.pitFill)
      .setDepth(4)

    this.pits.push({ node, x, w, scored: false })
  }

  private spawnObstacle(): void {
    const h = pick(OBSTACLE_HEIGHTS)
    const w = pick(OBSTACLE_WIDTHS)
    const x = GAME_W + w
    const y = GROUND_TOP - h / 2

    const glow = this.add
      .rectangle(x, y, w + 12, h + 12, COLOR.obstacle, 0.14)
      .setDepth(7)
    const node = this.add.rectangle(x, y, w, h, COLOR.obstacle).setDepth(8)
    node.setStrokeStyle(2, 0xb9a9ff, 0.45)

    this.obstacles.push({ node, glow, x, w, h, scored: false })
  }

  private clearObstacles(): void {
    for (const obstacle of this.obstacles) {
      obstacle.node.destroy()
      obstacle.glow.destroy()
    }
    this.obstacles.length = 0
  }

  private clearPits(): void {
    for (const pit of this.pits) {
      pit.node.destroy()
    }
    this.pits.length = 0
  }

  private endRun(reason: 'hit' | 'pit' = 'hit'): void {
    this.phase = 'over'
    this.deathBy = reason
    this.overAt = this.time.now

    if (this.score > this.best) {
      this.best = this.score
      this.writeBest(this.best)
    }
    this.bestText.setText(`BEST ${this.best}`)

    this.player.setAlpha(0.3)
    this.playerGlow.setAlpha(0.06)

    this.showOver()
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
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [DashScene],
})
