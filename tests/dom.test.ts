import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyStyle } from '../src/ui/dom'

/** 一个最小的 style 替身：记录 setProperty 调用，并允许普通属性直接赋值 */
function fakeEl(): { el: HTMLElement; props: Map<string, string>; style: Record<string, unknown> } {
  const props = new Map<string, string>()
  const style: Record<string, unknown> = {
    setProperty: (k: string, v: string) => props.set(k, v),
  }
  return { el: { style } as unknown as HTMLElement, props, style }
}

test('applyStyle：CSS 自定义属性必须走 setProperty（Object.assign 对 --c 无效，曾让所有主题色落空）', () => {
  const { el, props, style } = fakeEl()
  applyStyle(el, { '--c': '#ff9b3d', '--glow': 'rgba(1,2,3,.5)' })
  assert.equal(props.get('--c'), '#ff9b3d')
  assert.equal(props.get('--glow'), 'rgba(1,2,3,.5)')
  assert.equal(style['--c'], undefined, '不能把自定义属性当成普通 JS 属性挂上去')
})

test('applyStyle：普通样式属性直接赋值，空值被跳过', () => {
  const { el, props, style } = fakeEl()
  applyStyle(el, { width: '12px', opacity: 0.5, height: undefined, color: null, display: false })
  assert.equal(style.width, '12px')
  assert.equal(style.opacity, '0.5')
  assert.ok(!('height' in style) && !('color' in style) && !('display' in style))
  assert.equal(props.size, 0)
})

test('applyStyle：自定义属性与普通属性可以混着写', () => {
  const { el, props, style } = fakeEl()
  applyStyle(el, { '--c': 'red', left: '3px' })
  assert.equal(props.get('--c'), 'red')
  assert.equal(style.left, '3px')
})
