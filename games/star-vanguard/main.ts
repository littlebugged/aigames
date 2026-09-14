// 星穹守卫 Star Vanguard —— 入口：创建 Phaser.Game 并注册全部场景
// 场景：boot（生成纹理）→ menu（主菜单）→ game（游戏）→ gameover（结算）

import Phaser from 'phaser'
import { GAME_W, GAME_H } from './config'
import { BootScene } from './BootScene'
import { MenuScene } from './MenuScene'
import { GameScene } from './GameScene'
import { GameOverScene } from './GameOverScene'

const game = new Phaser.Game({
  type: Phaser.AUTO, // E10：WebGL 不可用时自动回退 Canvas
  parent: 'stage',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0b0d12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, GameScene, GameOverScene],
})

// 调试句柄：控制台可访问游戏实例（`window.__svGame.scene.getScene('game')`）
;(window as unknown as { __svGame?: Phaser.Game }).__svGame = game

// E10：引擎初始化失败（连 Canvas 都不可用）时显示友好提示
game.events.once(Phaser.Core.Events.READY, () => {
  const canvas = document.querySelector('#stage canvas')
  if (!canvas) {
    const el = document.createElement('div')
    el.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#e9edf6;font-size:18px;font-family:system-ui;'
    el.textContent = '当前浏览器无法初始化游戏渲染器，请升级浏览器后重试。'
    document.body.appendChild(el)
  }
})