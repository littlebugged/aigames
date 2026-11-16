import type { PickupId } from './ids'

/** 拾取物的识别色：画面里的光晕 / 指南页的名牌共用同一份 */
export const PICKUP_COLOR: Record<PickupId, string> = {
  heal: '#6dff8a',
  magnet: '#5dd0ff',
  bomb: '#ff6a4d',
  chest: '#ffd84a',
  cache: '#d58bff',
}
