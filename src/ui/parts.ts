import { fmtInt, t } from '../i18n'
import { h, iconEl } from './dom'

/** 晶核数量小标签 */
export function coresChip(get: () => number): { el: HTMLElement; update(): void } {
  const num = h('b', null, '0')
  const el = h('div', { class: 'chip cores', title: t('common.cores') }, iconEl('core'), num)
  let last = -1
  return {
    el,
    update() {
      const v = get()
      if (v !== last) {
        num.textContent = fmtInt(v)
        last = v
      }
    },
  }
}

/** 横向数值条（0~1） */
export function statBar(label: string, v: number, color: string, valueText?: string): HTMLElement {
  return h(
    'div',
    { class: 'stat' },
    h('span', { class: 'stat-l' }, label),
    h(
      'span',
      { class: 'stat-bar' },
      h('i', { style: { width: `${Math.round(Math.max(0.06, Math.min(1, v)) * 100)}%`, background: color, boxShadow: `0 0 10px ${color}` } }),
    ),
    valueText ? h('span', { class: 'stat-v' }, valueText) : null,
  )
}

/** 等级小点 */
export function pips(level: number, max: number, color?: string): HTMLElement {
  const wrap = h('span', { class: 'pips' })
  for (let i = 0; i < max; i++) {
    const p = h('i', { class: i < level ? 'on' : '' })
    if (i < level && color) p.style.background = color
    wrap.appendChild(p)
  }
  return wrap
}

/** 页面顶栏：返回按钮 + 标题 + 右侧内容 */
export function screenHead(title: string, onBack: () => void, right?: Node | null): HTMLElement {
  return h(
    'div',
    { class: 'scr-head' },
    h('button', { class: 'btn ghost back', onClick: onBack, 'aria-label': t('common.back') }, '‹ ', t('common.back')),
    h('h2', null, title),
    h('div', { class: 'scr-head-r' }, right ?? null),
  )
}
