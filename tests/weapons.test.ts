import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WEAPON_IDS, WEAPON_MAX_LEVEL, type EnemyId, type WeaponId } from '../src/data/ids'
import { RAIL_SCAR_RATIO, WEAPONS } from '../src/data/weapons'
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
      }
      const tag = `${id}${evolved ? '(进化)' : ''}`
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.hp), `${tag} 玩家状态异常`)
      for (const e of w.enemies) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.hp), `${tag} 敌人状态异常`)
      assert.ok(peakPts <= 24, `${tag} 小件数量失控：${peakPts}`)
      assert.ok(peakBeams <= 64, `${tag} 光束数量失控：${peakBeams}`)
    }
  }
})
