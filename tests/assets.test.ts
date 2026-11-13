import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ENEMIES } from '../src/data/enemies'
import { BOSS_IDS, ENEMY_IDS, PICKUP_IDS, SHIP_IDS } from '../src/data/ids'
import { PICKUP_COLOR } from '../src/data/pickups'
import { tIn } from '../src/i18n'
import { CREATURES } from '../src/render/creatures'
import { SHIP_ART } from '../src/render/shipart'

const spriteFile = (name: string): string => fileURLToPath(new URL(`../public/img/sprites/${name}.webp`, import.meta.url))

test('每个敌人都有对应的生物设计（外形不允许回退成通用图形）', () => {
  for (const id of ENEMY_IDS) {
    const shape = ENEMIES[id].shape
    assert.ok(CREATURES[shape], `${id} 的 shape=${shape} 没有对应的 CREATURES 条目`)
    const c = CREATURES[shape]
    assert.ok(c.scale >= 1 && c.reach >= 1, `${shape}: scale / reach 必须 ≥ 1（美术半径不小于判定半径）`)
  }
  // 反过来：没有闲置的设计
  const used = new Set(ENEMY_IDS.map((id) => ENEMIES[id].shape))
  for (const shape of Object.keys(CREATURES)) assert.ok(used.has(shape as never), `CREATURES.${shape} 没有被任何敌人使用`)
})

test('每艘飞船都有部件设计和喷口', () => {
  for (const id of SHIP_IDS) {
    const art = SHIP_ART[id]
    assert.ok(art, `${id} 缺少 SHIP_ART`)
    assert.ok(art.engines.length >= 2, `${id} 至少要有两个喷口`)
    assert.ok(art.reach > 1, `${id} reach 不合法`)
  }
})

test('玩法指南用的立绘齐全（改了美术或新增条目后请运行 node scripts/gen-sprites.mjs）', () => {
  const names = [
    ...ENEMY_IDS.map((id) => `enemy-${id}`),
    ...SHIP_IDS.map((id) => `ship-${id}`),
    ...BOSS_IDS.map((id) => `boss-${id}`),
    ...PICKUP_IDS.map((id) => `pickup-${id}`),
  ]
  for (const name of names) {
    const f = spriteFile(name)
    assert.ok(existsSync(f), `缺少 public/img/sprites/${name}.webp`)
    const size = statSync(f).size
    assert.ok(size > 1500 && size < 60_000, `${name}.webp 大小异常：${size} B`)
  }
})

test('每种拾取物都有识别色、双语名称和指南立绘', () => {
  const hex = /^#[0-9a-f]{6}$/i
  const seen = new Set<string>()
  for (const id of PICKUP_IDS) {
    assert.match(PICKUP_COLOR[id], hex, `${id} 缺少合法的识别色`)
    // 五种拾取物各自一个颜色：光晕里靠颜色、轮廓里靠形状，两条线索都不能撞车
    assert.ok(!seen.has(PICKUP_COLOR[id]), `${id} 的颜色和别的拾取物重复`)
    seen.add(PICKUP_COLOR[id])
    for (const lang of ['zh', 'en'] as const) assert.ok(tIn(lang, `pickup.${id}`) && tIn(lang, `pickup.${id}`) !== `pickup.${id}`, `${lang} 缺少 pickup.${id} 的名称`)
  }
})
