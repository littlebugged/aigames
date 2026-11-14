import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOSS_IDS, SECTOR_IDS } from '../src/data/ids'
import { SECTORS } from '../src/data/sectors'
import { spawnBoss } from '../src/game/bosses'
import type { Boss, InputState } from '../src/game/entities'
import { World } from '../src/game/world'

/**
 * 第 4 个星区「熔炉星环」与它的 Boss「熔炉巨像」（v1.12）。
 * 这里测玩法：陨火打击的预警与结算、巨像的四种招式（余烬弹幕 / 熔渣弹 / 震地 / 旋转熔切）、阶段转换。
 */

const input: InputState = { mx: 0, my: 0, dash: false }
const DT = 1 / 60

/** 只有巨像的竞技场：不自然刷怪，玩家不动，巨像摆在玩家正右侧 300 处并定好阶段 */
function arena(phase: 0 | 1 | 2, seed = 5) {
  const w = new World({ seed, ship: 'vanguard', sector: 'crucible', threat: 0, meta: {} })
  ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
  const p = w.player
  p.xpNext = 1e12
  p.weapons.length = 0
  w.recalc()
  spawnBoss(w, 'forge')
  const b = w.boss!
  b.phase = phase
  b.hp = b.maxHp * [1, 0.5, 0.2][phase]
  b.intro = 0
  b.x = p.x + 300
  b.y = p.y
  return { w, p, b }
}

const step = (w: World, seconds: number, each?: () => void): void => {
  for (let t = 0; t < seconds; t += DT) {
    w.update(DT, input)
    each?.()
  }
}

const fire = (w: World, ev: { at: number; kind: string; count?: number }): void =>
  (w as unknown as { director: { fire(w: World, ev: unknown): void } }).director.fire(w, ev)

const liveTeles = (w: World) => w.teles.filter((t) => t.alive)
const hostileBeams = (w: World) => w.beams.filter((b) => b.alive && b.hostile)
const hostileRings = (w: World) => w.rings.filter((r) => r.alive && r.hostile)

// ───────────────────────── 数据 ─────────────────────────

test('第 4 星区：排在虚空裂隙之后、Boss 是熔炉巨像，奖励最高、难度曲线不低于虚空', () => {
  assert.equal(SECTOR_IDS[SECTOR_IDS.length - 1], 'crucible')
  assert.ok(BOSS_IDS.includes('forge'))
  const c = SECTORS.crucible
  assert.equal(c.boss, 'forge')
  assert.equal(c.requires, 'void')
  for (const id of SECTOR_IDS) if (id !== 'crucible') assert.ok(c.reward > SECTORS[id].reward, `熔炉星环的奖励应高于 ${id}`)
  const v = SECTORS.void
  for (const k of ['base', 'perMin', 'accel'] as const) assert.ok(c.spawn[k] >= v.spawn[k], `刷怪 ${k} 不应低于虚空裂隙`)
  assert.ok(c.hpPerMin >= v.hpPerMin && c.dmgPerMin >= v.dmgPerMin)
})

test('第 4 星区：陨火打击散布在整局里，数量逐次增加，且都排在 Boss 预警之前', () => {
  const strikes = SECTORS.crucible.events.filter((e) => e.kind === 'strike')
  assert.ok(strikes.length >= 4, '陨火打击是这个星区的特色，应当反复出现')
  let last = 0
  for (const s of strikes) {
    assert.ok((s.count ?? 0) >= last, '数量应当逐次增加')
    last = s.count ?? 0
  }
  const warn = SECTORS.crucible.events.find((e) => e.kind === 'boss-warning')!
  assert.ok(strikes.every((s) => s.at < warn.at))
  // 其它星区没有陨火——它是熔炉星环独有的危险
  for (const id of SECTOR_IDS) if (id !== 'crucible') assert.ok(!SECTORS[id].events.some((e) => e.kind === 'strike'), `${id} 不该有陨火`)
})

test('熔炉巨像：血量 = 基础值 × 威胁倍率，比虚空之喉更厚', () => {
  const w = new World({ seed: 1, ship: 'vanguard', sector: 'crucible', threat: 2, meta: {} })
  spawnBoss(w, 'forge')
  const f = w.boss!
  spawnBoss(w, 'maw')
  const m = w.boss!
  assert.ok(f.maxHp > m.maxHp, '熔炉巨像应当是目前最厚的 Boss')
  assert.ok(Math.abs(f.maxHp - 26000 * w.threat.hp) < 1)
})

// ───────────────────────── 陨火打击 ─────────────────────────

test('陨火打击：一批带预警的火球，依次落下；预警时间 ≥ 1.25 秒', () => {
  const w = new World({ seed: 3, ship: 'vanguard', sector: 'crucible', threat: 0, meta: {} })
  ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
  const warns: string[] = []
  const prev = w.sink
  w.sink = (e) => {
    prev?.(e)
    if (e.t === 'warn') warns.push(e.key)
  }
  fire(w, { at: 0, kind: 'strike', count: 6 })
  const tl = liveTeles(w)
  assert.equal(tl.length, 6)
  assert.deepEqual(warns, ['warn.strike'])
  for (let i = 0; i < tl.length; i++) {
    assert.equal(tl[i].action, 'blast')
    assert.equal(tl[i].fx, 2, '陨火从高处砸下')
    assert.equal(tl[i].kind, 'circle')
    assert.ok(tl[i].maxT >= 1.25 - 1e-9, `第 ${i + 1} 发预警只有 ${tl[i].maxT.toFixed(2)} 秒`)
    if (i > 0) assert.ok(tl[i].maxT > tl[i - 1].maxT, '依次落下，而不是同时')
  }
  // 第一发压在玩家脚下（玩家没动）
  assert.ok(Math.hypot(tl[0].x - w.player.x, tl[0].y - w.player.y) < 1)
})

test('陨火打击：站着不动会被第一发砸中；预警期间走开就一点事没有', () => {
  const hit = (move: boolean): number => {
    const w = new World({ seed: 3, ship: 'vanguard', sector: 'crucible', threat: 0, meta: {} })
    ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
    w.player.xpNext = 1e12
    w.player.weapons.length = 0
    w.recalc()
    w.time = 120
    fire(w, { at: 0, kind: 'strike', count: 5 })
    let scorches = 0
    const prev = w.sink
    w.sink = (e) => {
      prev?.(e)
      if (e.t === 'scorch') scorches++
    }
    // 走开：预警圈最大半径 64 + 散布 ≤ 340，往一个方向走 600 就彻底出了范围
    const mv: InputState = { mx: move ? 1 : 0, my: 0, dash: false }
    for (let t = 0; t < 3.2; t += DT) {
      w.player.hp = w.player.maxHp
      const before = w.stats.damageTaken
      w.update(DT, mv)
      if (move && w.player.x > 900) w.player.vx = 0 // 防止跑得太远影响别的断言
      void before
    }
    assert.ok(scorches >= 5, `每个落点都该留下焦痕事件（${scorches}）`)
    return w.stats.hurtBy.blast ?? 0
  }
  assert.ok(hit(false) > 0, '站着不动：第一发正中')
  // 走开：全程直线跑 3 秒 ≈ 700+ 像素，所有预警圈都在身后
  assert.equal(hit(true), 0, '一直在跑：不该被砸中')
})

test('陨火打击：伤害随局内时间成长，且算作"爆炸"', () => {
  const dmgAt = (time: number): number => {
    const w = new World({ seed: 3, ship: 'vanguard', sector: 'crucible', threat: 0, meta: {} })
    ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
    w.player.xpNext = 1e12
    w.player.weapons.length = 0
    w.player.st.armor = 0
    w.recalc()
    w.time = time
    fire(w, { at: 0, kind: 'strike', count: 1 })
    step(w, 1.4)
    assert.ok(w.stats.damageTaken > 0, '站在原地应当被砸中')
    assert.deepEqual(Object.keys(w.stats.hurtBy), ['blast'])
    return w.stats.damageTaken
  }
  assert.ok(dmgAt(480) > dmgAt(30), '后期的陨火更疼')
})

// ───────────────────────── 熔炉巨像：余烬弹幕与熔渣弹 ─────────────────────────

test('熔炉巨像·一阶段：放余烬弹幕（ember）和熔渣弹预警，没有射线；缓缓压近后停步', () => {
  const { w, p, b } = arena(0)
  b.x = p.x + 900 // 从远处开始：看它走过来
  const kinds = new Set<string>()
  const lobs = new Set<number>()
  let beams = 0
  step(w, 30, () => {
    p.hp = p.maxHp
    for (const e of w.ebullets) if (e.alive) kinds.add(e.kind)
    for (const t of liveTeles(w)) if (t.action === 'blast' && t.fx === 1) lobs.add(t.maxT)
    beams += hostileBeams(w).length
  })
  assert.ok(kinds.has('ember'), `应有余烬弹，实际 ${[...kinds]}`)
  assert.deepEqual([...kinds].filter((k) => k !== 'ember'), [], '一阶段只放余烬弹')
  assert.ok(lobs.size > 0, '应抛出熔渣弹（带预警圈）')
  assert.equal(beams, 0, '一阶段没有旋转熔切')
  const d = Math.hypot(b.x - p.x, b.y - p.y)
  assert.ok(d < 260 && d > 150, `巨像应停在 ~236 的距离外，实际 ${d.toFixed(0)}`)
})

test('熔渣弹：预警圈 1.15 秒后结算，圈里的玩家受伤并记在巨像头上；散落的圈数随阶段增加', () => {
  const circles = (phase: 0 | 1 | 2): number => {
    const { w, p, b } = arena(phase)
    b.t1 = b.t3 = b.t4 = 99
    b.t2 = 0
    p.hp = p.maxHp
    w.update(DT, input)
    return liveTeles(w).filter((t) => t.fx === 1).length
  }
  assert.deepEqual([circles(0), circles(1), circles(2)], [2, 3, 4])

  const { w, p, b } = arena(0)
  b.t1 = b.t3 = 99
  b.t2 = 0
  p.st.armor = 0
  w.update(DT, input)
  const lead = liveTeles(w).find((t) => t.fx === 1)!
  assert.ok(Math.hypot(lead.x - p.x, lead.y - p.y) < 1, '第一发预判玩家位置')
  assert.ok(lead.maxT > 1.1, '至少 1.1 秒的预警')
  const hp0 = p.hp
  step(w, 1.4)
  assert.ok(p.hp < hp0, '站在圈里应当受伤')
  assert.ok((w.stats.hurtBy.forge ?? 0) > 0, '伤害记在熔炉巨像头上（击坠者能显示它的名字）')
})

// ───────────────────────── 熔炉巨像：震地 ─────────────────────────

test('震地：先亮一大圈预警，蓄力期间巨像原地不动；圈内重伤，圈外只有随后的冲击环', () => {
  for (const inside of [true, false]) {
    const { w, p, b } = arena(0)
    b.x = p.x + (inside ? 110 : 330)
    b.y = p.y
    b.t1 = b.t2 = b.t4 = 99
    b.t3 = 0
    p.st.armor = 0
    w.update(DT, input)
    const slam = liveTeles(w).find((t) => t.action === 'slam')
    assert.ok(slam, '应亮起震地预警')
    assert.equal(b.state, 1)
    assert.ok(slam!.r > 150 && slam!.maxT > 0.8, `预警圈应当又大又久（r=${slam!.r}, t=${slam!.maxT}）`)
    const x0 = b.x
    const hp0 = p.hp
    // 预警期间：不伤人，巨像不动
    step(w, 0.8, () => assert.equal(b.x, x0, '蓄力时不该移动'))
    assert.equal(p.hp, hp0, '预警期间不伤人')
    // 结算
    step(w, 0.4)
    if (inside) assert.ok(p.hp < hp0, '圈内受伤')
    else assert.equal(p.hp, hp0, '圈外不受震地本身的伤害')
    assert.equal((w.stats.hurtBy.forge ?? 0) > 0, inside)
    const rings = hostileRings(w)
    assert.equal(rings.length, 1, '一阶段震出一道环')
    assert.equal(b.state, 0, '收招')
    assert.ok(b.t3 > 5, '震地有冷却')
  }
})

test('震地：三阶段震出两道环，第二道晚 0.55 秒出发；环是从巨像身边出发而不是从圈边', () => {
  const { w, p, b } = arena(2)
  b.t1 = b.t2 = b.t4 = 99
  b.t3 = 0
  p.hp = p.maxHp
  let first: { r: number; delay: number }[] = []
  step(w, 1.2, () => {
    p.hp = p.maxHp
    const rs = hostileRings(w)
    if (rs.length === 2 && first.length === 0) first = rs.map((r) => ({ r: r.r, delay: r.delay }))
  })
  assert.equal(first.length, 2)
  assert.ok(first[0].r < 120, `环应从巨像身边出发（r=${first[0].r.toFixed(0)}）`)
  assert.ok(first[1].delay > 0.3 && first[1].delay <= 0.55 + 1e-9, `第二道要等一等（delay=${first[1].delay.toFixed(2)}）`)
})

// ───────────────────────── 熔炉巨像：旋转熔切 ─────────────────────────

/** 让巨像立刻开始熔切；返回开始后的第一帧快照（此时射线已经亮出来，正在预警） */
function startSweep(phase: 1 | 2) {
  const a = arena(phase)
  a.b.t1 = a.b.t2 = a.b.t3 = 99
  a.b.t4 = 0
  a.w.update(DT, input)
  return a
}

/** 把玩家挪到离巨像 dist 处、与第 0 条射线夹角 off（弧度，正 = 顺着转动方向超前）的位置 */
function standAt(w: World, p: World['player'], b: Boss, off: number, dist: number): void {
  const dir = Math.sign(b.spin)
  const a = b.jets[0].ang + dir * off
  p.x = b.x + Math.cos(a) * dist
  p.y = b.y + Math.sin(a) * dist
  p.vx = p.vy = 0
  p.st.armor = 0
  void w
}

test('旋转熔切：一阶段没有，二阶段起 2 条、三阶段 3 条，等分整圈，先以预警状态亮出来', () => {
  const none = arena(0)
  none.b.t1 = none.b.t2 = none.b.t3 = 99
  none.b.t4 = 0
  step(none.w, 3)
  assert.equal(hostileBeams(none.w).length, 0, '阶段 1 没有熔切')

  for (const [phase, n] of [[1, 2], [2, 3]] as const) {
    const { w, b } = startSweep(phase)
    const jets = hostileBeams(w)
    assert.equal(b.state, 2, '预警状态')
    assert.equal(jets.length, n)
    assert.equal(b.jets.length, n)
    for (const j of jets) {
      assert.ok(j.warn > 0.9, '先是预警：不伤人')
      assert.equal(j.style, 'boss')
      assert.ok(j.fixed && j.hostile)
      assert.equal(j.ox, b.x)
      assert.equal(j.oy, b.y)
    }
    const TAU = Math.PI * 2
    for (let i = 1; i < n; i++) {
      const gap = (((jets[i].ang - jets[0].ang) % TAU) + TAU) % TAU
      assert.ok(Math.abs(gap - (i / n) * TAU) < 0.05, `第 ${i + 1} 条应在 ${((i / n) * 360).toFixed(0)}° 处，实际 ${((gap / TAU) * 360).toFixed(0)}°`)
    }
  }
})

test('旋转熔切：预警 1 秒不伤人 → 扫射时以固定角速度旋转（阶段越高越快）→ 结束后射线收掉、进入冷却；全程巨像扎根', () => {
  for (const [phase, omega, sweep] of [[1, 0.62, 2.8], [2, 0.8, 3.3]] as const) {
    const { w, p, b } = startSweep(phase)
    // 玩家站在第 0 条射线"前方"（朝着它即将转去的方向）0.9 弧度的空档里，离巨像 250
    standAt(w, p, b, 0.9, 250)
    const x0 = b.x
    const y0 = b.y
    const hp0 = p.hp
    // 预警：射线虽然已经朝这边爬了，但不伤人
    step(w, 0.9, () => {
      assert.equal(b.x, x0)
      assert.equal(b.y, y0)
    })
    assert.equal(p.hp, hp0, '预警期间不该受伤')
    // 预警结束 → 扫射
    step(w, 0.3)
    assert.equal(b.state, 3, '进入扫射')
    const j0 = b.jets[0]
    const a0 = j0.ang
    p.hp = p.maxHp
    step(w, 1, () => (p.hp = p.maxHp))
    const swept = Math.abs(j0.ang - a0)
    assert.ok(Math.abs(swept - omega) < 0.06, `阶段 ${phase + 1}：1 秒应扫过 ${omega} 弧度，实际 ${swept.toFixed(3)}`)
    // 角度同步给机体美术用
    assert.ok(Math.abs(b.ang - j0.ang) < 0.05)
    // 扎根
    assert.equal(b.x, x0)
    assert.equal(b.y, y0)
    // 结束
    step(w, sweep + 0.5, () => (p.hp = p.maxHp))
    assert.equal(b.state, 0, '收招')
    assert.equal(b.jets.length, 0)
    assert.equal(hostileBeams(w).length, 0, '射线全部收掉')
    assert.ok(b.t4 > 3 && b.t4 < 7.6, `熔切有冷却，实际 ${b.t4.toFixed(2)}`)
  }
})

test('旋转熔切：射线扫到玩家身上会受伤，记作"激光束"', () => {
  const { w, p, b } = startSweep(1)
  standAt(w, p, b, 0.9, 250) // 站在射线前方：预警时爬过 0.29，扫射 ~1 秒后追上
  const hp0 = p.hp
  step(w, 2.6)
  assert.ok(p.hp < hp0, '站在射线的路径上应当受伤')
  assert.ok((w.stats.hurtBy.beam ?? 0) > 0)
})

test('旋转熔切：站在两条射线之间的空档里不动，也不会立刻被扫到（给足反应时间）', () => {
  const { w, p, b } = startSweep(1)
  standAt(w, p, b, Math.PI / 2, 180) // 两条射线相隔 180°，正中间
  const hp0 = p.hp
  // 预警 1.05 秒 + 扫射 0.55 秒：射线总共转过 0.29 + 0.34 = 0.63 弧度（36°），离玩家还有 54°
  step(w, 1.6)
  assert.equal(p.hp, hp0)
  assert.equal(w.stats.hurtBy.beam ?? 0, 0)
})

// ───────────────────────── 阶段转换 ─────────────────────────

test('阶段转换：打断熔切、清掉射线，炉门喷出一圈自爆怪（三阶段再混入冲锋者）', () => {
  const { w, p, b } = startSweep(1)
  assert.equal(b.jets.length, 2)
  const before = w.enemies.filter((e) => e.alive).length
  // 把血量砸到 33% 以下 → 进入三阶段
  b.hp = b.maxHp * 0.3
  step(w, 0.1)
  assert.equal(b.phase, 2)
  assert.equal(b.jets.length, 0, '熔切被打断')
  assert.equal(hostileBeams(w).length, 0)
  assert.equal(b.state, 0)
  const adds = w.enemies.filter((e) => e.alive).slice(before)
  const ids = adds.map((e) => e.def.id)
  assert.equal(ids.length, 6)
  assert.equal(ids.filter((i) => i === 'bomber').length, 3)
  assert.equal(ids.filter((i) => i === 'charger').length, 3)
  assert.ok(b.t4 >= 3 - 0.2, '转阶段后熔切要等一会儿才再来')
  void p
})

test('阶段转换：一阶段 → 二阶段喷出 4 只自爆怪', () => {
  const { w, b } = arena(0)
  b.t1 = b.t2 = b.t3 = 99
  b.hp = b.maxHp * 0.6
  step(w, 0.1)
  assert.equal(b.phase, 1)
  const ids = w.enemies.filter((e) => e.alive).map((e) => e.def.id)
  assert.equal(ids.length, 4)
  assert.ok(ids.every((i) => i === 'bomber'))
})

// ───────────────────────── 整场战斗 ─────────────────────────

test('整场战斗：三个阶段都放得出招，没有 NaN，击败巨像后全场危险物清空', () => {
  const { w, p, b } = arena(0)
  p.xpNext = 1e12
  const seen = { ember: false, lob: false, slam: false, jets: false, ring: false }
  // 玩家不动、血量锁满；每 5 秒削掉巨像一截血，逼着它走完三个阶段
  let t = 0
  while (w.boss && w.boss.alive && t < 120) {
    p.hp = p.maxHp
    if (Math.floor(t / 5) !== Math.floor((t - DT) / 5) && t > 1) b.hp = Math.max(1, b.hp - b.maxHp * 0.12)
    w.update(DT, input)
    t += DT
    for (const e of w.ebullets) if (e.alive && e.kind === 'ember') seen.ember = true
    for (const tl of liveTeles(w)) {
      if (tl.fx === 1) seen.lob = true
      if (tl.action === 'slam') seen.slam = true
    }
    if (hostileBeams(w).length > 0) seen.jets = true
    if (hostileRings(w).length > 0) seen.ring = true
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.ang), 'Boss 坐标出现 NaN')
  }
  assert.deepEqual(seen, { ember: true, lob: true, slam: true, jets: true, ring: true })
  // 击败
  b.hp = 1
  w.damageBoss(b, 10)
  step(w, 0.1)
  assert.equal(w.boss, null)
  assert.equal(hostileBeams(w).length, 0)
  assert.equal(hostileRings(w).length, 0)
  assert.equal(liveTeles(w).length, 0)
  assert.ok(w.stats.bossKilled)
})
