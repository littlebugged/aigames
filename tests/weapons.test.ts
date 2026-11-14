import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WEAPON_IDS, WEAPON_MAX_LEVEL, type EnemyId, type WeaponId } from '../src/data/ids'
import { HOWITZER_BOMBLET, HULL_BASELINE, HULL_SCALING, RAIL_SCAR_RATIO, SIPHON_REGEN_BOOST, SIPHON_SPLASH_RATIO, WEAPONS } from '../src/data/weapons'
import { spawnBoss } from '../src/game/bosses'
import { Bot } from '../src/game/bot'
import { WeaponInst, type Enemy, type InputState, type Ring } from '../src/game/entities'
import { computeStats, resolveWeaponStats } from '../src/game/stats'
import { World } from '../src/game/world'

const input: InputState = { mx: 0, my: 0, dash: false }
const DT = 1 / 60

interface Range {
  w: World
  wi: WeaponInst
  /** 伤害事件：每一次命中一条 */
  hits: { x: number; y: number; dmg: number; boss: boolean }[]
}

/** 靶场：只带一把武器、不自然刷怪、玩家无敌，方便精确数命中。 */
function range(id: WeaponId, level = WEAPON_MAX_LEVEL, evolved = false): Range {
  const w = new World({ seed: 3, ship: 'vanguard', sector: 'fields', threat: 0, meta: {} })
  ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
  const p = w.player
  p.xpNext = 1e12
  p.invuln = 1e9
  p.weapons.length = 0
  const wi = new WeaponInst(id, 0)
  wi.level = level
  wi.evolved = evolved
  p.weapons.push(wi)
  w.recalc()
  const hits: Range['hits'] = []
  w.sink = (e) => {
    if (e.t === 'hit') hits.push({ x: e.x, y: e.y, dmg: e.dmg, boss: e.boss })
  }
  return { w, wi, hits }
}

/** 钉在原地、血很厚的靶子 */
function dummy(w: World, dx: number, dy: number, id: EnemyId = 'brute', hpMul = 1000): Enemy {
  const e = w.spawnEnemy(id, w.player.x + dx, w.player.y + dy, { spawnT: 0, hpMul })
  e.speed = 0
  return e
}

/** 把靶子拉回原位（被击退后），再推进一帧 */
function stepPinned(w: World, pins: [Enemy, number, number][]): void {
  for (const [e, x, y] of pins) {
    e.x = x
    e.y = y
    e.kx = e.ky = 0
  }
  w.update(DT, input)
}

// ───────────────────────── 回旋飞轮 ─────────────────────────

test('回旋飞轮：飞到尽头 → 折返 → 回到机身后消失；一去一回各打中一次', () => {
  const { w, wi, hits } = range('chakram', 1)
  const p = w.player
  const e = dummy(w, 130, 0)
  const pin: [Enemy, number, number][] = [[e, p.x + 130, p.y]]
  const reach = wi.s.range
  let launched = false
  let apex = 0
  let t = 0
  while (t < 4) {
    stepPinned(w, pin)
    t += DT
    if (wi.pts.length > 0) launched = true
    for (const pt of wi.pts) apex = Math.max(apex, Math.hypot(pt.x - p.x, pt.y - p.y))
    if (launched && wi.pts.length === 0) break
  }
  assert.ok(launched, '应该掷出飞轮')
  assert.equal(wi.pts.length, 0, '飞轮应在 4 秒内飞回机身并消失')
  assert.ok(apex <= reach + 25, `飞轮飞得比射程 ${reach} 还远：${apex.toFixed(0)}`)
  assert.ok(apex >= reach - 30, `飞轮没飞到射程尽头：${apex.toFixed(0)} / ${reach}`)
  assert.equal(hits.length, 2, `一去一回应恰好命中 2 次（去程 1 次 + 回程 1 次），实际 ${hits.length}`)
  assert.ok(t < 2.6, `飞轮往返用了 ${t.toFixed(2)}s，太慢`)
})

test('回旋飞轮：移动中的机身也一定能把飞轮"接"回来', () => {
  for (const fps of [30, 60, 120]) {
    const { w, wi } = range('chakram')
    const p = w.player
    dummy(w, 160, 0)
    const dt = 1 / fps
    const run: InputState = { mx: 0, my: 0, dash: false }
    let t = 0
    let maxLive = 0
    while (t < 12) {
      // 绕着圈乱跑
      const a = t * 1.7
      run.mx = Math.cos(a)
      run.my = Math.sin(a)
      w.update(dt, run)
      t += dt
      maxLive = Math.max(maxLive, wi.pts.length)
    }
    assert.ok(maxLive > 0, `${fps}fps 应掷出过飞轮`)
    // 停下来等 3 秒，所有飞轮必须已经回来
    run.mx = run.my = 0
    wi.timer = 1e9
    for (let i = 0; i < fps * 3; i++) w.update(dt, run)
    assert.equal(wi.pts.length, 0, `${fps}fps：还有 ${wi.pts.length} 枚飞轮没回来`)
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
  }
})

test('回旋飞轮：攻速拉满时，同时在外的飞轮数也有上限', () => {
  const { w, wi } = range('chakram')
  wi.s = { ...wi.s, cooldown: 0.02 }
  const p = w.player
  const e = dummy(w, 150, 0)
  let max = 0
  for (let i = 0; i < 60 * 6; i++) {
    stepPinned(w, [[e, p.x + 150, p.y]])
    max = Math.max(max, wi.pts.length)
  }
  assert.ok(max > 0)
  assert.ok(max <= 14, `同时在外的飞轮达到 ${max} 枚`)
})

test('回旋飞轮：进化后会在折返点炸出冲击环，未进化没有', () => {
  for (const evolved of [false, true]) {
    const { w, wi } = range('chakram', WEAPON_MAX_LEVEL, evolved)
    const p = w.player
    const e = dummy(w, 150, 0)
    let ring: Ring | undefined
    let t = 0
    while (t < 2.5 && !ring) {
      stepPinned(w, [[e, p.x + 150, p.y]])
      t += DT
      ring = w.rings.find((r) => r.alive && !r.hostile)
    }
    if (!evolved) {
      assert.equal(ring, undefined, '未进化的飞轮不该产生冲击环')
      continue
    }
    assert.ok(ring, '进化后折返点应炸出冲击环')
    assert.equal(ring.maxR, wi.s.blast)
    const d = Math.hypot(ring.x - p.x, ring.y - p.y)
    assert.ok(Math.abs(d - wi.s.range) < 45, `冲击环应在折返点（≈${wi.s.range}）附近，实际 ${d.toFixed(0)}`)
  }
})

test('回旋飞轮：满级面对一圈敌人，4 秒总伤害进化后至少高出 1.5 倍', () => {
  const total = (evolved: boolean): number => {
    const { w, hits } = range('chakram', WEAPON_MAX_LEVEL, evolved)
    const p = w.player
    // 以机身为圆心铺 24 只靶子（黄金角 + 固定距离，保证两次对比条件完全一致）
    const pins: [Enemy, number, number][] = []
    for (let i = 0; i < 24; i++) {
      const a = i * 2.399963
      const d = 90 + ((i * 53) % 210)
      const x = p.x + Math.cos(a) * d
      const y = p.y + Math.sin(a) * d
      pins.push([dummy(w, x - p.x, y - p.y, 'drone', 3000), x, y])
    }
    for (let i = 0; i < 60 * 4; i++) stepPinned(w, pins)
    return hits.reduce((a, h) => a + h.dmg, 0)
  }
  const base = total(false)
  const evo = total(true)
  assert.ok(base > 0)
  assert.ok(evo >= base * 1.5, `进化后 4 秒总伤 ${evo.toFixed(0)}，应至少是未进化 ${base.toFixed(0)} 的 1.5 倍`)
})

test('回旋飞轮：多枚飞轮打 Boss 时并成一束，每一枚都打得中', () => {
  const { w, wi, hits } = range('chakram', WEAPON_MAX_LEVEL)
  const p = w.player
  spawnBoss(w, 'maw')
  const boss = w.boss
  assert.ok(boss)
  boss.intro = 0
  let t = 0
  while (t < 1.6) {
    boss.x = p.x + 200
    boss.y = p.y
    w.update(DT, input)
    t += DT
  }
  const n = Math.round(wi.s.count)
  // 每枚飞轮：去程 1 次 + 回程 1 次
  assert.ok(hits.filter((h) => h.boss).length >= n * 2 - 1, `Boss 应被 ${n} 枚飞轮来回打中约 ${n * 2} 次，实际 ${hits.length}`)
})

// ───────────────────────── 磁轨炮 ─────────────────────────

test('磁轨炮：专挑血最厚的目标，光轨贯穿整条线，线外的不受伤', () => {
  const { w, hits } = range('rail', 1)
  const p = w.player
  const tough = dummy(w, 300, 0, 'brute', 1000)
  const behind = dummy(w, 560, 0, 'drone', 50)
  const off = dummy(w, 300, 160, 'drone', 20) // 全场最弱，且不在光轨线上
  const pins: [Enemy, number, number][] = [
    [tough, p.x + 300, p.y],
    [behind, p.x + 560, p.y],
    [off, p.x + 300, p.y + 160],
  ]
  const full = (e: Enemy): number => e.maxHp - e.hp
  for (let i = 0; i < 30; i++) stepPinned(w, pins)
  const dmg = WEAPONS.rail.stats(1, false).damage
  assert.ok(Math.abs(full(tough) - dmg) < 1e-6, `主目标应恰好吃一发 ${dmg}，实际 ${full(tough)}`)
  assert.ok(Math.abs(full(behind) - dmg) < 1e-6, '光轨线上的后排敌人也应被贯穿')
  assert.equal(full(off), 0, '线外的敌人不该受伤')
  assert.equal(hits.length, 2)
})

test('磁轨炮：目标比光轨少时，多出来的光轨叠在同一目标身上，每一道都打得中', () => {
  const { w, hits } = range('rail', WEAPON_MAX_LEVEL)
  const p = w.player
  const e = dummy(w, 420, 0, 'drone', 200) // 小个子、很远，也要全部命中
  for (let i = 0; i < 20; i++) stepPinned(w, [[e, p.x + 420, p.y]])
  const n = WEAPONS.rail.stats(WEAPON_MAX_LEVEL, false).count
  assert.equal(n, 3)
  assert.equal(hits.length, n, `3 道光轨应全部命中同一目标，实际 ${hits.length}`)
})

test('磁轨炮：Boss 在射程内时永远是第一目标，其余光轨去打最厚的小怪', () => {
  const { w, hits } = range('rail', WEAPON_MAX_LEVEL)
  const p = w.player
  spawnBoss(w, 'overseer')
  const boss = w.boss
  assert.ok(boss)
  boss.intro = 0
  boss.x = p.x + 380
  boss.y = p.y
  const a = dummy(w, 0, 300, 'brute', 800)
  const b = dummy(w, -300, 0, 'brute', 600)
  const c = dummy(w, 0, -300, 'drone', 5) // 最弱，不该被选中
  const pins: [Enemy, number, number][] = [
    [a, p.x, p.y + 300],
    [b, p.x - 300, p.y],
    [c, p.x, p.y - 300],
  ]
  for (let i = 0; i < 20; i++) {
    boss.x = p.x + 380
    boss.y = p.y
    stepPinned(w, pins)
  }
  assert.ok(boss.hp < boss.maxHp, 'Boss 应吃到光轨')
  assert.ok(a.hp < a.maxHp && b.hp < b.maxHp, '其余两道光轨应打向血量最厚的两只小怪')
  assert.equal(c.hp, c.maxHp, '最弱的小怪不该被选中')
  assert.equal(hits.length, 3)
})

test('磁轨炮：没有敌人时不空放、不进入冷却；敌人一出现立刻开火', () => {
  const { w, wi } = range('rail', 1)
  const p = w.player
  for (let i = 0; i < 60 * 4; i++) w.update(DT, input)
  assert.equal(w.beams.filter((b) => b.alive).length, 0, '没有目标时不应开火')
  assert.ok(wi.timer <= 0.2, '没有目标时冷却不应被消耗')
  const e = dummy(w, 250, 0)
  for (let i = 0; i < 20; i++) stepPinned(w, [[e, p.x + 250, p.y]])
  assert.ok(e.hp < e.maxHp, '目标出现后应立刻被击中')
})

test('磁轨炮：进化后光轨留下持续灼烧的痕，痕会在冷却结束前消散', () => {
  const { w, hits } = range('rail', WEAPON_MAX_LEVEL, true)
  const p = w.player
  const s = WEAPONS.rail.stats(WEAPON_MAX_LEVEL, true)
  const e = dummy(w, 300, 0, 'brute', 5000)
  const pin: [Enemy, number, number][] = [[e, p.x + 300, p.y]]
  for (let i = 0; i < 60 * 1.9; i++) stepPinned(w, pin)
  const main = s.damage * s.count
  const total = hits.reduce((a, h) => a + h.dmg, 0)
  const scarTick = s.damage * RAIL_SCAR_RATIO
  assert.ok(total > main + scarTick * 6, `灼痕应追加多跳伤害：总伤 ${total.toFixed(0)}，主炮 ${main}`)
  assert.equal(w.beams.filter((b) => b.alive).length, 0, '1.9 秒后灼痕应已消散（下一发还没打出）')
})

// ───────────────────────── 榴弹炮 ─────────────────────────

/** 在靶场里再挂一个事件记录器（保留靶场自带的命中记录） */
function tap(w: World): { lands: { x: number; y: number; r: number }[]; blasts: number[]; shots: number; heals: number[]; bolts: number } {
  const rec = { lands: [] as { x: number; y: number; r: number }[], blasts: [] as number[], shots: 0, heals: [] as number[], bolts: 0 }
  const prev = w.sink
  w.sink = (e) => {
    prev?.(e)
    if (e.t === 'shellLand') rec.lands.push({ x: e.x, y: e.y, r: e.r })
    else if (e.t === 'blast') rec.blasts.push(e.r)
    else if (e.t === 'shot') rec.shots++
    else if (e.t === 'heal') rec.heals.push(e.n)
  }
  return rec
}

const taken = (e: Enemy): number => e.maxHp - e.hp

test('榴弹炮：炮弹飞一会儿后砸在目标身上，爆炸半径内的敌人受伤、半径外的不受伤', () => {
  const { w, wi } = range('howitzer', 1)
  const p = w.player
  const rec = tap(w)
  const a = dummy(w, 250, 0, 'brute', 1000)
  const near = dummy(w, 280, 40, 'drone', 1000)
  const far = dummy(w, 470, 0, 'drone', 1000) // 离落点 200+，在爆炸半径（64）之外
  const pins: [Enemy, number, number][] = [
    [a, p.x + 250, p.y],
    [near, p.x + 280, p.y + 40],
    [far, p.x + 470, p.y],
  ]
  let t = 0
  while (t < 3 && rec.lands.length === 0) {
    stepPinned(w, pins)
    t += DT
  }
  assert.equal(rec.lands.length, 1, '应落地一发')
  const land = rec.lands[0]
  assert.equal(land.r, wi.s.blast)
  assert.ok(t >= 0.45 && t <= 1.4, `炮弹飞行用了 ${t.toFixed(2)}s，应在 0.5~1.25s 之间`)
  assert.ok(Math.hypot(land.x - a.x, land.y - a.y) < wi.s.blast * 0.65, '落点应在目标（与人群重心）附近')
  assert.ok(taken(a) >= wi.s.damage * 0.55, `主目标应吃到爆炸：${taken(a).toFixed(1)} / ${wi.s.damage}`)
  assert.ok(taken(near) >= wi.s.damage * 0.55, '半径内的邻居应被波及')
  assert.equal(taken(far), 0, '半径外的敌人不该受伤')
})

test('榴弹炮：落点跟着目标走——炮弹在空中时敌人跑远了，照样砸在它身上', () => {
  const { w, wi } = range('howitzer', 1)
  const rec = tap(w)
  const a = dummy(w, 200, 0, 'brute', 1000)
  let t = 0
  while (t < 3 && rec.lands.length === 0) {
    a.x += 200 * DT // 每秒横着跑 200，飞行 0.5s 以上 = 至少跑出 100，远大于爆炸半径 64
    a.kx = a.ky = 0
    w.update(DT, input)
    t += DT
  }
  assert.equal(rec.lands.length, 1)
  const land = rec.lands[0]
  assert.ok(Math.hypot(land.x - a.x, land.y - a.y) <= wi.s.blast * 0.65, `落点应追着目标，实际差了 ${Math.hypot(land.x - a.x, land.y - a.y).toFixed(0)}`)
  assert.ok(taken(a) > 0, '目标应被命中')
})

test('榴弹炮：Boss 在射程内时所有炮弹都砸向 Boss，不去炸旁边的人堆', () => {
  const { w } = range('howitzer', WEAPON_MAX_LEVEL)
  const p = w.player
  const rec = tap(w)
  spawnBoss(w, 'maw')
  const boss = w.boss
  assert.ok(boss)
  boss.intro = 0
  // Boss 自己会冲撞位移：落点离 Boss 多远要在落地那一刻量，而不是循环结束之后
  const offs: number[] = []
  const prev = w.sink
  w.sink = (e) => {
    prev?.(e)
    if (e.t === 'shellLand') offs.push(Math.hypot(e.x - boss.x, e.y - boss.y))
  }
  // 反方向放一堆很诱人的小怪
  const heap: [Enemy, number, number][] = []
  for (let i = 0; i < 8; i++) {
    const x = -250 + (i % 3) * 22
    const y = Math.floor(i / 3) * 22 - 20
    heap.push([dummy(w, x, y, 'drone', 3000), p.x + x, p.y + y])
  }
  let t = 0
  while (t < 4 && rec.lands.length < 3) {
    boss.x = p.x + 250
    boss.y = p.y
    stepPinned(w, heap)
    t += DT
  }
  assert.ok(rec.lands.length >= 3, `一轮 3 发应全部落地，实际 ${rec.lands.length}`)
  for (const d of offs) assert.ok(d <= boss.r * 0.45 + 1e-6, `炮弹应落在 Boss 身上（偏离中心 ${d.toFixed(1)}，上限 ${(boss.r * 0.45).toFixed(1)}）`)
  assert.ok(boss.hp < boss.maxHp, 'Boss 应吃到炮弹')
  for (const [e] of heap) assert.equal(e.hp, e.maxHp, '旁边的小怪堆不该挨炸')
})

test('榴弹炮：一轮齐射分头砸向不同的人堆，不会三发叠在一处', () => {
  const { w, wi } = range('howitzer', WEAPON_MAX_LEVEL)
  const p = w.player
  const rec = tap(w)
  const pins: [Enemy, number, number][] = []
  for (let c = 0; c < 3; c++) {
    const ang = (c * Math.PI * 2) / 3
    const cx = Math.cos(ang) * 260
    const cy = Math.sin(ang) * 260
    for (let i = 0; i < 5; i++) {
      const ox = ((i * 37) % 50) - 25
      const oy = ((i * 53) % 50) - 25
      pins.push([dummy(w, cx + ox, cy + oy, 'drone', 3000), p.x + cx + ox, p.y + cy + oy])
    }
  }
  let t = 0
  while (t < 4 && rec.lands.length < 3) {
    stepPinned(w, pins)
    t += DT
  }
  assert.equal(rec.lands.length, 3)
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const d = Math.hypot(rec.lands[i].x - rec.lands[j].x, rec.lands[i].y - rec.lands[j].y)
      assert.ok(d > wi.s.blast, `第 ${i + 1}、${j + 1} 发落点只隔 ${d.toFixed(0)}，应分头去炸不同的人堆`)
    }
  }
})

test('榴弹炮：吃最大生命加成（基准以下不削弱、其它武器不受影响）', () => {
  const lean = computeStats('phantom', {}, {})
  const base = computeStats('vanguard', {}, {})
  const tough = computeStats('vanguard', {}, { hull: 5 })
  const bulwark = computeStats('bulwark', {}, {})
  assert.ok(lean.maxHp < HULL_BASELINE && base.maxHp === HULL_BASELINE, '前提：幽影号低于基准，先锋号正好等于基准')
  const dmg = (st: typeof base): number => resolveWeaponStats('howitzer', 4, false, st).damage
  const raw = WEAPONS.howitzer.stats(4, false).damage
  assert.equal(dmg(lean), raw * lean.dmg, '耐久低于基准不该削弱')
  assert.equal(dmg(base), raw * base.dmg)
  const k = HULL_SCALING.howitzer ?? 0
  assert.ok(k > 0)
  assert.ok(Math.abs(dmg(tough) / dmg(base) - (1 + (k * (tough.maxHp - HULL_BASELINE)) / 100)) < 1e-9, '最大生命每多 100 点，伤害多 k 倍')
  assert.ok(dmg(bulwark) > dmg(base), '堡垒号耐久高，榴弹炮更疼')
  // 其它武器不看耐久
  assert.equal(resolveWeaponStats('pulse', 4, false, tough).damage, resolveWeaponStats('pulse', 4, false, base).damage)
})

test('榴弹炮：进化后每发落地还会撒出子弹药（额外的小爆炸），未进化没有', () => {
  for (const evolved of [false, true]) {
    const { w, wi } = range('howitzer', WEAPON_MAX_LEVEL, evolved)
    const p = w.player
    const rec = tap(w)
    const pins: [Enemy, number, number][] = []
    for (let i = 0; i < 6; i++) {
      const x = 250 + ((i * 37) % 60) - 30
      const y = ((i * 53) % 60) - 30
      pins.push([dummy(w, x, y, 'drone', 5000), p.x + x, p.y + y])
    }
    // 只看第一轮齐射（下一轮要等冷却），再留出子弹药的引信时间
    for (let i = 0; i < 60 * 2.4; i++) stepPinned(w, pins)
    const mains = rec.blasts.filter((r) => r === wi.s.blast).length
    const bomblets = rec.blasts.filter((r) => r < wi.s.blast * 0.9).length
    assert.equal(mains, Math.round(wi.s.count), `${evolved ? '进化' : '未进化'}：主爆炸数应等于一轮的炮弹数`)
    if (!evolved) {
      assert.equal(bomblets, 0, '未进化不该有子弹药')
      continue
    }
    assert.equal(bomblets, mains * Math.round(wi.s.chain), '每发应撒出 chain 枚子弹药')
    const small = rec.blasts.find((r) => r < wi.s.blast * 0.9) ?? 0
    assert.ok(Math.abs(small - wi.s.blast * HOWITZER_BOMBLET.radius) < 1e-6, '子弹药的半径应是主爆炸的固定比例')
  }
})

test('榴弹炮：没有目标时不开火、不消耗冷却；炮弹数量不会失控', () => {
  const { w, wi } = range('howitzer', WEAPON_MAX_LEVEL)
  const rec = tap(w)
  for (let i = 0; i < 60 * 4; i++) w.update(DT, input)
  assert.equal(rec.shots, 0, '没有目标时不应开火')
  assert.equal(w.shells.filter((s) => s.alive).length, 0)
  assert.ok(wi.timer <= 0.2, '没有目标时冷却不应被消耗')
  const p = w.player
  const e = dummy(w, 260, 0, 'brute', 9000)
  let peak = 0
  for (let i = 0; i < 60 * 12; i++) {
    stepPinned(w, [[e, p.x + 260, p.y]])
    peak = Math.max(peak, w.shells.filter((s) => s.alive).length)
  }
  assert.ok(rec.shots >= 6, '目标出现后应持续开火')
  assert.ok(peak <= Math.round(wi.s.count) + 1, `同时在空中的炮弹 ${peak} 发，超过一轮的数量`)
})

// ───────────────────────── 虹吸索 ─────────────────────────

test('虹吸索：扣住最近的几个敌人，每个目标只被一根索扣住，每一跳都打中', () => {
  const { w, wi } = range('siphon', WEAPON_MAX_LEVEL)
  const p = w.player
  const want = Math.round(wi.s.count)
  const es: Enemy[] = []
  const pins: [Enemy, number, number][] = []
  for (let i = 0; i < want + 2; i++) {
    const a = i * 1.1
    const d = 70 + i * 22 // 近 → 远，全部在射程内
    const x = Math.cos(a) * d
    const y = Math.sin(a) * d
    const e = dummy(w, x, y, 'drone', 5000)
    es.push(e)
    pins.push([e, p.x + x, p.y + y])
  }
  for (let i = 0; i < 60 * 2; i++) stepPinned(w, pins)
  assert.equal(wi.pts.length, want, '应扣满全部的索')
  const held = new Set(wi.pts.map((pt) => pt.tgt))
  assert.equal(held.size, want, '同一个敌人不该被两根索同时扣住')
  for (let i = 0; i < want; i++) assert.ok(held.has(es[i]), `第 ${i + 1} 近的敌人应被扣住`)
  for (let i = 0; i < want; i++) assert.ok(taken(es[i]) >= wi.s.damage * 4, `被扣住的敌人应持续吃到伤害：${taken(es[i]).toFixed(1)}`)
  for (let i = want; i < es.length; i++) assert.equal(taken(es[i]), 0, '没扣住的远处敌人不受伤')
})

test('虹吸索：目标跑出射程（带一点滞回）或死掉就断开，随后补上新的', () => {
  const { w, wi } = range('siphon', 1)
  wi.s = { ...wi.s, count: 1 }
  const p = w.player
  const range0 = wi.s.range
  const a = dummy(w, 100, 0, 'drone', 5000)
  const b = dummy(w, 0, range0 * 0.9, 'drone', 5000)
  const place = (e: Enemy, x: number, y: number): void => {
    e.x = p.x + x
    e.y = p.y + y
    e.kx = e.ky = 0
  }
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      place(b, 0, range0 * 0.9)
      w.update(DT, input)
    }
  }
  place(a, 100, 0)
  run(30)
  assert.equal(wi.pts[0]?.tgt, a, '先扣住最近的 a')
  // 稍微出界（在滞回之内）：仍然扣着，不会一闪一断
  const edge = range0 * 1.1 + a.r
  for (let i = 0; i < 30; i++) {
    place(a, edge, 0)
    place(b, 0, range0 * 0.9)
    w.update(DT, input)
  }
  assert.equal(wi.pts[0]?.tgt, a, '边缘附近应保持连接（滞回）')
  // 真正跑远：断开并改扣 b
  for (let i = 0; i < 40; i++) {
    place(a, range0 * 1.6, 0)
    place(b, 0, range0 * 0.9)
    w.update(DT, input)
  }
  assert.equal(wi.pts.length, 1)
  assert.equal(wi.pts[0].tgt, b, '跑远后应改扣仍在射程内的 b')
  // 目标死掉：下一帧就断开，不会拖着一根没有目标的索
  b.alive = false
  w.update(DT, input)
  assert.ok(wi.pts.every((pt) => pt.tgt !== b), '死掉的目标不该还被扣着')
})

/** 同一场景有 / 没有虹吸索时，玩家血量的差 = 虹吸索回复的总量（天然回血在两边相同，相减抵消） */
function siphonHeal(regenLv: number, seconds: number, opts: { evolved?: boolean; neighbor?: boolean; hpFrac?: number } = {}): { gain: number; heals: number[]; bolts: number; neighborTaken: number } {
  const run = (withSiphon: boolean): { hp: number; heals: number[]; bolts: number; neighborTaken: number } => {
    const { w, wi } = range('siphon', 1, opts.evolved ?? false)
    wi.s = { ...wi.s, count: 1 }
    const p = w.player
    p.passives.regen = regenLv
    w.recalc()
    wi.s = { ...wi.s, count: 1 }
    p.hp = p.maxHp * (opts.hpFrac ?? 0.5)
    if (!withSiphon) p.weapons.length = 0
    const rec = tap(w)
    const a = dummy(w, 120, 0, 'brute', 50000)
    const pins: [Enemy, number, number][] = [[a, p.x + 120, p.y]]
    let nb: Enemy | null = null
    if (opts.neighbor) {
      nb = dummy(w, 150, 40, 'drone', 50000)
      pins.push([nb, p.x + 150, p.y + 40])
    }
    let bolts = 0
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      stepPinned(w, pins)
      bolts = Math.max(bolts, w.bolts.filter((b) => b.alive).length)
    }
    return { hp: p.hp, heals: rec.heals, bolts, neighborTaken: nb ? taken(nb) : 0 }
  }
  const on = run(true)
  const off = run(false)
  return { gain: on.hp - off.hp, heals: on.heals, bolts: on.bolts, neighborTaken: on.neighborTaken }
}

test('虹吸索：每一跳回复固定的生命，纳米修复按比例放大，回复量与伤害无关', () => {
  const s = WEAPONS.siphon.stats(1, false)
  const base = siphonHeal(0, 8)
  const ticks = 8 / s.tick
  assert.ok(base.gain > s.heal * (ticks - 3) && base.gain <= s.heal * (ticks + 1) + 1e-9, `8 秒应回复约 ${(s.heal * ticks).toFixed(2)}，实际 ${base.gain.toFixed(2)}`)
  const boosted = siphonHeal(4, 8)
  const st = computeStats('vanguard', {}, { regen: 4 })
  const want = 1 + st.regen * SIPHON_REGEN_BOOST
  assert.ok(Math.abs(boosted.gain / base.gain - want) < 0.06, `纳米修复 4 级应放大 ${want.toFixed(2)}×，实际 ${(boosted.gain / base.gain).toFixed(2)}×`)
  // 回复量是固定值：把伤害提高 3 倍，回复量不变
  const { w, wi } = range('siphon', 1)
  wi.s = { ...wi.s, count: 1, damage: wi.s.damage * 3 }
  const p = w.player
  p.hp = p.maxHp * 0.5
  const e = dummy(w, 120, 0, 'brute', 50000)
  const hp0 = p.hp
  for (let i = 0; i < 60 * 8; i++) stepPinned(w, [[e, p.x + 120, p.y]])
  assert.ok(Math.abs(p.hp - hp0 - base.gain) < s.heal * 2, '伤害翻 3 倍，回复量应基本不变')
})

test('虹吸索：满血不回复、不冒"+N"；回血汇总成整数飘字，总数与实际回复一致', () => {
  const full = siphonHeal(0, 6, { hpFrac: 1 })
  assert.equal(full.gain, 0, '满血时不该回复')
  assert.equal(full.heals.length, 0, '满血时不该冒飘字')
  const half = siphonHeal(0, 12)
  assert.ok(half.heals.length >= 2, `12 秒内应冒出多次 +N，实际 ${half.heals.length}`)
  assert.ok(half.heals.every((n) => Number.isInteger(n) && n >= 1))
  const sum = half.heals.reduce((a, n) => a + n, 0)
  assert.ok(sum <= half.gain + 1e-9 && sum > half.gain - 1, `飘字总数 ${sum} 应等于回复总量 ${half.gain.toFixed(2)} 取整`)
})

test('虹吸索：Boss 在射程内时最多占一半的索，其余的索留给小怪', () => {
  const { w, wi } = range('siphon', WEAPON_MAX_LEVEL)
  const p = w.player
  spawnBoss(w, 'maw')
  const boss = w.boss
  assert.ok(boss)
  boss.intro = 0
  const pins: [Enemy, number, number][] = []
  for (let i = 0; i < 6; i++) {
    const a = 2.2 + i * 0.5
    const x = Math.cos(a) * (90 + i * 8)
    const y = Math.sin(a) * (90 + i * 8)
    pins.push([dummy(w, x, y, 'drone', 9000), p.x + x, p.y + y])
  }
  for (let i = 0; i < 60 * 2; i++) {
    boss.x = p.x + 150
    boss.y = p.y
    stepPinned(w, pins)
  }
  const want = Math.round(wi.s.count)
  const onBoss = wi.pts.filter((pt) => pt.tgt === boss).length
  assert.equal(wi.pts.length, want)
  assert.equal(onBoss, Math.ceil(want / 2), `Boss 应占 ${Math.ceil(want / 2)} 根索`)
  assert.ok(boss.hp < boss.maxHp)
})

test('虹吸索：进化后每一跳溅射目标周围的敌人并画出电弧，但溅射不额外回血', () => {
  const solo = siphonHeal(0, 6, { evolved: true })
  const withNeighbor = siphonHeal(0, 6, { evolved: true, neighbor: true })
  assert.ok(withNeighbor.neighborTaken > 0, '目标旁边的敌人应被溅射到')
  assert.ok(withNeighbor.bolts > 0, '溅射应画出电弧')
  assert.equal(solo.bolts, 0, '身边没有别的敌人时不该画电弧')
  assert.ok(Math.abs(withNeighbor.gain - solo.gain) < 1e-6, '溅射打到的敌人不该多回血')
  const plain = siphonHeal(0, 6, { evolved: false, neighbor: true })
  assert.equal(plain.neighborTaken, 0, '未进化不溅射')
  const s = WEAPONS.siphon.stats(WEAPON_MAX_LEVEL, true)
  assert.ok(s.blast > 0 && SIPHON_SPLASH_RATIO > 0 && SIPHON_SPLASH_RATIO < 1)
})

test('虹吸索：没有敌人时不扣、不空转；多重弹仓增加索数、范围随"范围"被动增大', () => {
  const { w, wi } = range('siphon', 4)
  const rec = tap(w)
  for (let i = 0; i < 60 * 3; i++) w.update(DT, input)
  assert.equal(wi.pts.length, 0)
  assert.equal(rec.shots, 0)
  const st = computeStats('vanguard', {}, { multi: 2, area: 3 })
  const plain = computeStats('vanguard', {}, {})
  assert.ok(st.extraCount >= 1 && st.area > 1)
  assert.equal(resolveWeaponStats('siphon', 4, false, st).count, WEAPONS.siphon.stats(4, false).count + st.extraCount)
  assert.ok(resolveWeaponStats('siphon', 4, false, st).range > resolveWeaponStats('siphon', 4, false, plain).range, '范围被动应拉长索长')
})

// ───────────────────────── 通用 ─────────────────────────

test('多重弹仓：飞轮吃数量加成，磁轨炮不吃（光轨条数由等级决定）', () => {
  const st = computeStats('vanguard', {}, { multi: 2 })
  assert.ok(st.extraCount >= 1)
  const chakram = resolveWeaponStats('chakram', 4, false, st)
  const rail = resolveWeaponStats('rail', 4, false, st)
  assert.equal(chakram.count, WEAPONS.chakram.stats(4, false).count + st.extraCount)
  assert.equal(rail.count, WEAPONS.rail.stats(4, false).count)
})

test('每把武器（含进化）单独带着开打，整局不会出现 NaN、泄漏或崩溃', () => {
  for (const id of WEAPON_IDS) {
    for (const evolved of [false, true]) {
      const w = new World({ seed: 5, ship: 'vanguard', sector: 'wasteland', threat: 1, meta: {} })
      const p = w.player
      p.weapons.length = 0
      const wi = new WeaponInst(id, 0)
      wi.level = WEAPON_MAX_LEVEL
      wi.evolved = evolved
      p.weapons.push(wi)
      w.recalc()
      const bot = new Bot(5, 1)
      const run: InputState = { mx: 0, my: 0, dash: false }
      let peakPts = 0
      let peakBeams = 0
      let peakShells = 0
      while (w.phase !== 'won' && w.phase !== 'lost' && w.time < 40) {
        if (w.phase === 'levelup') {
          // 只升级，不再给这把武器之外的东西：随便选第一张，但保证武器栏里依然有它
          w.choose(0)
          continue
        }
        bot.drive(w, DT, run)
        w.update(DT, run)
        peakPts = Math.max(peakPts, wi.pts.length)
        peakBeams = Math.max(peakBeams, w.beams.length)
        peakShells = Math.max(peakShells, w.shells.length)
      }
      const tag = `${id}${evolved ? '(进化)' : ''}`
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.hp), `${tag} 玩家状态异常`)
      for (const e of w.enemies) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.hp), `${tag} 敌人状态异常`)
      assert.ok(peakPts <= 24, `${tag} 小件数量失控：${peakPts}`)
      assert.ok(peakBeams <= 64, `${tag} 光束数量失控：${peakBeams}`)
      assert.ok(peakShells <= 16, `${tag} 炮弹数量失控：${peakShells}`)
    }
  }
})
