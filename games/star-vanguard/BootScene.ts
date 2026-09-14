// 星穹守卫 —— Boot 场景：程序化生成全部纹理后进入主菜单

import Phaser from 'phaser'
import { createTextures } from './textures'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot')
  }

  create(): void {
    createTextures(this)
    this.scene.start('menu')
  }
}