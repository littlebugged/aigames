import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENEMIES } from '../src/data/enemies'
import { SECTOR_IDS } from '../src/data/ids'
import { SECTORS } from '../src/data/sectors'
import { FLOW, FORMS, WAVE, waveUnit, type Form, type PulseDef } from '../src/data/waves'
import { MULTI } from '../src/data/tuning'
import { spawnBoss } from '../src/game/bosses'
import type { Director } from '../src/game/director'
import type { Enemy, InputState } from '../src/game/entities'
import { xpForLevel } from '../src/game/stats'
import { World, speedHash } from '../src/game/world'

/**
 * v1.15「人潮不断」：
 *  · 导演的"人潮补兵"让屏幕里永远有一群怪在被割（v1.14 的脉冲之间有大段空屏，像屏保）；
 *  · 杂兵的移速各不相同、阵型带噪声、刷怪点贴着画面边缘（宽屏 / 竖屏都一样），不再齐步走、不再要走很久才露面；
 *  · 掉队的杂兵会加速追赶、太远就回收。
 */

const input: InputState = { mx: 0, my: 0, dash: false }
const DT = 1 / 60

function make(sector: (typeof SECTOR_IDS)[number] = 'fields', view?: [number, number]) {
  const w = new World({ seed: 7, ship: 'vanguard', sector, threat: 0, meta: {} })
  if (view) {
    w.viewHalfW = view[0]
    w.viewHalfH = view[1]
  }
  return w
}

const dir = (w: World): Director => w.director

/** 无敌、没有武器的玩家：世界完整运行，只看导演 */
function pacifist(w: World): void {
  const p = w.player
  p.weapons.length = 0
  w.recalc()
  p.hp = p.maxHp = 1e9
}

/** 推进世界；遇到升级卡就随手选第一张（别让世界卡在选卡阶段） */
const step = (w: World, seconds: number): void => {
  for (let t = 0; t < seconds; t += DT) {
    if (w.phase === 'levelup') w.choose(0)
    else w.update(DT, input)
    w.player.hp = w.player.maxHp // 选卡会重算属性（血上限回到飞船本来的数），所以每帧补满
  }
}

/** 关掉人潮补兵（只看脉冲本身）；用完自动还原 */
function flowOff(fn: () => void): void {
  const k = FLOW.k
  FLOW.k = 0
  try {
    fn()
  } finally {
    FLOW.k = k
  }
}

/** 记录每一次刷怪的位置（刷出那一刻的坐标） */
function recordSpawns(w: World): { x: number; y: number; id: string }[] {
  const out: { x: number; y: number; id: string }[] = []
  const spawn0 = w.spawnEnemy.bind(w)
  w.spawnEnemy = ((id, x, y, o) => {
    out.push({ x, y, id })
    return spawn0(id, x, y, o)
  }) as typeof w.spawnEnemy
  return out
}

const fodderAlive = (w: World): Enemy[] => w.enemies.filter((e) => e.alive && e.def.tier === 'fodder' && !e.elite)

/** 敌人是否在画面矩形之外（以玩家为中心） */
const offscreen = (w: World, e: { x: number; y: number }, pad = 0): boolean =>
  Math.abs(e.x - w.player.x) >= w.viewHalfW + pad || Math.abs(e.y - w.player.y) >= w.viewHalfH + pad

// ───────────────────────── 人潮补兵 ─────────────────────────

test('人潮补兵：开局几秒内就铺开一群怪，而且稳定在目标线附近（不会无限堆积）', () => {
  const w = make('fields')
  pacifist(w)
  step(w, 6)
  const target = dir(w).flowTarget(w)
  assert.ok(dir(w).flowHave(w) >= target * 0.6, `开局 6 秒屏幕附近的杂兵应已补到目标线的六成以上：${dir(w).flowHave(w)} / ${target.toFixed(1)}`)
  // 不杀怪的情况下，补兵不会超过目标线太多（脉冲另算：它们是在补兵之上叠加的）
  step(w, 24)
  assert.ok(w.enemies.length <= w.maxEnemies + 20)
})

test('人潮补兵：割光之后几秒内又铺满（屏幕里永远有一群怪在被割）', () => {
  for (const sid of SECTOR_IDS) {
    const w = make(sid)
    pacifist(w)
    step(w, 60) // 走到第 2 波中段
    const kill = (): void => {
      for (const e of w.enemies) if (e.alive) w.killEnemy(e)
    }
    kill()
    assert.equal(fodderAlive(w).length, 0)
    const target = dir(w).flowTarget(w)
    step(w, 4)
    const have = dir(w).flowHave(w)
    assert.ok(have >= target * 0.5, `${sid}：割光之后 4 秒应已补回目标线的一半以上：${have} / ${target.toFixed(1)}`)
  }
})

test('人潮补兵：目标线随波数增长，随星区密度放大，小 Boss 在场时减半，封顶 FLOW.cap', () => {
  const w = make('fields')
  const d = dir(w) as unknown as { unitWave: number; scale: number }
  const at = (k: number): number => {
    d.unitWave = k
    d.scale = 1
    return dir(w).flowTarget(w)
  }
  assert.ok(at(1) > 15, `第 1 波的目标线就不低：${at(1)}`)
  for (let k = 2; k <= 12; k++) assert.ok(at(k) >= at(k - 1), `第 ${k} 波不应比上一波更稀`)
  assert.ok(Math.abs(at(1) - waveUnit(1) * FLOW.k * SECTORS.fields.density) < 1e-9)

  const crucible = make('crucible')
  const dc = dir(crucible) as unknown as { unitWave: number; scale: number }
  dc.unitWave = 3
  dc.scale = 1
  d.unitWave = 3
  assert.ok(dir(crucible).flowTarget(crucible) > dir(w).flowTarget(w), '星区密度越高，目标线越高')

  d.unitWave = 12
  d.scale = 2.4
  assert.equal(dir(w).flowTarget(w), FLOW.cap, '封顶')

  d.unitWave = 5
  d.scale = 1
  const full = dir(w).flowTarget(w)
  spawnBoss(w, 'forge', 1)
  assert.ok(w.boss && w.boss.mini > 0)
  assert.ok(Math.abs(dir(w).flowTarget(w) - full * FLOW.bossScale) < 1e-9, '小 Boss 在场：减半')
})

test('人潮补兵：只补杂兵（不会补出特殊兵种 / 精英），开局就开始补', () => {
  for (const sid of SECTOR_IDS) {
    const w = make(sid)
    pacifist(w)
    const spawns = recordSpawns(w)
    // 脚本里的第一个脉冲在 firstAt 之后才来，之前只有补兵
    for (let t = 0; t < WAVE.firstAt - 0.4; t += DT) w.update(DT, input)
    assert.ok(spawns.length > 0, `${sid}：开局就该补兵`)
    for (const s of spawns) assert.equal(ENEMIES[s.id as keyof typeof ENEMIES].tier, 'fodder', `${sid}：补兵只出杂兵，却出了 ${s.id}`)
    assert.ok(w.enemies.every((e) => !e.elite))
  }
})

test('人潮补兵：浪涌清场之后到下一波开始之前不再补兵', () => {
  const w = make('fields')
  pacifist(w)
  const len = SECTORS.fields.waves[0].len
  step(w, len - WAVE.sweepLead + 0.3) // 浪涌刚放出
  assert.equal(dir(w).wave, 1)
  const spawns = recordSpawns(w)
  // 选卡会暂停世界：一路选过去，直到下一波开始前的最后一刻
  for (let n = 0; n < 2400 && dir(w).waveT < len - 0.05; n++) {
    if (w.phase === 'levelup') w.choose(0)
    else w.update(DT, input)
    w.player.hp = w.player.maxHp
  }
  assert.ok(dir(w).waveT >= len - 0.05, '走到了波尾')
  assert.equal(spawns.length, 0, '浪涌之后到波末，没有任何新怪')
})

test('人潮补兵：整局场上的敌人数不超过 maxEnemies（含脉冲叠加）', () => {
  const w = make('crucible')
  pacifist(w)
  let peak = 0
  for (let t = 0; t < 420; t += DT) {
    if (w.phase === 'levelup') w.choose(0)
    else w.update(DT, input)
    w.player.hp = w.player.maxHp
    if (w.enemies.length > peak) peak = w.enemies.length
  }
  assert.ok(peak <= w.maxEnemies + 20, `峰值 ${peak}`)
  assert.ok(peak > 150, `后期应当是真正的人潮：峰值 ${peak}`)
})

// ───────────────────────── 去队列感 ─────────────────────────

test('杂兵移速：按 id 散列出 ±speedSpread 的个体差异（确定性，不吃随机数）；特殊兵种与精英不变', () => {
  assert.equal(speedHash(12345), speedHash(12345))
  for (let i = 1; i < 2000; i++) {
    const h = speedHash(i)
    assert.ok(h >= 0 && h < 1, `speedHash(${i}) = ${h}`)
  }
  // 均匀：十个桶里每桶都有
  const bins = new Array(10).fill(0)
  for (let i = 1; i <= 5000; i++) bins[Math.floor(speedHash(i) * 10)]++
  assert.ok(bins.every((b) => b > 350 && b < 650), `散列分布：${bins.join(',')}`)

  const w = make('fields')
  const speeds: number[] = []
  for (let i = 0; i < 300; i++) speeds.push(w.spawnEnemy('drone', 5000, 5000, { spawnT: 0 }).speed)
  const lo = Math.min(...speeds)
  const hi = Math.max(...speeds)
  const mid = (lo + hi) / 2
  assert.ok((hi - lo) / mid > WAVE.speedSpread * 1.6, `杂兵之间应有明显的速度差：${lo.toFixed(1)} ~ ${hi.toFixed(1)}`)
  assert.ok((hi - lo) / mid < WAVE.speedSpread * 2.2, '但不能离谱')
  const brutes = new Set<number>()
  for (let i = 0; i < 20; i++) brutes.add(w.spawnEnemy('brute', 5000, 5000, { spawnT: 0 }).speed)
  assert.equal(brutes.size, 1, '特殊兵种的速度是固定的（玩家要能读懂它们）')
  const elites = new Set<number>()
  for (let i = 0; i < 20; i++) elites.add(w.spawnEnemy('drone', 5000, 5000, { spawnT: 0, elite: true }).speed)
  assert.equal(elites.size, 1, '精英同理')
})

test('阵型带噪声：同一个圈上的怪半径各不相同；纵队 / 墙不是整齐的网格', () => {
  const w = make('fields')
  pacifist(w)
  const d = dir(w) as unknown as { spawnPulse(w: World, pd: PulseDef, scale: number, a: number): void }
  const before = new Set(w.enemies)
  d.spawnPulse(w, { form: 'ring', enemy: 'swarmer', w: 2 }, 1, 0)
  const ring = w.enemies.filter((e) => !before.has(e))
  assert.ok(ring.length >= 40)
  const p = w.player
  // 沿射线方向量边缘距离：各只的"出画面距离"差异明显（不是同心圆）
  const margins = ring.map((e) => {
    const a = Math.atan2(e.y - p.y, e.x - p.x)
    return Math.hypot(e.x - p.x, e.y - p.y) - w.edgeDist(a, 0)
  })
  const span = Math.max(...margins) - Math.min(...margins)
  assert.ok(span > 60, `圈的纵深应有起伏：${span.toFixed(0)}`)

  const b2 = new Set(w.enemies)
  d.spawnPulse(w, { form: 'lanes', enemy: 'drone', w: 2 }, 1, Math.PI / 3)
  const lanes = w.enemies.filter((e) => !b2.has(e))
  const ax = Math.cos(Math.PI / 3)
  const ay = Math.sin(Math.PI / 3)
  const lat = lanes.map((e) => -(e.x - p.x) * ay + (e.y - p.y) * ax)
  // 同一纵队里的怪横向位置有抖动：不抖的话只会有"纵队数"那么几种取值（精确到 0.1px）
  const distinct = new Set(lat.map((v) => Math.round(v * 10))).size
  assert.ok(distinct > lanes.length * 0.9, `纵队里每只怪的横向位置都不一样：${distinct} / ${lanes.length}`)
})

// ───────────────────────── 刷怪点贴着画面边缘 ─────────────────────────

test('edgeDist / edgeLine：沿射线刚好出画面；一整条垂线都在画面外', () => {
  const w = make('fields', [640, 360])
  assert.ok(Math.abs(w.edgeDist(0, 0) - 640) < 1e-6, '正右方 = 半宽')
  assert.ok(Math.abs(w.edgeDist(Math.PI / 2, 0) - 360) < 1e-6, '正下方 = 半高')
  assert.ok(Math.abs(w.edgeDist(Math.PI / 2, 50) - 410) < 1e-6)
  assert.ok(w.edgeDist(Math.PI / 2, 0) < w.viewR, '宽屏上下方向不用绕到对角线那么远')
  const p = w.player
  for (const view of [[640, 360], [195, 420], [300, 300]] as const) {
    w.viewHalfW = view[0]
    w.viewHalfH = view[1]
    for (let i = 0; i < 360; i += 3) {
      const a = (i / 180) * Math.PI
      const d = w.edgeDist(a, 24)
      const x = p.x + Math.cos(a) * d
      const y = p.y + Math.sin(a) * d
      assert.ok(offscreen(w, { x, y }), `edgeDist 的点在画面外：角度 ${i}°、视野 ${view.join('×')}`)
      // 整条垂线：任取横向偏移
      const D = w.edgeLine(a, 24)
      for (const L of [-900, -400, -150, 0, 150, 400, 900]) {
        const lx = p.x + Math.cos(a) * D - Math.sin(a) * L
        const ly = p.y + Math.sin(a) * D + Math.cos(a) * L
        assert.ok(offscreen(w, { x: lx, y: ly }), `edgeLine 的垂线在画面外：角度 ${i}°、偏移 ${L}、视野 ${view.join('×')}`)
      }
    }
  }
})

test('所有阵型 × 宽屏 / 竖屏：刷出来的怪一开始都在画面之外（不会凭空蹦到屏幕里）', () => {
  const pds: PulseDef[] = FORMS.filter((f): f is Exclude<Form, 'strike' | 'well'> => f !== 'strike' && f !== 'well').map((form) => ({ form, enemy: 'swarmer', w: 3 }))
  for (const view of [[640, 360], [195, 420], [360, 360]] as const) {
    for (const pd of pds) {
      for (const a of [0, 0.7, 1.57, 2.4, 3.14, 4.1, 5.0]) {
        const w = make('fields', [view[0], view[1]])
        pacifist(w)
        flowOff(() => {
          const d = dir(w) as unknown as { spawnPulse(w: World, pd: PulseDef, scale: number, a: number): void }
          d.spawnPulse(w, pd, 1, a)
          // 逐只放出的人流 / 旋臂：把它们的刷怪时间走完，边走边查（走的是导演自己的计时，怪还没来得及移动太多）
          const seen = new Set<Enemy>()
          for (let t = 0; t < 8; t += 0.05) {
            ;(dir(w) as unknown as { tickJobs(w: World, dt: number): void }).tickJobs(w, 0.05)
            for (const e of w.enemies) {
              if (seen.has(e)) continue
              seen.add(e)
              assert.ok(offscreen(w, e, 0), `${pd.form} 角度 ${a}、视野 ${view.join('×')}：刷出的怪不能落在画面里（${Math.round(e.x - w.player.x)}, ${Math.round(e.y - w.player.y)}）`)
            }
          }
          assert.ok(seen.size >= 20, `${pd.form}：该有一大群，实际 ${seen.size}`)
        })
      }
    }
  }
})

test('补兵的团：刷出来的怪一开始都在画面之外（宽屏 / 竖屏）', () => {
  for (const view of [[640, 360], [195, 420], [360, 360]] as const) {
    const w = make('fields', [view[0], view[1]])
    pacifist(w)
    const spawns = recordSpawns(w)
    for (let t = 0; t < WAVE.firstAt - 0.4; t += DT) w.update(DT, input)
    assert.ok(spawns.length >= 3, `开局就有补兵：${spawns.length}`)
    for (const s of spawns) assert.ok(offscreen(w, s), `补兵刚出生就在画面里：${Math.round(s.x - w.player.x)}, ${Math.round(s.y - w.player.y)}（视野 ${view.join('×')}）`)
  }
})

// ───────────────────────── 掉队的杂兵 ─────────────────────────

test('掉队的杂兵：离得远就加速追赶（特殊兵种不会）；远到离谱就回收到画面边缘', () => {
  const w = make('fields')
  pacifist(w)
  flowOff(() => {
    const p = w.player
    const R = w.viewR * 1.5 // 在追赶线之外、回收线之内
    const f = w.spawnEnemy('drone', p.x + R, p.y, { spawnT: 0 })
    const s = w.spawnEnemy('brute', p.x - R, p.y, { spawnT: 0 })
    const f2 = w.spawnEnemy('drone', p.x, p.y + R, { spawnT: 0 })
    f2.speed = f.speed
    const x0 = f.x
    const sx0 = s.x
    const fSpeed = f.speed
    const sSpeed = s.speed
    w.update(DT, input)
    const fMoved = Math.abs(f.x - x0) / DT
    const sMoved = Math.abs(s.x - sx0) / DT
    assert.ok(fMoved > fSpeed * (WAVE.catchUp - 0.2), `杂兵追赶：每秒 ${fMoved.toFixed(0)}，基础速度 ${fSpeed.toFixed(0)}`)
    assert.ok(sMoved < sSpeed * 1.2, `特殊兵种不吃追赶加速：每秒 ${sMoved.toFixed(0)}，基础速度 ${sSpeed.toFixed(0)}`)

    const far = w.spawnEnemy('drone', p.x + w.viewR * 2, p.y, { spawnT: 0 })
    w.update(DT, input)
    assert.ok(Math.hypot(far.x - p.x, far.y - p.y) < w.viewR * 1.5, '被甩得太远的杂兵直接回收到画面边缘附近')
  })
})

// ───────────────────────── 经验与群杀播报 ─────────────────────────

test('经验曲线（v1.15 重拟合）：单调上升，首级不太便宜，30 级之后依然在涨', () => {
  let prev = 0
  for (let l = 1; l <= 60; l++) {
    const x = xpForLevel(l)
    assert.ok(x > prev, `第 ${l} 级的升级经验应大于上一级`)
    prev = x
  }
  assert.ok(xpForLevel(1) >= 30, '第一级不应该一两下就升（开局有 40~50 个怪的量）')
  assert.ok(xpForLevel(30) > xpForLevel(15) * 2, '后期每级明显更贵（经验供给随波数涨）')
})

test('群杀播报（v1.15）：档位整体上移、冷却拉长，整局只剩二三十次大场面', () => {
  assert.ok(MULTI.tiers[0] >= 50, `第一档 ≥ 50：${MULTI.tiers[0]}`)
  for (let i = 1; i < MULTI.tiers.length; i++) assert.ok(MULTI.tiers[i] > MULTI.tiers[i - 1])
  assert.ok(MULTI.cooldown >= 6)
})
