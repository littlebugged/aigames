// 星穹守卫 —— 结算场景（分数 / 最高分 / 新纪录 / 重开 / 回菜单）

import Phaser from 'phaser'
import { FONT, GAME_W, GAME_H, COLOR, FX } from './config'
import { sfx } from './Sfx'

export type GameOverData = {
  score: number
  best: number
  isNew: boolean
}

export class GameOverScene extends Phaser.Scene {
  private lastActionAt = -10000

  constructor() {
    super('gameover')
  }

  create(data: GameOverData): void {
    this.cameras.main.setBackgroundColor(COLOR.bg)
    const cx = GAME_W / 2

    // 背景星空
    const rnd = new Phaser.Math.RandomDataGenerator(['over'])
    for (let i = 0; i < 60; i += 1) {
      const size = rnd.between(1, 3)
      this.add
        .rectangle(rnd.between(0, GAME_W), rnd.between(0, GAME_H), size, size, 0xffffff, 0.16)
        .setDepth(0)
    }

    this.add
      .text(cx, 128, '游 戏 结 束', {
        fontFamily: FONT,
        fontSize: '52px',
        color: '#e9edf6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    if (data.isNew) {
      this.add
        .text(cx, 192, '★ 新纪录！ ★', {
          fontFamily: FONT,
          fontSize: '22px',
          color: '#ffd166',
        })
        .setOrigin(0.5)
    }

    this.add
      .text(cx, 268, '本 局 分 数', { fontFamily: FONT, fontSize: '16px', color: '#8b95ab' })
      .setOrigin(0.5)
    this.add
      .text(cx, 318, String(data.score), {
        fontFamily: FONT,
        fontSize: '64px',
        color: '#4cc9f0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
    this.add
      .text(cx, 392, `历史最高分　${data.best}`, {
        fontFamily: FONT,
        fontSize: '17px',
        color: '#8b95ab',
      })
      .setOrigin(0.5)

    // 再来一局
    const again = this.add
      .text(cx, 470, '再 来 一 局', {
        fontFamily: FONT,
        fontSize: '26px',
        color: '#0b0d12',
        backgroundColor: '#4cc9f0',
        padding: { x: 26, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    again.on('pointerover', () => again.setBackgroundColor('#6ad8ff'))
    again.on('pointerout', () => again.setBackgroundColor('#4cc9f0'))
    again.on('pointerdown', () => this.again())

    // 返回主菜单
    const menu = this.add
      .text(cx, 536, '返回主菜单', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#8b95ab',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    menu.on('pointerover', () => menu.setColor('#e9edf6'))
    menu.on('pointerout', () => menu.setColor('#8b95ab'))
    menu.on('pointerdown', () => this.toMenu())

    this.add
      .text(cx, 590, 'Enter 再来一局　·　Esc 返回主菜单', {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#5b6478',
      })
      .setOrigin(0.5)

    this.input.keyboard?.on('keydown-ENTER', () => this.again())
    this.input.keyboard?.on('keydown-ESC', () => this.toMenu())
    this.input.keyboard?.on('keydown-SPACE', () => this.again())
  }

  private again(): void {
    // E9：快速连点防抖
    if (this.time.now - this.lastActionAt < FX.menuDebounceMs) return
    this.lastActionAt = this.time.now
    sfx.warm()
    this.scene.start('game')
  }

  private toMenu(): void {
    if (this.time.now - this.lastActionAt < FX.menuDebounceMs) return
    this.lastActionAt = this.time.now
    this.scene.start('menu')
  }
}