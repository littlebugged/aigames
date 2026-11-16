import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENEMIES } from '../src/data/enemies'
import { SECTOR_IDS } from '../src/data/ids'
import { SECTORS } from '../src/data/sectors'
import { SURGE, TUNE, WELL } from '../src/data/tuning'
import { FLOW, WAVE, waveUnit } from '../src/data/waves'
import { BOSS_R, spawnBoss } from '../src/game/bosses'
import type { Director } from '../src/game/director'
import type { Boss, InputState } from '../src/game/entities'
import type { GameEvent } from '../src/game/events'
import { World } from '../src/game/world'

/**
 * v1.14「割草·波次」：导演按 12 波的脚本放出一个个脉冲，每波结束放浪涌，
 * 升级攒到波尾统一选，小 Boss / 特殊兵种 / 引力井 / 伏击各有各的规矩。
 */

const input: InputState = { mx: 0, my: 0, dash: false }
const DT = 1 / 60

/** 关掉人潮补兵（只看脉冲 / 机关本身；补兵出来的怪会混进被测的数字里，也会复用对象池里刚死的敌人）；用完自动还原 */
const flowOff = (fn: () => void) => (): void => {
  const k = FLOW.k
  FLOW.k = 0
  try {
    fn()
  } finally {
    FLOW.k = k
  }
}

function make(sector: (typeof SECTOR_IDS)[number] = 'fields', extra: Partial<ConstructorParameters<typeof World>[0]> = {}) {
  const w = new World({ seed: 7, ship: 'vanguard', sector, threat: 0, meta: {}, ...extra })
  const events: GameEvent[] = []
  w.sink = (e) => events.push(e)
  return { w, events }
}

const dir = (w: World): Director => w.director

/** 只推导演（不更新世界）：飞快地走完脚本，用来检查节奏 */
function drive(w: World, seconds: number, step = 0.5, each?: () => void): void {
  for (let t = 0; t < seconds; t += step) {
    dir(w).update(w, step)
    each?.()
  }
}

/** 无敌、没有武器的玩家：世界完整运行，只看导演和机关 */
function pacifist(w: World): void {
  const p = w.player
  p.weapons.length = 0
  w.recalc()
  p.hp = p.maxHp = 1e9
}

/** 推进世界一步；遇到升级卡就随手选第一张（别让世界卡在选卡阶段） */
function tick(w: World): void {
  if (w.phase === 'levelup') w.choose(0)
  w.player.hp = w.player.maxHp
  w.update(DT, input)
}

/** 取当前 Boss（避免 TS 把 w.boss 窄化成 null） */
const bossOf = (w: World): Boss | null => w.boss

const waves = (events: GameEvent[]) => events.filter((e): e is Extract<GameEvent, { t: 'wave' }> => e.t === 'wave')

// ───────────────────────── 导演：波的节奏 ─────────────────────────

test('导演：第 1 波一开局就来，按脚本的时长一波接一波，12 波之后放出本星区的 Boss', () => {
  for (const sid of SECTOR_IDS) {
    const { w, events } = make(sid)
    const sc = SECTORS[sid]
    drive(w, sc.length - 1)
    const early = bossOf(w)
    assert.ok(!early || early.mini > 0, `${sid}：12 波没走完不该有正主（小 Boss 除外）`)
    drive(w, 2)
    const main = bossOf(w)
    assert.ok(main && main.alive && main.mini === 0 && main.id === sc.boss, `${sid}：波次走完应当放出 ${sc.boss}`)
    const ws = waves(events)
    assert.deepEqual(
      ws.map((e) => e.n),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      `${sid}：每波一条 wave 事件`,
    )
    assert.ok(ws.every((e) => e.total === 12))
    assert.deepEqual(
      ws.map((e) => e.tag),
      sc.waves.map((x) => x.tag),
    )
    // 每一波的开始时间 = 前面各波时长之和
    let at = 0
    for (let i = 0; i < ws.length; i++) {
      assert.equal(ws[i].tag, sc.waves[i].tag)
      at += sc.waves[i].len
    }
    assert.equal(at, sc.length)
  }
})

test('导演：脉冲在波内按脚本均匀排开，数量 = 单位量 × 权重 × 星区密度 × 威胁倍率（有上限）', flowOff(() => {
  const { w } = make('fields')
  // 第 1 波第 1 个脉冲是 stream/drone × 1.0：先看它一共放出多少
  const pd = SECTORS.fields.waves[0].pulses[0]
  const expect = Math.min(WAVE.maxPulse, Math.round(waveUnit(1) * pd.w * SECTORS.fields.density * w.threat.spawn))
  drive(w, 12, 0.1)
  const drones = w.enemies.filter((e) => e.def.id === 'drone').length
  assert.ok(Math.abs(drones - expect) <= 2, `第 1 波开头那股人流应有约 ${expect} 只无人机，实际 ${drones}`)
}))

test('导演：每一波的脉冲数、特殊兵种小队都按脚本出现；特殊兵种在对应脉冲之后出场', () => {
  const { w } = make('fields')
  const wv = SECTORS.fields.waves[1] // 第 2 波：脉冲 4 个 + 一队 shooter（跟在第 3 个脉冲后）
  drive(w, SECTORS.fields.waves[0].len) // 先走完第 1 波
  assert.equal(dir(w).wave, 2)
  assert.equal(w.enemies.filter((e) => e.def.id === 'shooter').length, 0, '特殊兵种还没出场')
  const sq = wv.squads![0]
  const at = WAVE.firstAt + ((wv.len - WAVE.lastGap - WAVE.firstAt) * (sq.after ?? 1)) / (wv.pulses.length - 1)
  drive(w, at + 3.2 + 0.6)
  const n = w.enemies.filter((e) => e.def.id === sq.enemy).length
  assert.equal(n, sq.n, `应当出现 ${sq.n} 只 ${sq.enemy}`)
})

test('导演：杂兵可以一波波地割（场上敌人数不超过上限）', () => {
  const { w } = make('void')
  drive(w, 560, 0.25, () => assert.ok(w.enemies.length <= w.maxEnemies + 20, `敌人 ${w.enemies.length} 超过上限`))
})

test('导演：每一波结束前放一次浪涌（带着波数），之后才弹出本波攒下的升级', () => {
  const { w, events } = make('fields')
  pacifist(w)
  const len = SECTORS.fields.waves[0].len
  for (let t = 0; t < len - WAVE.sweepLead - 0.2; t += DT) w.update(DT, input)
  assert.equal(events.filter((e) => e.t === 'surge').length, 0, '波尾之前不放')
  assert.equal(w.phase, 'play')
  for (let t = 0; t < 0.4; t += DT) w.update(DT, input)
  const surge = events.filter((e): e is Extract<GameEvent, { t: 'surge' }> => e.t === 'surge')
  assert.equal(surge.length, 1)
  assert.equal(surge[0].n, 1)
  assert.equal(w.stats.waves, 1)
  // pickDelay 之后：本波至少有一次选卡（保底）
  for (let t = 0; t < SURGE.pickDelay + 0.5; t += DT) w.update(DT, input)
  assert.equal(w.phase, 'levelup', '浪涌之后弹出升级卡')
})

test('小 Boss：在脚本指定的波、波首 miniAt 秒后登场，体型缩小，血量远低于正主，击败后只清杂兵、掉宝箱', () => {
  const { w, events } = make('fields')
  pacifist(w)
  const plan = SECTORS.fields.minis[0]
  let t = 0
  while (!w.boss && t < 400) {
    tick(w)
    t += DT
  }
  const b = bossOf(w)!
  assert.ok(b && b.mini === plan.tier && b.id === plan.boss, `应是第 ${plan.wave} 波的 ${plan.boss} 先遣体`)
  assert.equal(dir(w).wave, plan.wave)
  assert.ok(b.r < BOSS_R[b.id] && b.r > BOSS_R[b.id] * 0.5, '体型缩小一圈')
  assert.ok(b.maxHp < 12000 * TUNE.bossHp * 0.4, `小 Boss 血量 ${b.maxHp} 远低于正主`)
  assert.ok(b.maxHp > 1500, '但也不是杂兵：仍是一场硬仗')
  assert.ok(b.maxPhase <= 1, '一档小 Boss 只有两个阶段')
  const spawn = events.find((e) => e.t === 'boss' && e.what === 'spawn')
  assert.ok(spawn && spawn.t === 'boss' && spawn.mini === plan.tier)
  // 打死它
  w.player.hp = w.player.maxHp
  b.intro = 0
  b.age = 10
  w.damageBoss(b, b.maxHp + 1)
  assert.equal(bossOf(w), null)
  assert.equal(w.stats.minis, 1)
  assert.equal(w.stats.bossKilled, false, '小 Boss 不算通关')
  assert.equal(w.winT, -1, '不会触发胜利')
  assert.ok(w.pickups.some((k) => k.alive && k.kind === 'chest'), '掉一个宝箱')
  const dead = events.find((e) => e.t === 'boss' && e.what === 'dead')
  assert.ok(dead && dead.t === 'boss' && dead.mini === plan.tier)
})

test('小 Boss：击败时只清杂兵，特殊兵种和精英留着', () => {
  const { w } = make('fields')
  pacifist(w)
  const p = w.player
  const brute = w.spawnEnemy('brute', p.x + 400, p.y, { spawnT: 0 })
  const elite = w.spawnEnemy('drone', p.x - 400, p.y, { spawnT: 0, elite: true })
  const mobs = Array.from({ length: 10 }, (_, i) => w.spawnEnemy('swarmer', p.x + i * 5, p.y + 300, { spawnT: 0 }))
  spawnBoss(w, 'forge', 1)
  bossOf(w)!.intro = 0
  bossOf(w)!.age = 10
  w.damageBoss(bossOf(w)!, 1e9)
  assert.ok(mobs.every((e) => !e.alive), '杂兵被清掉')
  assert.ok(brute.alive && elite.alive, '特殊兵种与精英留着')
})

test('小 Boss：最终 Boss 登场时，没打死的小 Boss 撤场（没有奖励、不计入击败）', () => {
  const { w, events } = make('fields')
  spawnBoss(w, 'fractal', 2)
  const mini = w.boss!
  w.retireMini()
  assert.equal(mini.alive, false)
  assert.equal(bossOf(w), null)
  assert.equal(w.stats.minis, 0)
  assert.equal(w.pickups.filter((k) => k.alive).length, 0)
  assert.ok(events.some((e) => e.t === 'boss' && e.what === 'retire'))
})

test('最终 Boss 登场：上一波剩下的杂兵 / 特殊兵种 / 精英全部散去（不计击杀），Boss 战是和 Boss 的对决', () => {
  const { w } = make('wasteland')
  pacifist(w)
  const p = w.player
  const leftovers = [
    w.spawnEnemy('brute', p.x + 300, p.y, { spawnT: 0 }),
    w.spawnEnemy('wraith', p.x - 300, p.y, { spawnT: 0, elite: true }),
    ...Array.from({ length: 12 }, (_, i) => w.spawnEnemy('swarmer', p.x + i * 6, p.y + 260, { spawnT: 0 })),
  ]
  const kills = w.stats.kills
  // 直接推到最后一波的尾声（这一步还没有放 Boss）
  drive(w, SECTORS.wasteland.length - 3, 0.5, () => {
    // 脚本刷出来的怪不管；只盯住我们放的这批
    for (const e of leftovers) e.alive = true
  })
  assert.ok(leftovers.every((e) => e.alive))
  drive(w, 4)
  const boss = bossOf(w)
  assert.ok(boss && boss.mini === 0, '正主出场了')
  assert.ok(leftovers.every((e) => !e.alive), '残兵散去')
  assert.equal(w.stats.kills, kills, '散去不算击杀（没有经验、没有掉落）')
})

test('小 Boss：招式（弹幕 / 冲击环 / 射线 / 爆炸）比正主轻——正主 1，小 Boss 按强度档递减', () => {
  const { w } = make('crucible')
  spawnBoss(w, 'maw', 1)
  const a = w.boss!
  spawnBoss(w, 'maw', 2)
  const b = w.boss!
  spawnBoss(w, 'maw', 0)
  const c = w.boss!
  assert.equal(c.atk, 1)
  assert.ok(a.atk < b.atk && b.atk < c.atk, `${a.atk} < ${b.atk} < ${c.atk}`)
  // 实打实地放一次冲击环：伤害随 atk 缩放
  for (const [boss, label] of [
    [a, '一档小 Boss'],
    [c, '正主'],
  ] as const) {
    w.boss = boss
    boss.intro = 0
    boss.age = 10
    boss.t2 = 0
    boss.t1 = 99
    boss.t3 = 99
    w.rings.forEach((r) => (r.alive = false))
    w.update(DT, input)
    const ring = w.rings.find((r) => r.alive && r.hostile)
    assert.ok(ring, `${label}放出冲击环`)
    assert.ok(Math.abs(ring.dmg - 20 * boss.atk) < 1e-9, `${label}的冲击环伤害 = 20 × atk（实际 ${ring.dmg}）`)
  }
})

test('小 Boss：两档体型 / 强度递增；二档比一档血厚', () => {
  const { w } = make('wasteland')
  spawnBoss(w, 'overseer', 1)
  const a = w.boss!
  spawnBoss(w, 'overseer', 2)
  const b = w.boss!
  spawnBoss(w, 'overseer', 0)
  const c = w.boss!
  assert.ok(a.maxHp < b.maxHp && b.maxHp < c.maxHp)
  assert.ok(a.r < b.r && b.r < c.r)
  assert.ok(a.dmg < b.dmg && b.dmg < c.dmg)
  assert.ok(a.maxPhase <= b.maxPhase && b.maxPhase <= c.maxPhase)
})

test('Boss 战里也有割草：最终 Boss 在场时每隔一阵补一波杂兵，但规模受限', () => {
  const { w } = make('fields')
  pacifist(w)
  drive(w, SECTORS.fields.length + 1)
  const boss = bossOf(w)!
  assert.ok(boss && boss.mini === 0)
  boss.intro = 0
  // 清空场上的杂兵，再看补兵
  for (const e of w.enemies) e.alive = false
  w.update(DT, input)
  const before = w.enemies.length
  assert.equal(before, 0)
  drive(w, WAVE.addsEvery * 3 + 10, 0.5)
  assert.ok(w.enemies.length > before, '补了兵')
  assert.ok(w.enemies.length <= WAVE.addsCap + 40, `Boss 战里的杂兵不能铺满屏幕：${w.enemies.length}`)
})

// ───────────────────────── 升级：即时经验 + 延后选卡 ─────────────────────────

test('经验：击杀当场入账，场上不再有需要捡的经验石（只有演出用的光点）', () => {
  const { w } = make('fields')
  const p = w.player
  p.xpNext = 1e12
  const xp0 = p.xp
  const e = w.spawnEnemy('drone', p.x + 200, p.y, { spawnT: 0 })
  w.killEnemy(e)
  assert.ok(p.xp > xp0, '击杀当场入账')
  assert.ok(w.gems.every((g) => g.mag), '光点一出生就飞向飞船，不需要追')
})

test('经验按星区密度校正：越靠后的星区杂兵越多，单只经验越少', () => {
  const gain = (sid: (typeof SECTOR_IDS)[number]): number => {
    const { w } = make(sid)
    w.player.xpNext = 1e12
    w.addXp(10)
    return w.player.xp
  }
  const f = gain('fields')
  const v = gain('void')
  assert.ok(v < f, `虚空 ${v.toFixed(2)} 应小于原野 ${f.toFixed(2)}`)
})

test('升级延后：战斗中经验够了只攒次数、不弹卡；开了选卡窗口才弹，连着弹完', () => {
  const { w } = make('fields')
  pacifist(w)
  w.update(DT, input)
  const lv0 = w.player.level
  w.addXp(1e5)
  assert.ok(w.player.level >= lv0 + 3, '一口气升了好几级')
  const owed = w.queue.filter((q) => q === 'level').length
  assert.equal(owed, w.player.level - lv0, '每升一级攒一次')
  for (let i = 0; i < 30; i++) w.update(DT, input)
  assert.equal(w.phase, 'play', '战斗中途不弹卡')
  w.openPicks()
  w.update(DT, input)
  assert.equal(w.phase, 'levelup')
  assert.equal(w.offerSource, 'level')
  let picked = 0
  while (w.phase === 'levelup' && picked < 500) {
    w.choose(0)
    picked++
  }
  assert.equal(picked, owed, '攒了几次就连着弹几次')
  assert.equal(w.phase, 'play')
  assert.equal(w.queue.length, 0)
  assert.equal(w.pickOpen, false, '窗口随队列清空而关闭')
})

test('宝箱随时弹卡，不用等窗口；最终 Boss 在场时升级也立刻弹，小 Boss 不算', () => {
  const chest = make('fields')
  pacifist(chest.w)
  chest.w.addPickup('chest', chest.w.player.x, chest.w.player.y)
  chest.w.update(DT, input)
  chest.w.update(DT, input)
  assert.equal(chest.w.phase, 'levelup')
  assert.equal(chest.w.offerSource, 'chest')

  const boss = make('fields')
  pacifist(boss.w)
  spawnBoss(boss.w, 'overseer')
  boss.w.addXp(1e5)
  boss.w.update(DT, input)
  assert.equal(boss.w.phase, 'levelup', '正主在场：升级立刻弹')

  const mini = make('fields')
  pacifist(mini.w)
  spawnBoss(mini.w, 'forge', 1)
  mini.w.addXp(1e5)
  for (let i = 0; i < 20; i++) mini.w.update(DT, input)
  assert.equal(mini.w.phase, 'play', '小 Boss 在场：照样攒着，等波尾')
})

test('保底升级：一波里一次都没升级，波尾补一次（每一波至少有一次选卡）', () => {
  const { w } = make('fields')
  pacifist(w)
  w.beginWave(1)
  const lv0 = w.player.level
  w.openPicks()
  assert.equal(w.player.level, lv0 + 1, '补了一级')
  w.update(DT, input)
  assert.equal(w.phase, 'levelup')
  // 这一波已经升过级的话不再补
  const b = make('fields')
  pacifist(b.w)
  b.w.beginWave(1)
  b.w.addXp(1e5)
  const lv = b.w.player.level
  b.w.openPicks()
  assert.equal(b.w.player.level, lv, '本波已经升过级：不补')
})

// ───────────────────────── 引力井 / 伏击 ─────────────────────────

test('引力井：把玩家往中心拽（刚张开时几乎没有拉力，拉满后明显），冲刺中不受影响，到时间自己消失', () => {
  const pull = (age: number, dash = false): number => {
    const { w } = make('void')
    pacifist(w)
    const p = w.player
    w.addWell(p.x + 250, p.y)
    w.wells[0].age = age
    if (dash) p.dashT = 5
    const d0 = Math.hypot(w.wells[0].x - p.x, w.wells[0].y - p.y)
    for (let t = 0; t < 0.5; t += DT) w.update(DT, input)
    return d0 - Math.hypot(w.wells[0].x - p.x, w.wells[0].y - p.y)
  }
  assert.ok(pull(0) < 12, `刚张开：几乎没有拉力（${pull(0).toFixed(1)}）`)
  assert.ok(pull(WELL.arm) > 25, `拉满：半秒内被明显拽近（${pull(WELL.arm).toFixed(1)}）`)
  assert.ok(pull(WELL.arm, true) < 1, '冲刺中不受影响')

  const d = make('void')
  pacifist(d.w)
  d.w.addWell(d.w.player.x + 900, d.w.player.y)
  for (let t = 0; t < WELL.life + 0.5; t += DT) tick(d.w)
  assert.equal(d.w.wells.filter((x) => x.alive).length, 0, '到时间消失')
})

test('引力井：奇点会伤到玩家（记在"引力井"头上），也会碾碎被拽进去的杂兵', flowOff(() => {
  const { w } = make('void')
  const p = w.player
  p.weapons.length = 0
  w.recalc()
  p.hp = p.maxHp
  w.addWell(p.x, p.y)
  w.wells[0].age = WELL.arm + 0.1
  w.update(DT, input)
  w.update(DT, input)
  assert.ok((w.stats.hurtBy.well ?? 0) > 0, '站在奇点里受伤，来源 = well')

  const b = make('void')
  pacifist(b.w)
  const wl = (b.w.addWell(b.w.player.x + 800, b.w.player.y), b.w.wells[0])
  wl.age = WELL.arm + 0.1
  const fodder = Array.from({ length: 10 }, (_, i) => b.w.spawnEnemy('drone', wl.x + 80 + i * 8, wl.y + 40, { spawnT: 0 }))
  for (const e of fodder) e.speed = 0
  for (let t = 0; t < 2.5; t += DT) b.w.update(DT, input)
  assert.ok(fodder.filter((e) => e.alive).length < fodder.length, '被拽进奇点的杂兵会被碾碎')
}))

test('伏击：带预警的脉冲先在屏幕边缘亮出箭头，预警时间之后才刷出敌人', flowOff(() => {
  const { w, events } = make('wasteland')
  pacifist(w)
  const d = dir(w) as unknown as { firePulse(w: World, pd: unknown, idx: number): void }
  d.firePulse(w, { form: 'pincer', enemy: 'drone', w: 1.6, warn: 1.8 }, 1)
  const amb = events.find((e) => e.t === 'ambush')
  assert.ok(amb && amb.t === 'ambush')
  assert.equal(amb.angles.length, 2, '夹击从两个相反的方向来')
  assert.ok(Math.abs(Math.abs(amb.angles[0] - amb.angles[1]) - Math.PI) < 1e-9)
  assert.equal(amb.t0, 1.8)
  assert.equal(w.enemies.length, 0, '预警期间没有敌人')
  for (let t = 0; t < 1.7; t += 0.1) dir(w).update(w, 0.1)
  assert.equal(w.enemies.length, 0, '还没到时间')
  for (let t = 0; t < 0.3; t += 0.1) dir(w).update(w, 0.1)
  assert.ok(w.enemies.length >= 10, `预警结束后刷出一大群：${w.enemies.length}`)
  const p = w.player
  const sides = new Set(w.enemies.map((e) => Math.sign(Math.cos(amb.angles[0]) * (e.x - p.x) + Math.sin(amb.angles[0]) * (e.y - p.y))))
  assert.equal(sides.size, 2, '两面都有')
}))

// ───────────────────────── 目标优先级 ─────────────────────────

test('自动瞄准优先级：Boss > 特殊兵种 / 精英 > 最近的杂兵', () => {
  const { w } = make('fields')
  pacifist(w)
  const p = w.player
  const freeze = (e: { speed: number }): void => {
    e.speed = 0
  }
  /** 刷新空间网格（nearestTarget 查的是它） */
  const settle = (): void => w.update(1e-4, input)
  const near = w.spawnEnemy('drone', p.x + 60, p.y, { spawnT: 0 })
  freeze(near)
  settle()
  assert.equal(w.nearestTarget(p.x, p.y, 600), near)
  const brute = w.spawnEnemy('brute', p.x + 400, p.y, { spawnT: 0 })
  freeze(brute)
  settle()
  assert.equal(w.nearestTarget(p.x, p.y, 600), brute, '射程里有重甲就先打重甲')
  assert.equal(w.nearestTarget(p.x, p.y, 300), near, '重甲在射程外：打杂兵')
  const elite = w.spawnEnemy('swarmer', p.x - 200, p.y, { spawnT: 0, elite: true })
  freeze(elite)
  settle()
  assert.equal(w.nearestTarget(p.x, p.y, 600), elite, '精英比远处的重甲更近：先打精英')
  spawnBoss(w, 'overseer')
  const bs = bossOf(w)!
  assert.notEqual(w.nearestTarget(p.x, p.y, 700), bs, '出场动画里的 Boss 还碰不到')
  bs.intro = 0
  bs.x = p.x + 500
  bs.y = p.y
  assert.equal(w.nearestTarget(p.x, p.y, 700), bs, 'Boss 进了射程就是第一优先')
  // 过滤器（只作用于敌人）仍然有效：Boss 离开射程后，按过滤器挑
  bs.x = p.x + 5000
  const only = w.nearestTarget(p.x, p.y, 700, (e) => e === near)
  assert.equal(only, near)
})

// ───────────────────────── 演示 / 无尽 ─────────────────────────

test('主菜单演示：只有杂兵潮，循环放波，不出 Boss / 小 Boss，规模受限', () => {
  const { w } = make('fields', { demo: true })
  w.player.hp = w.player.maxHp = 1e9
  for (let t = 0; t < 130; t += DT) {
    w.update(DT, input)
    if (w.phase === 'levelup') w.choose(0)
    assert.ok(w.enemies.length <= 90, `演示里敌人太多：${w.enemies.length}`)
  }
  assert.equal(w.boss, null)
  assert.equal(w.stats.minis, 0)
  assert.ok(dir(w).wave >= 3, `演示应当一波接一波：${dir(w).wave}`)
})

test('无尽模式：Boss 倒下之后继续放波，循环后半段的脚本并逐圈放大', () => {
  const { w, events } = make('fields', { endless: true })
  pacifist(w)
  drive(w, SECTORS.fields.length + 1)
  const boss = bossOf(w)!
  assert.ok(boss && boss.mini === 0)
  boss.intro = 0
  boss.age = 10
  w.damageBoss(boss, 1e12)
  assert.equal(w.stats.bossKilled, true)
  w.winT = -1 // 无尽模式不结算胜利
  const before = waves(events).length
  drive(w, 200, 0.5)
  const ws = waves(events)
  assert.ok(ws.length >= before + 3, `Boss 之后应继续出波：${ws.length - before}`)
  assert.ok(ws[ws.length - 1].n > 12, '波数继续增长')
})

test('波次单位量：逐波增长，且 12 波的杂兵总量是"割草"的量级', () => {
  let prev = 0
  for (let k = 1; k <= 12; k++) {
    const u = waveUnit(k)
    assert.ok(u > prev)
    prev = u
  }
  // 原野：每个脉冲约 26~190 只杂兵；整局几千只
  let total = 0
  for (const [i, wv] of SECTORS.fields.waves.entries()) for (const pd of wv.pulses) total += Math.min(WAVE.maxPulse, Math.round(waveUnit(i + 1) * pd.w * SECTORS.fields.density))
  assert.ok(total >= 3000 && total <= 12000, `原野 12 波杂兵总量应是几千只量级：${total}`)
  for (const id of ['drone', 'swarmer'] as const) assert.ok(ENEMIES[id].hp <= 12, `${id} 一两下就倒`)
})
