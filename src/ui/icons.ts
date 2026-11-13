import type { PassiveId, WeaponId } from '../data/ids'

/**
 * 内联 SVG 图标（24×24，描边风格，颜色跟随 currentColor）。
 * 只返回字符串，不碰 DOM，所以 Node 里生成静态页面时也能用。
 */

export const WEAPON_ICON: Record<WeaponId, string> = {
  pulse:
    '<path d="M4 7h9M4 12h13M4 17h9"/><circle cx="17" cy="7" r="1.3"/><circle cx="20.5" cy="12" r="1.3"/><circle cx="17" cy="17" r="1.3"/>',
  orbit:
    '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/><path d="M12 2.5l2 2-2 2-2-2zM12 17.5l2 2-2 2-2-2z"/>',
  arc: '<path d="M13 2L5 13h6l-1 9 9-12h-6z"/>',
  missile:
    '<path d="M12 2c3 3 3.5 7 3 11H9c-.5-4 0-8 3-11z"/><path d="M9 13l-3 4 3-1M15 13l3 4-3-1M12 16v5"/><circle cx="12" cy="8" r="1.4"/>',
  laser: '<path d="M3 12h6M15 7l6-3M15 12h6M15 17l6 3"/><path d="M9 6l6 6-6 6z"/>',
  mine: '<circle cx="12" cy="12" r="5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="1.3"/>',
  nova: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10" opacity=".6"/>',
  drone: '<path d="M12 5l5 12-5-3-5 3z"/><circle cx="12" cy="12" r="9" stroke-dasharray="2 4"/>',
  chakram: '<path d="M12 2.5l2.3 7.2L21.5 12l-7.2 2.3L12 21.5l-2.3-7.2L2.5 12l7.2-2.3z"/><circle cx="12" cy="12" r="1.7"/>',
  rail: '<path d="M2 7.5h20M2 16.5h20"/><path d="M5 12h13M15 8.8l3.4 3.2-3.4 3.2"/>',
}

export const PASSIVE_ICON: Record<PassiveId, string> = {
  power: '<path d="M12 2l2.6 6.4L21 9l-5 4.5L17.5 21 12 17.3 6.5 21 8 13.5 3 9l6.4-.6z"/>',
  haste: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
  hull: '<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z"/>',
  armor: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v8"/>',
  thruster: '<path d="M12 2c1 4 5 6 5 11a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4 0-7 1-10z"/>',
  magnet: '<path d="M6 3v9a6 6 0 0012 0V3h-4v9a2 2 0 01-4 0V3z"/><path d="M6 7h4M14 7h4"/>',
  regen: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>',
  area: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="2.5"/>',
  learning: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c3 2.5 9 2.5 12 0v-4.5"/>',
  luck: '<circle cx="9" cy="9" r="3.4"/><circle cx="15" cy="9" r="3.4"/><circle cx="9" cy="15" r="3.4"/><circle cx="15" cy="15" r="3.4"/><path d="M12 12l6 9"/>',
  accel: '<path d="M3.5 17a9 9 0 1117 0"/><path d="M12 17l4-6"/><circle cx="12" cy="17" r="1.2"/>',
  multi: '<path d="M12 21V12M12 12L5 5M12 12l7-7M5 5v4M5 5h4M19 5v4M19 5h-4"/>',
}

export const UI_ICON = {
  pause: '<path d="M8 5v14M16 5v14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  core: '<path d="M12 2l8 6-8 14L4 8z"/><path d="M4 8h16M9 8l3 14M15 8l-3 14" opacity=".6"/>',
  dash: '<path d="M4 12h12M12 6l6 6-6 6M3 7h4M3 17h4"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  trophy:
    '<path d="M7 4h10v5a5 5 0 01-10 0z"/><path d="M7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M9 21h6M12 14v7"/>',
  hangar: '<path d="M12 3l9 5v8l-9 5-9-5V8z"/><path d="M12 12l9-4M12 12v9M12 12L3 8"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 6M20 4v7h-7"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="9" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  download: '<path d="M12 3v12M7 10.5l5 5 5-5M5 20h14"/>',
  book: '<path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-7a3 3 0 00-3 3"/><path d="M20 4v14h-8"/>',
  heal: '<path d="M12 4v16M4 12h16"/>',
  skull: '<path d="M12 3a8 8 0 00-8 8c0 3 1.6 5 4 6v3h8v-3c2.4-1 4-3 4-6a8 8 0 00-8-8z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  swords: '<path d="M4 4l9 9M20 4l-9 9M7 14l-3 3 3 3 3-3M17 14l3 3-3 3-3-3"/>',
  infinity: '<path d="M12 12c-2-3-3.5-4-5.5-4a4 4 0 000 8c2 0 3.5-1 5.5-4zm0 0c2 3 3.5 4 5.5 4a4 4 0 000-8c-2 0-3.5 1-5.5 4z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  tutorial: '<path d="M12 3a6 6 0 00-3 11.2V17h6v-2.8A6 6 0 0012 3z"/><path d="M10 21h4"/>',
} as const

export type UiIconName = keyof typeof UI_ICON

const wrap = (inner: string, cls = '', fill = false): string =>
  `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

export const weaponIcon = (id: WeaponId, cls = ''): string => wrap(WEAPON_ICON[id], cls)
export const passiveIcon = (id: PassiveId, cls = ''): string => wrap(PASSIVE_ICON[id], cls)
export const uiIcon = (name: UiIconName, cls = ''): string => wrap(UI_ICON[name], cls)
