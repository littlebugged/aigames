import type { Lang } from '../game/progress'
import { en } from './en'
import { zh, type Key } from './zh'

export type { Key } from './zh'

const dicts: Record<Lang, Record<Key, string>> = { zh, en }
let lang: Lang = 'zh'
const listeners = new Set<(l: Lang) => void>()

export function getLang(): Lang {
  return lang
}

export function setLang(l: Lang): void {
  if (l === lang) return
  lang = l
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
  listeners.forEach((f) => f(l))
}

export function onLangChange(f: (l: Lang) => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** 翻译。{name} 形式的占位符用 params 替换；缺失的 key 原样返回，方便发现遗漏。 */
export function t(key: Key, params?: Record<string, string | number>): string {
  const s = dicts[lang][key] ?? dicts.zh[key] ?? key
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`))
}

/** 在指定语言下翻译（构建站点页面时用，不依赖全局语言状态） */
export function tIn(l: Lang, key: Key, params?: Record<string, string | number>): string {
  const s = dicts[l][key] ?? key
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`))
}

/** 动态 key 的类型安全入口：调用方保证拼出来的 key 存在（测试里会校验覆盖率）。 */
export const dyn = (k: string): Key => k as Key

/** 把秒格式化成 m:ss */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 大数字：1234 → 1,234 */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')
}

export const dictKeys = Object.keys(zh) as Key[]
