import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACHIEVEMENTS } from '../src/data/achievements'
import {
  BOSS_IDS,
  ENEMY_IDS,
  META_IDS,
  PASSIVE_IDS,
  SECTOR_IDS,
  SHIP_IDS,
  WEAPON_IDS,
} from '../src/data/ids'
import { THREAT_LEVELS } from '../src/data/sectors'
import { en } from '../src/i18n/en'
import { zh } from '../src/i18n/zh'

const zhKeys = Object.keys(zh)
const enKeys = Object.keys(en)

test('中英文词典 key 完全一致', () => {
  assert.deepEqual([...zhKeys].sort(), [...enKeys].sort())
})

test('占位符在两种语言里一致', () => {
  const ph = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
  for (const k of zhKeys) {
    assert.equal(ph((zh as Record<string, string>)[k]), ph((en as Record<string, string>)[k]), `占位符不一致：${k}`)
  }
})

test('没有空字符串', () => {
  for (const [k, v] of Object.entries(zh)) assert.ok(v.trim().length > 0, `zh 空：${k}`)
  for (const [k, v] of Object.entries(en)) assert.ok(v.trim().length > 0, `en 空：${k}`)
})

test('所有内容 id 都有名称与描述', () => {
  const need = (k: string): void => {
    assert.ok(k in zh, `缺少 ${k}`)
  }
  for (const id of WEAPON_IDS) for (const s of ['name', 'desc', 'evoName', 'evoDesc']) need(`weapon.${id}.${s}`)
  for (const id of PASSIVE_IDS) for (const s of ['name', 'desc']) need(`passive.${id}.${s}`)
  for (const id of SHIP_IDS) for (const s of ['name', 'desc', 'tag']) need(`ship.${id}.${s}`)
  for (const id of SECTOR_IDS) for (const s of ['name', 'desc']) need(`sector.${id}.${s}`)
  for (const id of ENEMY_IDS) for (const s of ['name', 'desc']) need(`enemy.${id}.${s}`)
  for (const id of BOSS_IDS) for (const s of ['name', 'desc']) need(`boss.${id}.${s}`)
  for (const id of META_IDS) for (const s of ['name', 'desc']) need(`meta.${id}.${s}`)
  for (const a of ACHIEVEMENTS) for (const s of ['name', 'desc']) need(`ach.${a.id}.${s}`)
  for (let i = 0; i < THREAT_LEVELS.length; i++) need(`threat.${i}.name`)
  for (const k of ['damage', 'cooldown', 'count', 'pierce', 'area', 'duration', 'range', 'knock', 'chain', 'tick', 'blast']) need(`stat.${k}`)
  for (const k of ['bullet', 'beam', 'ring', 'blast']) need(`src.${k}`)
  for (const k of ['ring', 'wall', 'elite', 'boss']) need(`warn.${k}`)
})
