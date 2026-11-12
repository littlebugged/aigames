import type { SectorId, ShipId } from '../data/ids'
import type { AudioEngine } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Lang, SaveData } from '../game/progress'

export type ScreenId = 'menu' | 'deploy' | 'hangar' | 'ach'

export interface Selection {
  ship: ShipId
  sector: SectorId
  threat: number
  endless: boolean
}

export type ToastKind = 'info' | 'good' | 'gold' | 'bad'
export type UiSound = Parameters<AudioEngine['ui']>[0]

/** UI 屏幕共享的上下文：数据 + 操作入口。屏幕本身不持有全局状态。 */
export interface UiCtx {
  save: SaveData
  audio: AudioEngine
  input: Input
  persist(): void
  /** 用新存档整体替换（导入/重置） */
  replaceSave(s: SaveData): void
  go(s: ScreenId): void
  start(sel: Selection): void
  sfx(kind: UiSound): void
  toast(text: string, kind?: ToastKind, ms?: number): void
  /** 设置变更后让音频/画面/输入同步 */
  applySettings(): void
  setLang(l: Lang): void
  /** 打开设置面板（模态），关闭时回调 */
  openSettings(onClose?: () => void): void
  toggleFullscreen(): void
  /** 浏览器是否允许现在弹出"安装到桌面" */
  canInstall(): boolean
  install(): void
}

export interface Screen {
  el: HTMLElement
  /** 每次显示前调用：根据最新存档重绘 */
  refresh(): void
  /** 键盘事件；返回 true 表示已处理 */
  onKey?(e: KeyboardEvent): boolean
}
