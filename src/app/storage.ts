import { defaultSave, parseSave, serializeSave, type Lang, type SaveData } from '../game/progress'

/** 存档读写。localStorage 不可用（隐私模式 / 配额）时退化为内存存档，游戏照常可玩。 */

const KEY = 'neon-surge:v1'
const CORRUPT_KEY = 'neon-surge:v1:corrupt'

let memory: string | null = null
let storageOk = true

export function detectLang(): Lang {
  // 以页面路径为准（/en/ 为英文），其次看浏览器语言
  const path = location.pathname
  if (path.startsWith('/en')) return 'en'
  if (document.documentElement.lang.toLowerCase().startsWith('en')) return 'en'
  return 'zh'
}

export function loadSave(lang: Lang): SaveData {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    storageOk = false
    raw = memory
  }
  if (raw) {
    try {
      JSON.parse(raw)
    } catch {
      // 存档损坏：留一份备份再用默认存档，避免悄悄丢数据
      try {
        localStorage.setItem(CORRUPT_KEY, raw)
      } catch {
        /* 忽略 */
      }
      return defaultSave(lang)
    }
  }
  return parseSave(raw, lang)
}

export function writeSave(s: SaveData): void {
  const json = serializeSave(s)
  memory = json
  if (!storageOk) return
  try {
    localStorage.setItem(KEY, json)
  } catch {
    storageOk = false
  }
}

export const isPersistent = (): boolean => storageOk
