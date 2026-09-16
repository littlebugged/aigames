// 星尘消消乐 —— 入口：创建游戏实例并注册场景
// 与项目其他游戏一致：Web 平台 + 960×720 画布

import Phaser from 'phaser'
import { GAME_W, GAME_H, FONT, STORE, storeGet } from './config'
import { BootScene } from './BootScene'
import { MenuScene } from './MenuScene'
import { GameScene } from './GameScene'
import { GameOverScene } from './GameOverScene'
import { sfx } from './Sfx'

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#070b1f',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, GameScene, GameOverScene],
})

// 仅开发环境暴露调试句柄（生产构建被 tree-shake 剔除）
if (import.meta.env.DEV) {
  ;(window as unknown as { __smGame?: Phaser.Game }).__smGame = game
}

// 音效开关状态在启动时恢复（跨场景共享单例）
sfx.setMuted(storeGet(STORE.muted) === '1')

// 前置字体加载（非阻塞）
if (document.fonts) {
  void document.fonts.load(`20px ${FONT}`)
}