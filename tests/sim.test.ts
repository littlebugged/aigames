import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SECTOR_IDS, SHIP_IDS } from '../src/data/ids'
import { Bot } from '../src/game/bot'
import type { InputState } from '../src/game/entities'
import { World, type RunConfig } from '../src/game/world'

function play(cfg: RunConfig, seconds: number, skill = 1): World {
  const w = new World(cfg)
  const bot = new Bot(cfg.seed, skill)
  const input: InputState = { mx: 0, my: 0, dash: false }
  const dt = 1 / 60
  while (w.phase !== 'won' && w.phase !== 'lost' && w.time < seconds) {
    if (w.phase === 'levelup') {
      w.choose(bot.pick(w))
      continue
    }
    bot.drive(w, dt, input)
    w.update(dt, input)
  }
  return w
}

const base: RunConfig = { seed: 1, ship: 'vanguard', sector: 'fields', threat: 0, meta: {} }

test('确定性：相同种子 + 相同机器人 → 完全相同的结果', () => {
  const a = play({ ...base, seed: 42 }, 120)
  const b = play({ ...base, seed: 42 }, 120)
  assert.equal(a.stats.kills, b.stats.kills)
  assert.equal(a.player.level, b.player.level)
  assert.equal(a.enemies.length, b.enemies.length)
  assert.equal(a.player.x, b.player.x)
  const c = play({ ...base, seed: 43 }, 120)
  assert.notEqual(a.player.x, c.player.x)
})

test('稳定性：所有飞船 × 星区跑 100 秒，无 NaN、无崩溃', () => {
  for (const ship of SHIP_IDS) {
    for (const sector of SECTOR_IDS) {
      const w = play({ ...base, ship, sector, seed: 7 }, 100)
      assert.ok(Number.isFinite(w.player.x) && Number.isFinite(w.player.hp), `${ship}/${sector}`)
      for (const e of w.enemies) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.hp))
      assert.ok(w.enemies.length <= 330)
    }
  }
})

test('进程：Boss 在设定时间出现，并且能被击败', () => {
  const w = play({ ...base, seed: 1 }, 400)
  assert.ok(w.time > 100)
  const full = play({ ...base, seed: 1, meta: { m_power: 5, m_hull: 5 } }, 900)
  assert.ok(full.stats.bossKilled || full.phase === 'lost', 'Boss 战应该有结论')
})

test('升级流程：升级暂停世界，选卡后恢复', () => {
  const w = new World(base)
  const input: InputState = { mx: 0, my: 0, dash: false }
  w.addXp(1000)
  w.update(1 / 60, input)
  assert.equal(w.phase, 'levelup')
  const t = w.time
  w.update(1 / 60, input)
  assert.equal(w.time, t, '升级选卡期间时间不应流逝')
  assert.ok(w.offers.length >= 3)
  while (w.phase === 'levelup') w.choose(0)
  assert.equal(w.phase, 'play')
})

test('重抽与放逐：次数消耗正确，放逐的卡不再出现', () => {
  const w = new World({ ...base, meta: { m_reroll: 2, m_banish: 1 } })
  const input: InputState = { mx: 0, my: 0, dash: false }
  w.addXp(50)
  w.update(1 / 60, input)
  assert.equal(w.phase, 'levelup')
  assert.equal(w.rerolls, 2)
  assert.ok(w.reroll())
  assert.equal(w.rerolls, 1)
  const first = w.offers[0]
  const key = JSON.stringify(first)
  assert.ok(w.banish(0))
  assert.equal(w.banishes, 0)
  assert.ok(!w.banish(0), '放逐次数用完后不能再放逐')
  for (let i = 0; i < 20; i++) {
    w.reroll()
    if (w.rerolls === 0) break
  }
  assert.ok(!w.offers.some((o) => JSON.stringify(o) === key) || first.kind === 'heal' || first.kind === 'cores')
})

test('复活：有复活次数时致命伤会触发复活而不是失败', () => {
  const w = new World({ ...base, meta: { m_revive: 1 } })
  assert.equal(w.revives, 1)
  w.hurtPlayer(1e6, 0, 0, 'drone')
  assert.equal(w.phase, 'play')
  assert.equal(w.revives, 0)
  assert.ok(w.player.hp > 0)
  w.player.invuln = 0
  w.hurtPlayer(1e6, 0, 0, 'drone')
  assert.equal(w.phase, 'lost')
  assert.equal(w.stats.killedBy, 'drone')
})

test('模拟层不依赖浏览器 API（DOM-free）', () => {
  const forbidden = /\b(document|window|localStorage|sessionStorage|AudioContext|requestAnimationFrame|navigator)\b/
  const roots = ['src/game', 'src/data', 'src/engine/rng.ts', 'src/engine/math.ts', 'src/engine/grid.ts', 'src/engine/pool.ts']
  const files: string[] = []
  const walk = (p: string): void => {
    if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f))
    else if (p.endsWith('.ts')) files.push(p)
  }
  for (const r of roots) walk(r)
  assert.ok(files.length > 15)
  for (const f of files) {
    const code = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    assert.ok(!forbidden.test(code), `${f} 使用了浏览器 API`)
  }
})
