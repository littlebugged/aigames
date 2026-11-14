import type { HazardId } from './ids'

/** 弹幕 / 危险物的识别色：画面里的子弹颜色与指南页的名牌共用同一份（子弹的实际颜色由发射方指定，这里取最常见的那种） */
export const HAZARD_COLOR: Record<HazardId, string> = {
  glob: '#ffd84a',
  lens: '#ff3ea5',
  needle: '#ff6a8a',
  shard: '#9dff4d',
  fang: '#c9a0ff',
  ember: '#ff8a3d',
  beam: '#9dff4d',
  ring: '#c9a0ff',
}
