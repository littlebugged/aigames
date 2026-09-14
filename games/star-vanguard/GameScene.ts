// 星穹守卫 —— 主游戏场景
// 自定义更新循环（与项目其他游戏一致，不依赖 Phaser 物理/粒子引擎）：
// 所有实体（玩家/敌人/子弹/道具/粒子）为数组 + AABB 碰撞，暂停/结束由 phase 统一控制

import Phaser from 'phaser'
import {
  GAME_W,
  GAME_H,
  FONT,
  BEST_KEY,
  PLAYER,
  ENEMY,
  ENEMY_DEFS,
  WAVE,
  POWER,
  FX,
  COLOR,
  rand,
  randInt,
  pick,
  clamp,
} from './config'
import type { EnemyKind, PowerKind } from './config'
import { sfx } from './Sfx'

const HALF_W = GAME_W / 2
const PLAYER_BOTTOM = GAME_H - 54 // 玩家固定 y
const PLAYER_HIT_W = 34 // 玩家碰撞盒（比纹理小，鼓励精准）
const PLAYER_HIT_H = 48

type Phase = 'playing' | 'paused' | 'dying'
type WaveState = 'warn' | 'spawning' | 'clearing' | 'intermission'

type Bullet = {
  node: Phaser.GameObjects.Image
  vx: number
  vy: number
  hostile: boolean
}

type Enemy = {
  kind: EnemyKind
  node: Phaser.GameObjects.Image
  hp: number
  maxHp: number
  score: number
  vx: number
  vy: number
  spin: number
  t: number // ufo 正弦相位 / boss 移动相位
  baseY: number // ufo 悬浮高度 / boss 高度
  fireAcc: number // ufo 射击 / boss 环形弹幕计时
  fanAcc: number // boss 扇形齐射启动计时
  fanRemain: number // boss 扇形齐射剩余连发数
  fanGapAcc: number
  entered: boolean
  hpBar?: Phaser.GameObjects.Rectangle
  hpBarBg?: Phaser.GameObjects.Rectangle
}

type PowerDrop = {
  node: Phaser.GameObjects.Image
  kind: PowerKind
}

type Particle = {
  node: Phaser.GameObjects.Rectangle
  vx: number
  vy: number
  life: number
  maxLife: number
}

export class GameScene extends Phaser.Scene {
  // 玩家状态
  private px = HALF_W
  private lives = PLAYER.startLives
  private shields = 0
  private invincibleUntil = 0
  private doubleUntil = 0
  private rapidUntil = 0
  private fireAcc = 0
  private exhaustAcc = 0

  private playerNode!: Phaser.GameObjects.Image
  private playerGlow!: Phaser.GameObjects.Image

  // 实体
  private readonly playerBullets: Bullet[] = []
  private readonly enemyBullets: Bullet[] = []
  private readonly enemies: Enemy[] = []
  private readonly drops: PowerDrop[] = []
  private readonly particles: Particle[] = []
  private readonly stars: { node: Phaser.GameObjects.Rectangle; layer: number; y: number }[] = []

  // 波次
  private wave = 0
  private waveState: WaveState = 'intermission'
  private spawnQueue = 0
  private spawnAcc = 0
  private spawnInterval = 0
  private stateTimer = 0 // warn / intermission 计时
  private warnFlashAcc = 0
  private warnFlashCount = 0

  // 分数 / HUD
  private score = 0
  private best = 0
  private scorePulse = 0
  private scoreText!: Phaser.GameObjects.Text
  private bestText!: Phaser.GameObjects.Text
  private livesText!: Phaser.GameObjects.Text
  private buffText!: Phaser.GameObjects.Text
  private waveText!: Phaser.GameObjects.Text
  private bannerText!: Phaser.GameObjects.Text
  private warnText!: Phaser.GameObjects.Text
  private pauseOverlay!: Phaser.GameObjects.Container

  private phase: Phase = 'playing'
  private lowFx = false
  private lastFpsCheck = 0
  private dieAt = 0

  private keys!: {
    left: Phaser.Input.Keyboard.Key
    right: Phaser.Input.Keyboard.Key
    a: Phaser.Input.Keyboard.Key
    d: Phaser.Input.Keyboard.Key
  }

  constructor() {
    super('game')
  }

  create(): void {
    // 每局完整重置：场景实例会被复用（scene.start 只重跑 create），
    // 必须清空实体数组并复位全部状态
    this.playerBullets.length = 0
    this.enemyBullets.length = 0
    this.enemies.length = 0
    this.drops.length = 0
    this.particles.length = 0
    this.stars.length = 0
    this.lives = PLAYER.startLives
    this.shields = 0
    this.score = 0
    this.px = HALF_W
    this.invincibleUntil = 0
    this.doubleUntil = 0
    this.rapidUntil = 0
    this.fireAcc = 0
    this.exhaustAcc = 0
    this.wave = 0
    this.waveState = 'intermission'
    this.spawnQueue = 0
    this.spawnAcc = 0
    this.scorePulse = 0
    this.phase = 'playing'
    this.lowFx = false
    this.lastFpsCheck = this.time.now
    this.best = this.readBest()

    this.buildBackdrop()
    this.buildPlayer()
    this.buildHud()
    this.buildPauseOverlay()
    this.bindInput()

    this.startWave(1)
  }

  // ── 构建 ────────────────────────────────────────────────────

  private buildBackdrop(): void {
    this.cameras.main.setBackgroundColor(COLOR.bg)
    // 3 层视差星空（FX.starLayers：[速度, 数量, 尺寸, 透明度]）
    for (let layer = 0; layer < FX.starLayers.length; layer += 1) {
      const cfg = FX.starLayers[layer]
      for (let i = 0; i < cfg.count; i += 1) {
        const size = rand(cfg.sizeMin, cfg.sizeMax)
        const node = this.add
          .rectangle(rand(0, GAME_W), rand(0, GAME_H), size, size, 0xffffff, cfg.alpha)
          .setDepth(1)
        this.stars.push({ node, layer, y: node.y })
      }
    }
  }

  private buildPlayer(): void {
    this.playerGlow = this.add
      .image(this.px, PLAYER_BOTTOM, 'glow')
      .setDepth(9)
      .setTint(COLOR.player)
      .setScale(1.5, 1.8)
      .setAlpha(0.5)
    this.playerNode = this.add
      .image(this.px, PLAYER_BOTTOM, 'player')
      .setDepth(10)
      .setData('w', PLAYER_HIT_W)
      .setData('h', PLAYER_HIT_H)
  }

  private buildHud(): void {
    this.scoreText = this.add
      .text(26, 18, '0', { fontFamily: FONT, fontSize: '38px', color: '#e9edf6' })
      .setDepth(30)
    this.bestText = this.add
      .text(GAME_W - 26, 26, `BEST ${this.best}`, {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#8b95ab',
      })
      .setOrigin(1, 0)
      .setDepth(30)
    this.waveText = this.add
      .text(HALF_W, 24, '', { fontFamily: FONT, fontSize: '18px', color: '#7b85a0' })
      .setOrigin(0.5, 0)
      .setDepth(30)
    this.livesText = this.add
      .text(26, 64, '', { fontFamily: FONT, fontSize: '20px', color: '#ff5d7e' })
      .setDepth(30)
    this.buffText = this.add
      .text(26, 92, '', { fontFamily: FONT, fontSize: '13px', color: '#4cc9f0' })
      .setDepth(30)

    this.bannerText = this.add
      .text(HALF_W, GAME_H * 0.36, '', {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#e9edf6',
        fontStyle: 'bold',
        align: 'center',
        lineSpacing: 8,
      })
      .setOrigin(0.5)
      .setDepth(40)
      .setAlpha(0)

    this.warnText = this.add
      .text(HALF_W, GAME_H * 0.4, '', {
        fontFamily: FONT,
        fontSize: '64px',
        color: '#ff3d6e',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(41)
      .setVisible(false)

    this.refreshHud()
  }

  private buildPauseOverlay(): void {
    this.pauseOverlay = this.add.container(0, 0).setDepth(60).setVisible(false)
    const dim = this.add.rectangle(HALF_W, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.62)
    const title = this.add
      .text(HALF_W, GAME_H / 2 - 24, '已暂停', {
        fontFamily: FONT,
        fontSize: '52px',
        color: '#e9edf6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
    const hint = this.add
      .text(HALF_W, GAME_H / 2 + 34, '按 P 继续', { fontFamily: FONT, fontSize: '18px', color: '#8b95ab' })
      .setOrigin(0.5)
    this.pauseOverlay.add([dim, title, hint])
  }

  private bindInput(): void {
    this.input.keyboard?.addCapture('SPACE,LEFT,RIGHT,UP,DOWN,A,D,P,M,ENTER,ESC')
    this.input.keyboard?.on('keydown-P', () => this.togglePause())
    this.input.keyboard?.on('keydown-M', () => sfx.setMuted(!sfx.isMuted()))
    const kc = Phaser.Input.Keyboard.KeyCodes
    this.keys = this.input.keyboard!.addKeys('left,right,a,d') as GameScene['keys']
  }

  // ── 主循环 ──────────────────────────────────────────────────

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000

    this.updateBackdrop(dt)
    this.updateParticles(dt)
    this.updateFpsGuard(time)

    if (this.phase === 'paused') return
    if (this.phase === 'dying') {
      this.updateEnemies(dt, time)
      this.updateBullets(dt)
      if (time >= this.dieAt) this.goGameOver()
      return
    }

    this.updateWave(dt, time)
    this.updatePlayer(dt, time)
    this.updateBullets(dt)
    this.updateEnemies(dt, time)
    this.updateDrops(dt)
    this.collide()
    this.updateHud()
  }

  // ── 玩家 ────────────────────────────────────────────────────

  private updatePlayer(dt: number, time: number): void {
    const k = this.keys
    const left = k.left.isDown || k.a.isDown
    const right = k.right.isDown || k.d.isDown

    const dir = (right ? 1 : 0) - (left ? 1 : 0)
    if (dir !== 0) {
      this.px = clamp(this.px + dir * PLAYER.speed * dt, 30, GAME_W - 30)
    }

    // 尾焰粒子
    this.exhaustAcc += dt
    if (this.exhaustAcc > 0.03) {
      this.exhaustAcc = 0
      const count = this.lowFx ? 1 : 2
      for (let i = 0; i < count; i += 1) {
        this.spawnParticle(
          this.px + rand(-6, 6),
          PLAYER_BOTTOM + 26,
          rand(-18, 18),
          rand(120, 190),
          rand(0.2, 0.35),
          COLOR.player,
        )
      }
    }

    // 无敌帧闪烁
    const invincible = time < this.invincibleUntil
    const targetAlpha = invincible ? (Math.sin(time / 45) > 0 ? 0.25 : 1) : 1
    if (this.playerNode.alpha !== targetAlpha) {
      this.playerNode.setAlpha(targetAlpha)
      this.playerGlow.setAlpha(invincible ? 0.15 : 0.5)
    }

    // 自动射击（1 秒 3 发；rapid 道具期间加速）
    const cooldown = time < this.rapidUntil ? PLAYER.rapidCooldown : PLAYER.fireCooldown
    this.fireAcc += dt * 1000
    if (this.fireAcc >= cooldown) {
      this.fireAcc = 0
      this.fire()
    }

    this.playerNode.setPosition(this.px, PLAYER_BOTTOM)
    this.playerGlow.setPosition(this.px, PLAYER_BOTTOM + 6)
  }

  private fire(): void {
    const double = this.time.now < this.doubleUntil
    const xs = double ? [this.px - 9, this.px + 9] : [this.px]
    for (const x of xs) {
      const node = this.add.image(x, PLAYER_BOTTOM - 30, 'bullet').setDepth(15)
      node.setData('w', 6)
      node.setData('h', 16)
      this.playerBullets.push({ node, vx: 0, vy: -PLAYER.bulletSpeed, hostile: false })
    }
    sfx.shoot()
  }

  // ── 子弹 ────────────────────────────────────────────────────

  private updateBullets(dt: number): void {
    for (let i = this.playerBullets.length - 1; i >= 0; i -= 1) {
      const b = this.playerBullets[i] as Bullet
      b.node.x += b.vx * dt
      b.node.y += b.vy * dt
      if (b.node.y < -24) {
        b.node.destroy()
        this.playerBullets.splice(i, 1)
      }
    }
    for (let i = this.enemyBullets.length - 1; i >= 0; i -= 1) {
      const b = this.enemyBullets[i] as Bullet
      b.node.x += b.vx * dt
      b.node.y += b.vy * dt
      if (b.node.y > GAME_H + 24 || b.node.x < -24 || b.node.x > GAME_W + 24) {
        b.node.destroy()
        this.enemyBullets.splice(i, 1)
      }
    }
  }

  private spawnEnemyBullet(x: number, y: number, vx: number, vy: number): void {
    const node = this.add.image(x, y, 'ebullet').setDepth(15)
    this.enemyBullets.push({ node, vx, vy, hostile: true })
  }

  // ── 敌人 ────────────────────────────────────────────────────

  private spawnMinion(): void {
    const roll = Math.random()
    let kind: EnemyKind
    if (this.wave === 1) {
      kind = Math.random() < 0.6 ? 'asteroidL' : 'asteroidS'
    } else if (this.wave === 2) {
      kind = roll < 0.4 ? 'asteroidL' : roll < 0.75 ? 'asteroidS' : 'dart'
    } else {
      kind = roll < 0.3 ? 'asteroidL' : roll < 0.55 ? 'asteroidS' : roll < 0.8 ? 'dart' : 'ufo'
    }
    this.spawnEnemy(kind)
  }

  private spawnEnemy(kind: EnemyKind): void {
    const def = ENEMY_DEFS[kind as Exclude<EnemyKind, 'boss'>]
    const x = rand(50, GAME_W - 50)
    const node = this.add.image(x, -40, kind).setDepth(12)
    node.setData('w', kind === 'asteroidL' ? 60 : kind === 'ufo' ? 60 : kind === 'asteroidS' ? 34 : 42)
    node.setData('h', kind === 'asteroidL' ? 60 : kind === 'ufo' ? 38 : kind === 'asteroidS' ? 34 : 42)

    const e: Enemy = {
      kind,
      node,
      hp: def.hp,
      maxHp: def.hp,
      score: def.score,
      vx: 0,
      vy: 0,
      spin: rand(-1.4, 1.4),
      t: 0,
      baseY: 0,
      fireAcc: 0,
      fanAcc: 0,
      fanRemain: 0,
      fanGapAcc: 0,
      entered: false,
    }

    if (kind === 'asteroidL' || kind === 'asteroidS') {
      // 自屏幕上方漂移入场、旋转、速度随机
      e.vy = (kind === 'asteroidL' ? rand(55, 95) : rand(110, 165)) * (1 + this.wave * 0.03)
      e.vx = rand(-22, 22)
    } else if (kind === 'dart') {
      // 高速斜向俯冲，带小角度随机
      e.vy = rand(230, 300)
      const dir = Math.random() < 0.5 ? -1 : 1
      e.vx = dir * rand(70, 150) * (1 + this.wave * 0.04)
      e.spin = 0
    } else if (kind === 'ufo') {
      // 入场后正弦横向移动：相位取当前 x 对应的值，避免入场瞬间横跳
      e.baseY = rand(110, 200)
      e.vy = 120
      e.vx = 0
      e.spin = 0
      e.fireAcc = 1400
      const amp = HALF_W - 120
      const phase = Math.asin(clamp((x - HALF_W) / amp, -1, 1))
      e.t = phase / 0.85
    } else {
      // boss：由 spawnBoss 处理，此处兜底
      node.destroy()
      return
    }

    this.enemies.push(e)
  }

  private spawnBoss(): void {
    const x = HALF_W
    const node = this.add.image(x, -100, 'boss').setDepth(12)
    node.setData('w', 160)
    node.setData('h', 76)
    const hpBase =
      this.wave < 6 ? ENEMY.bossMaxHpBase : Math.min(ENEMY.bossMaxHpCap, ENEMY.bossMaxHpFrom6 + (this.wave - 6) * ENEMY.bossMaxHpStep)
    const e: Enemy = {
      kind: 'boss',
      node,
      hp: hpBase,
      maxHp: hpBase,
      score: ENEMY.bossScore,
      vx: 0,
      vy: 130, // 入场下移速度
      spin: 0,
      t: 0,
      baseY: rand(ENEMY.bossTop, ENEMY.bossBottom),
      fireAcc: 0,
      fanAcc: 0,
      fanRemain: 0,
      fanGapAcc: 0,
      entered: false,
    }
    // 血条
    const barW = 150
    e.hpBarBg = this.add.rectangle(x, 0, barW + 4, 12, 0x000000, 0.65).setDepth(14)
    e.hpBar = this.add.rectangle(x, 0, barW, 8, 0xff3d6e).setDepth(14)
    this.enemies.push(e)
  }

  private updateEnemies(dt: number, time: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const e = this.enemies[i] as Enemy
      const n = e.node

      if (e.kind === 'boss') {
        this.updateBoss(e, dt, time)
        continue
      }

      if (e.kind === 'ufo') {
        e.t += dt
        if (!e.entered) {
          n.y += e.vy * dt
          if (n.y >= e.baseY) {
            e.entered = true
            n.y = e.baseY
          }
        } else {
          n.x = HALF_W + Math.sin(e.t * 0.85) * (HALF_W - 120)
          // 朝向玩家发射子弹
          e.fireAcc += dt * 1000
          if (e.fireAcc >= 1500) {
            e.fireAcc = 0
            const ux = this.px - n.x
            const uy = PLAYER_BOTTOM - n.y
            const len = Math.hypot(ux, uy) || 1
            this.spawnEnemyBullet(
              n.x,
              n.y + 18,
              (ux / len) * ENEMY.ufoBulletSpeed,
              (uy / len) * ENEMY.ufoBulletSpeed,
            )
            sfx.enemyShoot()
          }
        }
      } else if (e.kind === 'dart') {
        // 末段加速
        if (n.y > GAME_H * 0.45) e.vy += 620 * dt
        n.x += e.vx * dt
        n.y += e.vy * dt
      } else {
        // 小行星
        n.x += e.vx * dt
        n.y += e.vy * dt
        n.rotation += e.spin * dt
      }

      if (n.y > GAME_H + 60 || n.x < -70 || n.x > GAME_W + 70) {
        e.hpBar?.destroy()
        e.hpBarBg?.destroy()
        n.destroy()
        this.enemies.splice(i, 1)
      }
    }
  }

  private updateBoss(e: Enemy, dt: number, _time: number): void {
    const n = e.node
    if (!e.entered) {
      // 入场：下移到目标高度，进场 2s 后开炮（fireAcc 预置负值实现延迟）
      n.y += e.vy * dt
      if (n.y >= e.baseY) {
        n.y = e.baseY
        e.entered = true
        e.fireAcc = -ENEMY.bossFireDelay
      }
    } else {
      // 水平正弦移动（约 60px/s 峰值）
      e.t += dt * ENEMY.bossMoveSpeed * 0.02
      n.x = HALF_W + Math.sin(e.t * 1.4) * (HALF_W - 200)

      // 弹幕 1：环形散射（每 1.6s，12 向，180px/s）
      e.fireAcc += dt * 1000
      if (e.fireAcc >= ENEMY.bossRingInterval) {
        e.fireAcc = 0
        for (let k = 0; k < ENEMY.bossRingCount; k += 1) {
          const a = (k / ENEMY.bossRingCount) * Math.PI * 2 + e.t
          this.spawnEnemyBullet(
            n.x,
            n.y + 10,
            Math.cos(a) * ENEMY.bossRingSpeed,
            Math.sin(a) * ENEMY.bossRingSpeed,
          )
        }
        sfx.enemyShoot()
      }

      // 弹幕 2：扇形齐射（每 2.2s 启动一轮 5 连发，90ms 间隔，300px/s，±20°）
      if (e.fanRemain > 0) {
        // 连发进行中
        e.fanGapAcc += dt * 1000
        if (e.fanGapAcc >= ENEMY.bossFanGapMs) {
          e.fanGapAcc = 0
          e.fanRemain -= 1
          const shotIndex = ENEMY.bossFanShots - e.fanRemain // 1..5
          const center = Math.atan2(PLAYER_BOTTOM - n.y, this.px - n.x)
          const a =
            center +
            Phaser.Math.DegToRad(ENEMY.bossFanArc) -
            ((shotIndex - 0.5) / ENEMY.bossFanShots) * 2 * Phaser.Math.DegToRad(ENEMY.bossFanArc)
          this.spawnEnemyBullet(
            n.x,
            n.y + 10,
            Math.cos(a) * ENEMY.bossFanSpeed,
            Math.sin(a) * ENEMY.bossFanSpeed,
          )
        }
      } else {
        e.fanAcc += dt * 1000
        if (e.fanAcc >= ENEMY.bossFanInterval) {
          e.fanAcc = 0
          e.fanRemain = ENEMY.bossFanShots
          e.fanGapAcc = 0
        }
      }
    }

    // 血条跟随
    if (e.hpBar && e.hpBarBg) {
      const y = n.y - 62
      e.hpBarBg.setPosition(n.x, y)
      e.hpBar.setPosition(n.x - (e.hpBar.width / 2) * (1 - e.hp / e.maxHp), y)
      e.hpBar.setScale(e.hp / e.maxHp, 1)
    }
  }

  private damageEnemy(e: Enemy, dmg: number): void {
    e.hp -= dmg
    if (e.hp > 0) return
    this.killEnemy(e)
  }

  private killEnemy(e: Enemy): void {
    const { node } = e
    const idx = this.enemies.indexOf(e)
    if (idx >= 0) this.enemies.splice(idx, 1)

    if (e.kind === 'asteroidL') {
      // 分裂为 2 颗小行星
      this.burst(node.x, node.y, COLOR.asteroid, this.lowFx ? 6 : 12)
      sfx.boomSmall()
      this.spawnAsteroidChild(node.x - 16, node.y, -1)
      this.spawnAsteroidChild(node.x + 16, node.y, 1)
    } else if (e.kind === 'asteroidS') {
      this.burst(node.x, node.y, COLOR.asteroid, this.lowFx ? 5 : 9)
      sfx.boomSmall()
    } else if (e.kind === 'dart') {
      this.burst(node.x, node.y, COLOR.dart, this.lowFx ? 5 : 9)
      sfx.boomSmall()
    } else if (e.kind === 'ufo') {
      this.burst(node.x, node.y, COLOR.ufo, this.lowFx ? 8 : 14)
      sfx.boomSmall()
    } else {
      // Boss：大爆炸 + 震屏 + 掉落 2 道具（必含 1 生命）+ 500 分
      this.burst(node.x, node.y, COLOR.boss, this.lowFx ? 30 : 55)
      this.burst(node.x, node.y, 0xffffff, this.lowFx ? 8 : 16)
      this.cameras.main.shake(320, 0.014)
      sfx.boomBig()
      this.spawnDrop(node.x, node.y, 'life')
      this.spawnDrop(node.x + 40, node.y, pick(['double', 'shield', 'rapid', 'life'] as const))
    }

    // 掉落（Boss 已单独处理）
    if (e.kind !== 'boss') {
      this.rollDrop(node.x, node.y)
    }

    e.hpBar?.destroy()
    e.hpBarBg?.destroy()
    node.destroy()

    this.addScore(e.score)
  }

  private spawnAsteroidChild(x: number, y: number, dir: number): void {
    const node = this.add.image(x, y, 'asteroidS').setDepth(12)
    node.setData('w', 34)
    node.setData('h', 34)
    this.enemies.push({
      kind: 'asteroidS',
      node,
      hp: ENEMY_DEFS.asteroidS.hp,
      maxHp: ENEMY_DEFS.asteroidS.hp,
      score: ENEMY_DEFS.asteroidS.score,
      vx: dir * rand(40, 80),
      vy: rand(40, 80),
      spin: rand(-2, 2),
      t: 0,
      baseY: 0,
      fireAcc: 0,
      fanAcc: 0,
      fanRemain: 0,
      fanGapAcc: 0,
      entered: true,
    })
  }

  // Boss 的扇形齐射独立于环形节奏（环形满足时也尝试启动扇形）

  // ── 波次 ────────────────────────────────────────────────────

  private startWave(n: number): void {
    this.wave = n
    this.spawnQueue = 0
    this.spawnAcc = 0
    const isBossWave = n % WAVE.bossEvery === 0

    if (isBossWave) {
      // E：Boss 警告（红闪 3 次 + WARNING 2s），结束后生成
      this.waveState = 'warn'
      this.stateTimer = 0
      this.warnFlashCount = 0
      this.warnFlashAcc = 0
      this.warnText.setText('WARNING').setVisible(true)
      this.warnText.setAlpha(0)
      sfx.bossWarn()
    } else {
      this.waveState = 'spawning'
      this.spawnQueue = WAVE.minionsBase + Math.min(n, 6)
      this.spawnInterval = Math.max(WAVE.spawnIntervalMin, WAVE.spawnIntervalBase - n * WAVE.spawnIntervalStep)
      this.showBanner(`WAVE ${n}`)
    }
    this.waveText.setText(`WAVE ${n}`)
  }

  private updateWave(dt: number, time: number): void {
    if (this.waveState === 'warn') {
      this.stateTimer += dt * 1000
      // 红闪 3 次（每 400ms 闪一次，持续 120ms）
      this.warnFlashAcc += dt * 1000
      if (this.warnFlashAcc >= 400 && this.warnFlashCount < FX.warnFlashes * 2) {
        this.warnFlashAcc = 0
        this.warnFlashCount += 1
        const on = this.warnFlashCount % 2 === 1
        this.cameras.main.flash(110, 255, 40, 70)
        this.warnText.setAlpha(on ? 1 : 0.25)
      }
      if (this.stateTimer >= FX.warnMs) {
        this.warnText.setVisible(false)
        this.waveState = 'spawning'
        this.spawnQueue = WAVE.bossWaveMinions
        this.spawnInterval = 900
        this.spawnAcc = 0
        this.spawnBoss()
        this.showBanner(`WAVE ${this.wave}`)
      }
      return
    }

    if (this.waveState === 'spawning') {
      if (this.spawnQueue > 0 && this.enemies.length < WAVE.maxAlive) {
        this.spawnAcc += dt * 1000
        if (this.spawnAcc >= this.spawnInterval) {
          this.spawnAcc = 0
          this.spawnQueue -= 1
          this.spawnMinion()
        }
      } else if (this.spawnQueue <= 0) {
        this.waveState = 'clearing'
      }
      return
    }

    if (this.waveState === 'clearing') {
      if (this.enemies.length === 0) {
        this.waveState = 'intermission'
        this.stateTimer = 0
        this.showBanner('WAVE CLEAR')
        sfx.wave()
      }
      return
    }

    if (this.waveState === 'intermission') {
      this.stateTimer += dt * 1000
      if (this.stateTimer >= WAVE.clearDelayMs) {
        this.startWave(this.wave + 1)
      }
    }
  }

  private showBanner(text: string): void {
    this.bannerText.setText(text).setAlpha(0)
    this.tweens.killTweensOf(this.bannerText)
    this.tweens.add({
      targets: this.bannerText,
      alpha: 1,
      duration: 240,
      yoyo: true,
      hold: 900,
      onComplete: () => this.bannerText.setAlpha(0),
    })
  }

  // ── 道具 ────────────────────────────────────────────────────

  private rollDrop(x: number, y: number): void {
    if (Math.random() > POWER.dropChance) return
    this.spawnDrop(x, y, pick(['life', 'double', 'shield', 'rapid'] as const))
  }

  private spawnDrop(x: number, y: number, kind: PowerKind): void {
    const node = this.add.image(x, y, `power-${kind}`).setDepth(16)
    this.drops.push({ node, kind })
  }

  private updateDrops(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i -= 1) {
      const d = this.drops[i] as PowerDrop
      d.node.y += POWER.fallSpeed * dt
      d.node.rotation += dt * 1.2
      if (d.node.y > GAME_H + 30) {
        d.node.destroy()
        this.drops.splice(i, 1)
        continue
      }
      // 拾取检测（半径）
      if (Math.hypot(d.node.x - this.px, d.node.y - PLAYER_BOTTOM) <= POWER.pickupRadius + 14) {
        this.applyPower(d.kind)
        d.node.destroy()
        this.drops.splice(i, 1)
      }
    }
  }

  private applyPower(kind: PowerKind): void {
    const time = this.time.now
    if (kind === 'life') {
      if (this.lives < PLAYER.maxLives) {
        this.lives += 1
      } else {
        this.addScore(POWER.fullLifeBonus, true)
      }
    } else if (kind === 'double') {
      this.doubleUntil = time + PLAYER.doubleMs
    } else if (kind === 'rapid') {
      this.rapidUntil = time + PLAYER.rapidMs
    } else {
      this.shields += 1
    }
    sfx.pickup()
    this.cameras.main.flash(80, 80, 200, 120)
  }

  // ── 碰撞 ────────────────────────────────────────────────────

  private collide(): void {
    // 玩家子弹 vs 敌人
    for (let bi = this.playerBullets.length - 1; bi >= 0; bi -= 1) {
      const b = this.playerBullets[bi] as Bullet
      for (let ei = this.enemies.length - 1; ei >= 0; ei -= 1) {
        const e = this.enemies[ei] as Enemy
        if (this.hit(b.node, e.node)) {
          b.node.destroy()
          this.playerBullets.splice(bi, 1)
          this.damageEnemy(e, 1)
          break
        }
      }
    }

    // 敌方子弹 vs 玩家
    for (let bi = this.enemyBullets.length - 1; bi >= 0; bi -= 1) {
      const b = this.enemyBullets[bi] as Bullet
      if (this.hit(b.node, this.playerNode)) {
        b.node.destroy()
        this.enemyBullets.splice(bi, 1)
        this.damagePlayer()
        if (this.phase === 'dying') return
      }
    }

    // 敌人 vs 玩家（冲撞）
    for (let ei = this.enemies.length - 1; ei >= 0; ei -= 1) {
      const e = this.enemies[ei] as Enemy
      if (e.kind === 'boss') {
        // Boss 很少贴玩家，为公平不因贴脸即死，仅当进入下方区域时判定
        if (e.node.y > GAME_H * 0.55 && this.hit(e.node, this.playerNode)) {
          this.collideEnemyPlayer(e, ei)
        }
        continue
      }
      if (this.hit(e.node, this.playerNode)) {
        this.collideEnemyPlayer(e, ei)
      }
    }
  }

  private collideEnemyPlayer(e: Enemy, ei: number): void {
    if (this.phase !== 'playing') return
    if (this.time.now < this.invincibleUntil) return
    // 护盾：抵免 1 次，摧毁撞击来源
    if (this.shields > 0) {
      this.shields -= 1
      this.invincibleUntil = this.time.now + 600
      sfx.shieldBreak()
      this.burst(e.node.x, e.node.y, COLOR.power, this.lowFx ? 6 : 10)
      this.damageEnemy(e, 999)
      this.refreshHud()
      return
    }
    this.damagePlayer()
  }

  /** AABB 碰撞（基于纹理尺寸） */
  private hit(a: { x: number; y: number; getData?(k: string): unknown }, b: { x: number; y: number; getData?(k: string): unknown }): boolean {
    const aw = ((a.getData?.('w') as number) ?? 0) / 2
    const ah = ((a.getData?.('h') as number) ?? 0) / 2
    const bw = ((b.getData?.('w') as number) ?? 0) / 2
    const bh = ((b.getData?.('h') as number) ?? 0) / 2
    return Math.abs(a.x - b.x) < aw + bw && Math.abs(a.y - b.y) < ah + bh
  }

  private damagePlayer(): void {
    if (this.phase !== 'playing') return
    const time = this.time.now
    if (time < this.invincibleUntil) return

    this.lives -= 1
    this.invincibleUntil = time + PLAYER.invincibleMs
    this.refreshHud()
    this.cameras.main.shake(200, 0.01)
    sfx.hit()
    this.burst(this.px, PLAYER_BOTTOM, COLOR.player, this.lowFx ? 6 : 12)

    if (this.lives <= 0) {
      this.die()
    }
  }

  private die(): void {
    this.phase = 'dying'
    this.dieAt = this.time.now + 1000
    this.playerNode.setVisible(false)
    this.playerGlow.setVisible(false)
    this.burst(this.px, PLAYER_BOTTOM, COLOR.player, this.lowFx ? 20 : 36)
    this.burst(this.px, PLAYER_BOTTOM, 0xffffff, this.lowFx ? 8 : 14)
    this.cameras.main.shake(400, 0.02)
    sfx.boomBig()
    sfx.gameOver()
  }

  private goGameOver(): void {
    const isNew = this.score > this.best
    if (isNew) {
      this.best = this.score
      this.writeBest(this.best)
    }
    this.scene.start('gameover', { score: this.score, best: this.best, isNew })
  }

  // ── 粒子 ────────────────────────────────────────────────────

  private spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    color: number,
  ): void {
    const size = rand(2, 4)
    const node = this.add.rectangle(x, y, size, size, color, 0.9).setDepth(8)
    this.particles.push({ node, vx, vy, life: 0, maxLife: life })
  }

  private burst(x: number, y: number, color: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, Math.PI * 2)
      const speed = rand(40, 260)
      this.spawnParticle(
        x,
        y,
        Math.cos(a) * speed,
        Math.sin(a) * speed - 40,
        rand(0.3, 0.7),
        color,
      )
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i] as Particle
      p.life += dt
      p.vy += 260 * dt
      p.node.x += p.vx * dt
      p.node.y += p.vy * dt
      p.node.setAlpha(Math.max(0, 0.9 * (1 - p.life / p.maxLife)))
      if (p.life >= p.maxLife) {
        p.node.destroy()
        this.particles.splice(i, 1)
      }
    }
  }

  // ── 星空 / HUD / 降级 ───────────────────────────────────────

  private updateBackdrop(dt: number): void {
    for (const s of this.stars) {
      s.y += FX.starLayers[s.layer].speed * dt
      if (s.y > GAME_H + 4) {
        s.y = -4
        s.node.x = rand(0, GAME_W)
      }
      s.node.y = s.y
    }
  }

  private addScore(v: number, silent = false): void {
    this.score += v
    this.scorePulse = 1
    if (silent) {
      // 满血生命 +50 的提示
      this.showBanner('+50')
      return
    }
  }

  private updateHud(): void {
    this.scoreText.setText(String(this.score))
    if (this.scorePulse > 0) {
      this.scorePulse = Math.max(0, this.scorePulse - 0.06)
      this.scoreText.setScale(1 + this.scorePulse * 0.2)
    }
    this.refreshHud()
  }

  private refreshHud(): void {
    this.livesText.setText('♥'.repeat(Math.max(0, this.lives)))
    const time = this.time.now
    const buffs: string[] = []
    if (this.shields > 0) buffs.push(`◆护盾×${this.shields}`)
    if (time < this.doubleUntil) buffs.push(`ǁ双发 ${Math.ceil((this.doubleUntil - time) / 1000)}s`)
    if (time < this.rapidUntil) buffs.push(`»速射 ${Math.ceil((this.rapidUntil - time) / 1000)}s`)
    this.buffText.setText(buffs.join('　'))
  }

  private updateFpsGuard(time: number): void {
    // E7：帧率低于阈值时进入降级（粒子减半）
    if (time - this.lastFpsCheck < 2000) return
    this.lastFpsCheck = time
    const fps = this.game.loop.actualFps
    if (fps > 0 && fps < FX.lowFpsThreshold) {
      this.lowFx = true
    }
  }

  // ── 暂停 / 结束 ─────────────────────────────────────────────

  private togglePause(): void {
    if (this.phase === 'paused') {
      this.phase = 'playing'
      this.pauseOverlay.setVisible(false)
      return
    }
    if (this.phase !== 'playing') return
    this.phase = 'paused'
    this.pauseOverlay.setVisible(true)
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