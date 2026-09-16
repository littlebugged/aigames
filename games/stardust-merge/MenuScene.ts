// 星尘消消乐 —— 主页：标题 / 开始 / 排行榜 / 玩法说明 / 音效
// 页面结构（PRD 5.1）：主页 = 开始游戏 + 排行榜 + 帮助 + 设置

import Phaser from 'phaser'
import { FONT, GAME_W, GAME_H, COLOR, STORE, loadBest, loadRecent, storeGet, storeSet } from './config'
import { sfx } from './Sfx'

interface Star {
  img: Phaser.GameObjects.Image
  vy: number
  phase: number
  speed: number
}

export class MenuScene extends Phaser.Scene {
  private stars: Star[] = []
  private modal: Phaser.GameObjects.Container | null = null

  constructor() {
    super('menu')
  }

  create(): void {
    this.stars = []
    this.modal = null
    sfx.setMuted(storeGet(STORE.muted) === '1')

    this.drawBackground()

    // 标题
    this.add
      .text(GAME_W / 2, 132, '星尘消消乐', {
        fontFamily: FONT,
        fontSize: '58px',
        fontStyle: 'bold',
        color: '#eaf0ff',
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#7d4ae0', 24, true, true)

    this.add
      .text(GAME_W / 2, 192, '放置 · 合成 · 三消', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#9aa3d0',
      })
      .setOrigin(0.5)

    // 最高分
    const best = loadBest()
    this.add
      .text(GAME_W / 2, 238, best > 0 ? `最高分  ${best}` : '暂无记录', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#ffd166',
      })
      .setOrigin(0.5)

    // 开始按钮
    this.makeButton(GAME_W / 2, 330, '开始对局', 240, 62, 0x3b2d8f, () => {
      sfx.warm()
      sfx.click()
      this.scene.start('game')
    })

    // 底部功能行
    this.makeButton(GAME_W / 2 - 190, 470, '排行榜', 168, 48, 0x232c5c, () => {
      sfx.click()
      this.showRankModal()
    })
    this.makeButton(GAME_W / 2, 470, '玩法说明', 168, 48, 0x232c5c, () => {
      sfx.click()
      this.showHelpModal()
    })
    this.makeButton(GAME_W / 2 + 190, 470, `音效 ${sfx.isMuted() ? '关' : '开'}`, 168, 48, 0x232c5c, () => {
      sfx.setMuted(!sfx.isMuted())
      storeSet(STORE.muted, sfx.isMuted() ? '1' : '0')
      sfx.click()
    })

    this.add
      .text(GAME_W / 2, 668, 'v1.0 · 纯前端 · Vite + TypeScript + Phaser', {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#5a6591',
      })
      .setOrigin(0.5)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stars = []
    })
  }

  private drawBackground(): void {
    const g = this.add.graphics()
    g.fillGradientStyle(COLOR.bgTop, COLOR.bgTop, COLOR.bgBottom, COLOR.bgBottom, 1)
    g.fillRect(0, 0, GAME_W, GAME_H)
    // 星尘粒子（缓慢上浮 + 闪烁）
    for (let i = 0; i < 42; i += 1) {
      const img = this.add
        .image(Math.random() * GAME_W, Math.random() * GAME_H, 'glow')
        .setScale(0.04 + Math.random() * 0.1)
        .setAlpha(0.2 + Math.random() * 0.5)
        .setTint(0x9fc6ff)
      this.stars.push({ img, vy: 8 + Math.random() * 26, phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 1.4 })
    }
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000
    for (const s of this.stars) {
      s.img.y -= s.vy * dt
      s.phase += s.speed * dt
      s.img.setAlpha(0.2 + 0.4 * (0.5 + 0.5 * Math.sin(s.phase * 2)))
      if (s.img.y < -20) {
        s.img.y = GAME_H + 20
        s.img.x = Math.random() * GAME_W
      }
    }
  }

  /** 圆角按钮（hover 提亮 + 点击音效） */
  private makeButton(
    x: number,
    y: number,
    label: string,
    w: number,
    h: number,
    bg: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y)
    const rect = this.add.rectangle(0, 0, w, h, bg, 1).setStrokeStyle(2, 0x4a5aa8, 0.9)
    const txt = this.add
      .text(0, 0, label, { fontFamily: FONT, fontSize: '22px', color: '#eaf0ff' })
      .setOrigin(0.5)
    c.add([rect, txt])
    rect.setInteractive({ useHandCursor: true })
    rect.on('pointerover', () => rect.setFillStyle(Phaser.Display.Color.ValueToColor(bg).brighten(14).color, 1))
    rect.on('pointerout', () => rect.setFillStyle(bg, 1))
    rect.on('pointerdown', onClick)
    return c
  }

  // ── 弹层 ──────────────────────────────────────────────

  private openModal(title: string, w: number, h: number, build: (panel: Phaser.GameObjects.Container, cx: number, cy: number) => void): void {
    this.closeModal()
    const c = this.add.container(0, 0).setDepth(100)
    const mask = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.65).setInteractive()
    const panel = this.add.container(GAME_W / 2, GAME_H / 2)
    const bg = this.add.rectangle(0, 0, w, h, 0x161d45, 0.98).setStrokeStyle(2, 0x4a5aa8, 1)
    panel.add(bg)
    panel.add(
      this.add
        .text(0, -h / 2 + 34, title, { fontFamily: FONT, fontSize: '24px', fontStyle: 'bold', color: '#8ad8ff' })
        .setOrigin(0.5),
    )
    build(panel, 0, 0)
    // 关闭按钮
    const close = this.add
      .text(w / 2 - 26, -h / 2 + 22, '✕', { fontFamily: FONT, fontSize: '20px', color: '#9aa3d0' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    close.on('pointerover', () => close.setColor('#ffffff'))
    close.on('pointerout', () => close.setColor('#9aa3d0'))
    close.on('pointerdown', () => {
      sfx.click()
      this.closeModal()
    })
    panel.add(close)
    mask.on('pointerdown', () => this.closeModal())
    c.add([mask, panel])
    c.setAlpha(0)
    this.tweens.add({ targets: c, alpha: 1, duration: 140 })
    this.modal = c
  }

  private closeModal(): void {
    if (this.modal) {
      this.modal.destroy()
      this.modal = null
    }
  }

  private showRankModal(): void {
    const list = loadRecent()
    const w = 560
    const h = 460
    this.openModal('排行榜 · 最近 10 局', w, h, (panel) => {
      if (list.length === 0) {
        panel.add(
          this.add
            .text(0, 40, '暂无对局记录\n来一局创造纪录吧！', {
              fontFamily: FONT,
              fontSize: '18px',
              color: '#9aa3d0',
              align: 'center',
              lineSpacing: 10,
            })
            .setOrigin(0.5),
        )
        return
      }
      const fmt = (ts: number): string => {
        const d = new Date(ts)
        return `${d.getMonth() + 1}/${d.getDate()}`
      }
      panel.add(
        this.add
          .text(0, -h / 2 + 76, '名次      分数        最大连击        日期', {
            fontFamily: FONT,
            fontSize: '14px',
            color: '#5f6ba0',
          })
          .setOrigin(0.5),
      )
      list.slice(0, 10).forEach((r, i) => {
        const y = -h / 2 + 108 + i * 32
        const row = this.add.container(0, y)
        const line = this.add
          .text(
            0,
            0,
            `${String(i + 1).padStart(2, ' ')}      ${String(r.score).padStart(6, ' ')}         ×${r.maxCombo}                ${fmt(r.date)}`,
            { fontFamily: FONT, fontSize: '17px', color: i === 0 ? '#ffd166' : '#eaf0ff' },
          )
          .setOrigin(0.5)
        row.add(line)
        panel.add(row)
      })
    })
  }

  private showHelpModal(): void {
    const w = 620
    const h = 500
    this.openModal('玩法说明', w, h, (panel) => {
      const lines = [
        '目标：在 8×8 棋盘上放置数字方块，消除越多得分越高。',
        '',
        '· 放置 —— 点击下方待放区拿起方块，再点击格子放下；',
        '            也可以直接拖拽到目标格。',
        '· 合成 —— 若相邻有相同数字，合成翻倍（2+2→4→8…），',
        '            链式合成得分 ×2 递增。',
        '· 消除 —— 一行或一列出现 3 个以上相同数字即消除，',
        '            上方方块下落，继续形成三连可触发连锁，连击得分 ×段数。',
        '· 计分 —— 放置 +5；合成 10×等级；消除 50×等级×连击段。',
        '· 结束 —— 棋盘填满且无法再合成消除时，游戏结束。',
      ]
      panel.add(
        this.add
          .text(0, 14, lines.join('\n'), {
            fontFamily: FONT,
            fontSize: '16px',
            color: '#c3cbf2',
            align: 'left',
            lineSpacing: 8,
          })
          .setOrigin(0.5, 0.5),
      )
    })
  }
}