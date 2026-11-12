import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACHIEVEMENTS } from '../src/data/achievements'
import { METAS, metaCost } from '../src/data/meta'
import { SHIPS } from '../src/data/ships'
import {
  buyMeta,
  buyShip,
  defaultSave,
  isSectorUnlocked,
  maxSelectableThreat,
  parseSave,
  refundMeta,
  runCores,
  sanitize,
  serializeSave,
  settleRun,
  type RunSummary,
} from '../src/game/progress'
import type { RunStats } from '../src/game/world'

const stats = (o: Partial<RunStats> = {}): RunStats => ({
  kills: 0,
  time: 0,
  level: 1,
  evolves: 0,
  dashes: 0,
  noHitBest: 0,
  damageTaken: 0,
  bossKilled: false,
  maxWeapons: 1,
  cleared: false,
  killedBy: '',
  hurtBy: {},
  ...o,
})

const run = (o: Omit<Partial<RunSummary>, 'stats'> & { stats?: Partial<RunStats> } = {}): RunSummary => ({
  ship: 'vanguard',
  sector: 'fields',
  threat: 0,
  endless: false,
  bonusCores: 0,
  ...o,
  stats: stats(o.stats),
})

test('存档：任意垃圾输入都能回退为合法默认存档', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { cores: 'a' }, { meta: 7 }]) {
    const s = sanitize(bad)
    assert.equal(s.v, 1)
    assert.ok(s.ships.includes('vanguard'))
    assert.equal(s.cores, 0)
  }
  assert.deepEqual(parseSave('not json').ships, ['vanguard'])
  assert.deepEqual(parseSave(null).ships, ['vanguard'])
})

test('存档：数值被钳制，未知字段被丢弃，往返无损', () => {
  const s = sanitize({
    cores: -50,
    lifetimeCores: 1e20,
    meta: { m_power: 99, m_hull: -3, bogus: 4 },
    ships: ['reaper', 'nope'],
    maxThreat: { fields: 99, wasteland: -9 },
    settings: { master: 5, music: -1, quality: 'ultra', lang: 'fr' },
    ach: { kills_100: 123, ghost: 1 },
    last: { ship: 'ghost', sector: 'void', threat: 3 },
  })
  assert.equal(s.cores, 0)
  assert.ok(s.lifetimeCores <= 1e9)
  assert.equal(s.meta.m_power, METAS.m_power.max)
  assert.equal(s.meta.m_hull, undefined)
  assert.ok(!('bogus' in s.meta))
  assert.deepEqual(s.ships, ['vanguard', 'reaper'])
  assert.equal(s.settings.master, 1)
  assert.equal(s.settings.music, 0)
  assert.equal(s.settings.quality, 'auto')
  assert.equal(s.settings.lang, 'zh')
  assert.ok('kills_100' in s.ach && !('ghost' in s.ach))
  // 未通关任何星区：不允许记住一个尚未解锁的星区 / 不存在的飞船
  assert.equal(s.last.sector, 'fields')
  assert.equal(s.last.ship, 'vanguard')
  const again = parseSave(serializeSave(s))
  assert.deepEqual(again, s)
})

test('存档：已通关次数与最高威胁自洽', () => {
  const s = sanitize({ clears: { fields: 2 }, maxThreat: { fields: -1 } })
  assert.equal(s.maxThreat.fields, 0)
  const t = sanitize({ clears: { fields: 0 }, maxThreat: { fields: 2 } })
  assert.equal(t.maxThreat.fields, -1)
})

test('晶核结算：随表现单调上升，倍率生效，≥45 秒有保底', () => {
  const low = runCores(stats({ time: 60, kills: 50, level: 3 }), 'fields', 0, 1, 0)
  const high = runCores(stats({ time: 600, kills: 5000, level: 36, evolves: 2, bossKilled: true }), 'fields', 0, 1, 0)
  assert.ok(high.total > low.total * 5)
  assert.ok(runCores(stats({ time: 30 }), 'fields', 0, 1, 0).total < 10, '很短的一局只有零头')
  assert.equal(runCores(stats({ time: 46 }), 'fields', 0, 1, 0).total, 25)
  const hard = runCores(stats({ time: 600, kills: 5000, level: 36, bossKilled: true }), 'void', 3, 1, 0)
  const easy = runCores(stats({ time: 600, kills: 5000, level: 36, bossKilled: true }), 'fields', 0, 1, 0)
  assert.ok(hard.total > easy.total * 4)
  assert.ok(runCores(stats({ time: 300 }), 'fields', 0, 1.4, 100).total > runCores(stats({ time: 300 }), 'fields', 0, 1, 100).total)
})

test('结算：发放晶核、更新累计与记录', () => {
  const s = defaultSave()
  const r = settleRun(s, run({ stats: { time: 200, kills: 300, level: 9 }, bonusCores: 40 }), 1)
  assert.ok(r.cores.total > 40)
  assert.equal(s.totals.runs, 1)
  assert.equal(s.totals.deaths, 1)
  assert.equal(s.totals.kills, 300)
  assert.equal(s.bestTime.fields, 200)
  assert.ok(r.records.time && r.records.kills)
  assert.equal(s.cores, s.lifetimeCores)
  assert.equal(s.cores, r.cores.total + r.achCores)
  const r2 = settleRun(s, run({ stats: { time: 100, kills: 10 } }), 2)
  assert.ok(!r2.records.time && !r2.records.kills)
  assert.equal(s.bestTime.fields, 200)
})

test('结算：通关解锁下一星区与更高威胁，重复通关不重复解锁', () => {
  const s = defaultSave()
  assert.ok(!isSectorUnlocked(s, 'wasteland'))
  assert.equal(maxSelectableThreat(s, 'fields'), 0)
  const r = settleRun(s, run({ stats: { time: 610, kills: 4000, level: 30, bossKilled: true, cleared: true } }), 1)
  assert.equal(r.unlockedSector, 'wasteland')
  assert.equal(r.unlockedThreat, 1)
  assert.ok(isSectorUnlocked(s, 'wasteland'))
  assert.equal(maxSelectableThreat(s, 'fields'), 1)
  assert.equal(s.clears.fields, 1)
  const r2 = settleRun(s, run({ stats: { time: 610, kills: 4000, level: 30, bossKilled: true, cleared: true } }), 2)
  assert.equal(r2.unlockedSector, null)
  assert.equal(r2.unlockedThreat, null)
  const r3 = settleRun(s, run({ threat: 1, stats: { time: 610, kills: 4000, level: 30, bossKilled: true, cleared: true } }), 3)
  assert.equal(r3.unlockedThreat, 2)
  assert.equal(s.maxThreat.fields, 1)
})

test('结算：无尽模式不影响通关次数，只更新无尽记录', () => {
  const s = defaultSave()
  s.clears.fields = 1
  s.maxThreat.fields = 0
  const r = settleRun(s, run({ endless: true, stats: { time: 900, kills: 7000, level: 40, bossKilled: true } }), 1)
  assert.equal(s.clears.fields, 1)
  assert.equal(s.bestEndless.fields, 900)
  assert.ok(r.records.endless)
  assert.equal(s.bestTime.fields, 0)
})

test('成就：达成即发奖励，只发一次；奖励可连锁触发其它成就；飞船随成就解锁', () => {
  const s = defaultSave()
  const r = settleRun(s, run({ stats: { time: 190, kills: 120, level: 11 } }), 1)
  const ids = r.newAch.map((a) => a.id)
  assert.ok(ids.includes('kills_100') && ids.includes('survive_3') && ids.includes('level_10'))
  assert.equal(r.achCores, r.newAch.reduce((a, b) => a + b.reward, 0))
  const r2 = settleRun(s, run({ stats: { time: 190, kills: 120, level: 11 } }), 2)
  assert.equal(r2.newAch.length, 0)

  const t = defaultSave()
  const r3 = settleRun(t, run({ stats: { time: 310, kills: 600, level: 12 } }), 1)
  assert.ok(r3.newAch.some((a) => a.id === 'survive_5'))
  assert.ok(r3.unlockedShips.includes('phantom'))
  assert.ok(t.ships.includes('phantom'))

  const u = defaultSave()
  u.lifetimeCores = 1990
  const r4 = settleRun(u, run({ stats: { time: 120, kills: 100 } }), 1)
  assert.ok(r4.newAch.some((a) => a.id === 'rich'))
})

test('成就：每一条都能被满足（不存在永远无法解锁的成就）', () => {
  for (const a of ACHIEVEMENTS) {
    const s = defaultSave()
    // 构造一个足够好的存档去触发
    s.best = { time: 9999, kills: 99999, level: 99, evolves: 9, weapons: 6, noHit: 999, dashes: 999 }
    s.totals = { runs: 99, wins: 9, deaths: 9, kills: 99999, time: 1, evolves: 1, dashes: 1 }
    s.lifetimeCores = 99999
    s.clears = { fields: 1, wasteland: 1, void: 1 }
    s.maxThreat = { fields: 3, wasteland: 3, void: 3 }
    const r = settleRun(s, run({ stats: { time: 1 } }), 1)
    assert.ok(s.ach[a.id], `成就 ${a.id} 无法被触发`)
    assert.ok(r.newAch.length > 0)
  }
})

test('机库：购买扣费、不超上限、不够钱不能买，退还原数返还', () => {
  const s = defaultSave()
  s.cores = 1000
  assert.ok(buyMeta(s, 'm_power'))
  assert.equal(s.cores, 1000 - metaCost(METAS.m_power, 0))
  assert.equal(s.meta.m_power, 1)
  const poor = defaultSave()
  poor.cores = 10
  assert.ok(!buyMeta(poor, 'm_power'))
  const rich = defaultSave()
  rich.cores = 1e6
  for (let i = 0; i < 20; i++) buyMeta(rich, 'm_reroll')
  assert.equal(rich.meta.m_reroll, METAS.m_reroll.max)
  const before = rich.cores
  const spent = 1e6 - before
  assert.equal(refundMeta(rich), spent)
  assert.equal(rich.cores, 1e6)
  assert.deepEqual(rich.meta, {})
})

test('飞船：购买扣费、不能重复买、不够钱不能买', () => {
  const s = defaultSave()
  assert.ok(!buyShip(s, 'vanguard'))
  assert.ok(!buyShip(s, 'phantom'))
  s.cores = SHIPS.phantom.cost + 5
  assert.ok(buyShip(s, 'phantom'))
  assert.equal(s.cores, 5)
  assert.ok(!buyShip(s, 'phantom'))
  assert.deepEqual(s.ships, ['vanguard', 'phantom'])
})
