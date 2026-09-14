// 星穹守卫 —— 主菜单场景（标题 / 操作说明 / 开始 / 静音）

import Phaser from 'phaser'
import { FONT, GAME_W, GAME_H, COLOR, FX, BEST_KEY } from './config'
import { sfx } from './Sfx'

export class MenuScene extends Phaser.Scene {
  private mutedText!: Phaser.GameObjects.Text
  private lastStartAt = -10000

  constructor() {
    super('menu')
  }

  create(): void {
    this.drawBackdrop()

    const cx = GAME_W / 2
    sfx.warm()

    this.add
      .text(cx, 150, '星穹守卫', {
        fontFamily: FONT,
        fontSize: '72px',
        color: '#e9edf6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
    this.add
      .text(cx, 216, 'S T A R   V A N G U A R D', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#4cc9f0',
      })
      .setOrigin(0.5)

    // 操作说明
    this.add
      .text(
        cx,
        306,
        [
          '← → / A D　移动　·　子弹自动发射',
          'P 暂停　·　M 静音',
        ],
        {
          fontFamily: FONT,
          fontSize: '15px',
          color: '#8b95ab',
          align: 'center',
          lineSpacing: 10,
        },
      )
      .setOrigin(0.5)

    const best = this.readBest()
    this.add
      .text(cx, 372, best > 0 ? `历史最高分　${best}` : '尚无记录，快来创造第一个纪录', {
        fontFamily: FONT,
        fontSize: '15px',
        color: '#ffd166',
      })
      .setOrigin(0.5)

    // 开始按钮
    const btn = this.add
      .text(cx, 452, '开 始 游 戏', {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#0b0d12',
        backgroundColor: '#4cc9f0',
        padding: { x: 34, y: 13 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    btn.on('pointerover', () => btn.setBackgroundColor('#6ad8ff'))
    btn.on('pointerout', () => btn.setBackgroundColor('#4cc9f0'))
    // E9：先触发防抖更新，再开始
    btn.on('pointerdown', () => this.startGame())

    this.add
      .text(cx, 540, '按 Enter 或点击按钮开始', {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#5b6478',
      })
      .setOrigin(0.5)

    this.mutedText = this.add
      .text(GAME_W - 26, 26, '', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#8b95ab',
      })
      .setOrigin(1, 0)
    this.refreshMuted()

    this.input.keyboard?.on('keydown-ENTER', () => this.startGame())
    this.input.keyboard?.on('keydown-M', () => this.toggleMute())
  }

  private startGame(): void {
    // E9：快速连点防抖，避免同帧重复 start
    if (this.time.now - this.lastStartAt < FX.menuDebounceMs) return
    this.lastStartAt = this.time.now
    this.scene.start('game')
  }

  private toggleMute(): void {
    sfx.setMuted(!sfx.isMuted())
    this.refreshMuted()
  }

  private refreshMuted(): void {
    this.mutedText.setText(sfx.isMuted() ? '🔇 已静音 (M)' : '🔊 音效开启 (M)')
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

  private drawBackdrop(): void {
    this.cameras.main.setBackgroundColor(COLOR.bg)
    const rnd = new Phaser.Math.RandomDataGenerator(['menu'])
    for (let i = 0; i < 70; i += 1) {
      const size = rnd.between(1, 3)
      this.add
        .rectangle(rnd.between(0, GAME_W), rnd.between(0, GAME_H), size, size, 0xffffff, 0.18)
        .setDepth(0)
    }
    // 一艘展示用战机
    this.add.image(GAME_W / 2, 250, 'player').setScale(1.6).setAlpha(0.12)
  }
}