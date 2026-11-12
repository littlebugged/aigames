import { uiIcon, type UiIconName } from './icons'

type Child = Node | string | number | null | undefined | false
type Attrs = Record<string, unknown> | null | undefined

/** 极简 DOM 构建：h('div', { class: 'x', onClick: fn }, child, ...) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'class') el.className = String(v)
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v as object)
      else if (k === 'html') el.innerHTML = String(v)
      else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
      } else el.setAttribute(k, v === true ? '' : String(v))
    }
  }
  append(el, kids)
  return el
}

export function append(el: Element, kids: Child[]): void {
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)))
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild)
}

/** 把内联 SVG 字符串变成元素 */
export function svgEl(html: string): HTMLElement {
  const s = document.createElement('span')
  s.className = 'ico-wrap'
  s.innerHTML = html
  return s
}

export const iconEl = (name: UiIconName, cls = ''): HTMLElement => svgEl(uiIcon(name, cls))

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel)
  if (!el) throw new Error(`missing element: ${sel}`)
  return el
}

/** 空间导航：在可聚焦元素间按方向移动焦点（方向键 / 手柄十字键用） */
export function moveFocus(root: HTMLElement, dir: 'left' | 'right' | 'up' | 'down'): void {
  const items = Array.from(
    root.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"], input, select, a[href]'),
  ).filter((e) => e.offsetParent !== null)
  if (items.length === 0) return
  const cur = document.activeElement as HTMLElement | null
  if (!cur || !items.includes(cur)) {
    items[0].focus({ preventScroll: true })
    return
  }
  const cr = cur.getBoundingClientRect()
  const cx = cr.left + cr.width / 2
  const cy = cr.top + cr.height / 2
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const it of items) {
    if (it === cur) continue
    const r = it.getBoundingClientRect()
    const dx = r.left + r.width / 2 - cx
    const dy = r.top + r.height / 2 - cy
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy
    if (along < 4) continue
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    const score = along + across * 2.2
    if (score < bestScore) {
      bestScore = score
      best = it
    }
  }
  best?.focus({ preventScroll: true })
}
