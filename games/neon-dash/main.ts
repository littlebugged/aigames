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

  jump(): void {
    this.tone(330, 660, 0.12, 'square', 0.1)
  }

  score(): void {
    this.tone(988, 988, 0.07, 'square', 0.08)
    this.tone(1319, 1319, 0.1, 'square', 0.08, 0.07)
  }

  hit(): void {
    this.tone(260, 60, 0.3, 'sawtooth', 0.14)
  }

  pit(): void {
    this.tone(380, 50, 0.42, 'sawtooth', 0.14)
  }
}

class DashScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Container
  private playerGlow!: Phaser.GameObjects.Rectangle
  private eyeL!: Phaser.GameObjects.Container
  private eyeR!: Phaser.GameObjects.Container
  private legL!: Phaser.GameObjects.Container
  private legR!: Phaser.GameObjects.Container
  private antennaLight!: Phaser.GameObjects.Arc
  private animT = 0
  private blinkT = 2
  private blinkDur = 0
  private scoreText!: Phaser.GameObjects.Text
  private bestText!: Phaser.GameObjects.Text
  private overlay!: Phaser.GameObjects.Container
  private overlayTitle!: Phaser.GameObjects.Text
  private overlayDetail!: Phaser.GameObjects.Text
  private overlayHint!: Phaser.GameObjects.Text

  private readonly obstacles: Obstacle[] = []
  private readonly pits: Pit[] = []
  private readonly stars: Star[] = []
  private readonly debris: Debris[] = []
  private readonly sfx = new Sfx()

  private phase: Phase = 'idle'
  private playerY = GROUND_TOP - PLAYER_H / 2
  private playerVY = 0
  private onGround = true
  private sunk = false
  private squashX = 1
  private squashY = 1

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
    this.updateSquash(dt)
    this.updateDebris(dt)
    this.updateCharacter(dt)

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

    this.player = this.add.container(PLAYER_X, this.playerY).setDepth(10)

    // 圆脑袋（大头小身比例更可爱）
    const head = this.add.circle(0, -10, 14, COLOR.player)
    head.setStrokeStyle(2, 0xffffff, 0.35)
    // 身体 + 肚皮高光 + 小短手
    const body = this.add.rectangle(0, 9.5, 18, 15, COLOR.player)
    body.setStrokeStyle(2, 0xffffff, 0.2)
    const belly = this.add.rectangle(0, 9.5, 10, 7, 0xffffff, 0.16)
    const armL = this.add.rectangle(-11, 9, 4, 5, 0x2f9ecb)
    const armR = this.add.rectangle(11, 9, 4, 5, 0x2f9ecb)
    // 天线
    const antenna = this.add.rectangle(0, -27, 2.5, 5, 0x2f3a55)
    this.antennaLight = this.add.circle(0, -30, 2.8, 0x7b61ff)
    // 眼睛（眼白 + 右偏瞳孔，眨眼时整体缩放）、腮红、嘴巴
    this.eyeL = this.add.container(-5.5, -11, [
      this.add.circle(0, 0, 4, 0xffffff),
      this.add.circle(1.5, 0, 2.2, 0x0b0d12),
    ])
    this.eyeR = this.add.container(5.5, -11, [
      this.add.circle(0, 0, 4, 0xffffff),
      this.add.circle(1.5, 0, 2.2, 0x0b0d12),
    ])
    const cheekL = this.add.circle(-10, -4, 2, 0xff8f9e, 0.7)
    const cheekR = this.add.circle(10, -4, 2, 0xff8f9e, 0.7)
    const mouth = this.add.rectangle(0, 1.5, 5, 2.2, 0x0b0d12, 0.85)
    // 长腿（细腿 + 前伸脚垫一体，跑步时整条腿摆动）
    this.legL = this.add.container(-5, 0, [
      this.add.rectangle(0, 21, 4, 9, 0x2f9ecb),
      this.add.rectangle(1, 26, 9, 4.5, 0x2f9ecb),
    ])
    this.legR = this.add.container(5, 0, [
      this.add.rectangle(0, 21, 4, 9, 0x2f9ecb),
      this.add.rectangle(1, 26, 9, 4.5, 0x2f9ecb),
    ])

    this.player.add([
      head,
      body,
      belly,
      armL,
      armR,
      antenna,
      this.antennaLight,
      this.eyeL,
      this.eyeR,
      cheekL,
      cheekR,
      mouth,
      this.legL,
      this.legR,
    ])
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
    this.clearDebris()
    this.sfx.warm()

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
    this.squashX = 1
    this.squashY = 1
    this.player.setScale(1, 1)
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
    this.squashX = 0.72
    this.squashY = 1.32
    this.sfx.jump()
  }

  private land(): void {
    this.squashX = 1.3
    this.squashY = 0.68
    this.burstDebris(PLAYER_X, GROUND_TOP - 2, 0x4cc9f0, 3, 50, 130)
  }

  private updatePlayer(dt: number): void {
    this.playerVY += GRAVITY * dt
    this.playerY += this.playerVY * dt

    const floor = GROUND_TOP - PLAYER_H / 2
    const overPit = this.isOverPit(PLAYER_X)
    // 中心已沉到站立高度以下却还在坑上：踩空了，取消地面开始下坠
    if (overPit && this.playerY > floor) this.sunk = true

    if (this.playerY >= floor && !this.sunk) {
      if (!this.onGround) this.land()
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

  private updateSquash(dt: number): void {
    const k = Math.min(1, dt * 14)
    this.squashX += (1 - this.squashX) * k
    this.squashY += (1 - this.squashY) * k
    this.player.setScale(this.squashX, this.squashY)
  }

  private updateCharacter(dt: number): void {
    this.animT += dt

    // 眨眼：间隔随机，闭眼 90ms
    this.blinkT -= dt
    if (this.blinkT <= 0) {
      this.blinkT = rand(2, 4.5)
      this.blinkDur = 0.09
    }
    if (this.blinkDur > 0) this.blinkDur -= dt
    const eyeScaleY = this.blinkDur > 0 ? 0.12 : 1
    this.eyeL.setScale(1, eyeScaleY)
    this.eyeR.setScale(1, eyeScaleY)

    // 跑步摆腿：贴地时交替小步，空中收腿
    const step = this.phase === 'playing' && this.onGround ? Math.sin(this.animT * 22) : 0
    const tuck = this.onGround ? 0 : -5
    this.legL.y = step * 2 + tuck
    this.legR.y = -step * 2 + tuck

    // 天线灯呼吸
    this.antennaLight.setAlpha(0.55 + 0.45 * Math.sin(this.animT * 4))
  }

  private updateDebris(dt: number): void {
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
      const angle = rand(0, Math.PI * 2)
      const speed = rand(speedMin, speedMax)
      this.debris.push({
        node,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: 0,
        maxLife: rand(0.25, 0.55),
      })
    }
  }

  private clearDebris(): void {
    for (const d of this.debris) {
      d.node.destroy()
    }
    this.debris.length = 0
  }

  private addScore(): void {
    this.score += 1
    this.scoreText.setText(String(this.score))
    this.scorePulse = 1
    this.sfx.score()
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

    this.burstDebris(PLAYER_X, this.playerY, COLOR.player, 10, 100, 340)
    this.burstDebris(PLAYER_X, this.playerY, 0xffffff, 4, 60, 200)
    this.cameras.main.shake(140, 0.008)
    if (reason === 'pit') {
      this.sfx.pit()
    } else {
      this.sfx.hit()
    }

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
