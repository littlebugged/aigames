// 星尘消消乐 —— 结算场景：本局战绩 / 新纪录 / 再战与返回

import Phaser from 'phaser'
import { FONT, GAME_W, GAME_H, COLOR } from './config'
import { sfx } from './Sfx'

interface OverData {
  score: number
  best: number
  isNew: boolean
  maxCombo: number
  merges: number
  clears: number
  duration: number
}

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('over')
  }

  create(data: OverData): void {
    const d = data as OverData | undefined

    // 背景
    const g = this.add.graphics()
    g.fillGradientStyle(COLOR.bgTop, COLOR.bgTop, COLOR.bgBottom, COLOR.bgBottom, 1)
    g.fillRect(0, 0, GAME_W, GAME_H)

    const panel = this.add.container(GAME_W / 2, GAME_H / 2).setAlpha(0)
    const bg = this.add.rectangle(0, 0, 560, 590, 0x161d45, 0.97).setStrokeStyle(2, 0x4a5aa8, 1)
    panel.add(bg)

    // 标题（新纪录时金色）
    const title = this.add
      .text(0, -178, d?.isNew ? '新纪录！' : '游戏结束', {
        fontFamily: FONT,
        fontSize: '38px',
        fontStyle: 'bold',
        color: d?.isNew ? '#ffd166' : '#eaf0ff',
      })
      .setOrigin(0.5)
    panel.add(title)

    const sec = (y: number, label: string, value: string, color = '#eaf0ff'): void => {
      panel.add(
        this.add
          .text(-60, y, label, { fontFamily: FONT, fontSize: '17px', color: '#9aa3d0' })
          .setOrigin(1, 0.5),
      )
      panel.add(
        this.add
          .text(70, y, value, { fontFamily: FONT, fontSize: '22px', fontStyle: 'bold', color })
          .setOrigin(0, 0.5),
      )
    }

    const mm = (ms: number): string => {
      const total = Math.max(0, Math.round(ms / 1000))
      const m = Math.floor(total / 60)
      const s = total % 60
      return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
    }

    sec(-110, '本局得分', String(d?.score ?? 0), '#ffd166')
    sec(-62, '最高纪录', String(d?.best ?? 0))
    sec(-14, '最大连击', `×${d?.maxCombo ?? 0}`)
    sec(34, '合成方块', `${d?.merges ?? 0} 次`)
    sec(82, '消除方块', `${d?.clears ?? 0} 颗`)
    sec(130, '游戏时长', mm(d?.duration ?? 0))

    // 按钮
    const mkBtn = (y: number, label: string, bgColor: number, cb: () => void): void => {
      const r = this.add
        .rectangle(0, y, 300, 56, bgColor, 1)
        .setStrokeStyle(2, 0x7d6bff, 0.9)
        .setInteractive({ useHandCursor: true })
      const t = this.add.text(0, y, label, { fontFamily: FONT, fontSize: '21px', color: '#eaf0ff' }).setOrigin(0.5)
      r.on('pointerover', () => r.setFillStyle(Phaser.Display.Color.ValueToColor(bgColor).brighten(12).color, 1))
      r.on('pointerout', () => r.setFillStyle(bgColor, 1))
      r.on('pointerdown', () => {
        sfx.click()
        cb()
      })
      panel.add([r, t])
    }
    mkBtn(190, '再来一局', 0x3b2d8f, () => this.scene.start('game'))
    mkBtn(256, '返回主页', 0x232c5c, () => this.scene.start('menu'))

    this.tweens.add({ targets: panel, alpha: 1, y: panel.y, duration: 260, ease: 'Cubic.easeOut' })
    // 新纪录飘星
    if (d?.isNew) {
      for (let i = 0; i < 14; i += 1) {
        this.time.delayedCall(i * 70, () => {
          const p = this.add
            .image(GAME_W / 2 + (Math.random() - 0.5) * 420, GAME_H / 2 - 120 + (Math.random() - 0.5) * 60, 'spark')
            .setScale(0.5 + Math.random() * 0.8)
            .setTint(0xffd166)
          this.tweens.add({
            targets: p,
            y: p.y - 60 - Math.random() * 50,
            alpha: 0,
            duration: 900 + Math.random() * 500,
            ease: 'Cubic.easeOut',
            onComplete: () => p.destroy(),
          })
        })
      }
    }
  }
}