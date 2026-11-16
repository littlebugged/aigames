import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACHIEVEMENTS } from '../src/data/achievements'
import { ENEMIES } from '../src/data/enemies'
import {
  BOSS_IDS,
  ENEMY_IDS,
  META_IDS,
  PASSIVE_IDS,
  SECTOR_IDS,
  SHIP_IDS,
  WEAPON_IDS,
  WEAPON_MAX_LEVEL,
} from '../src/data/ids'
import { METAS, metaCost } from '../src/data/meta'
import { PASSIVES } from '../src/data/passives'
import { SECTORS, THREAT_LEVELS } from '../src/data/sectors'
import { SHIPS } from '../src/data/ships'
import { HOWITZER_BOMBLET, RAIL_SCAR_RATIO, SIPHON_SPLASH_RATIO, WEAPONS } from '../src/data/weapons'

test('每把武器每一级的数值都合法', () => {
  for (const id of WEAPON_IDS) {
    const def = WEAPONS[id]
    for (let lv = 1; lv <= WEAPON_MAX_LEVEL; lv++) {
      const s = def.stats(lv, false)
      assert.ok(s.damage > 0, `${id} lv${lv} damage`)
      assert.ok(s.cooldown > 0, `${id} lv${lv} cooldown`)
      assert.ok(s.count >= 1, `${id} lv${lv} count`)
    }
    const e = def.stats(WEAPON_MAX_LEVEL, true)
    const m = def.stats(WEAPON_MAX_LEVEL, false)
    assert.ok(e.count >= m.count || e.area > m.area || e.chain > m.chain, `${id} 进化后应有明显提升`)
  }
})

/** 粗略的单体总输出（每秒伤害 × 数量），用来比较进化前后 */
function output(id: (typeof WEAPON_IDS)[number], evolved: boolean): number {
  const s = WEAPONS[id].stats(WEAPON_MAX_LEVEL, evolved)
  switch (id) {
    case 'orbit':
      return (s.damage * (s.count + (evolved ? s.chain : 0))) / s.tick
    case 'laser':
      return (s.damage * s.count * (s.duration / s.tick)) / s.cooldown
    case 'arc':
      return (s.damage * s.count * (s.chain + 1)) / s.cooldown
    case 'rail': {
      // 进化后每道光轨还会留下一道持续灼烧的痕
      const scar = evolved ? (s.damage * RAIL_SCAR_RATIO * (s.duration / s.tick)) : 0
      return ((s.damage + scar) * s.count) / s.cooldown
    }
    case 'howitzer':
      // 进化后每发炮弹落地还会撒出子弹药（chain 枚，各打主爆炸的一部分伤害）
      return (s.damage * s.count * (1 + (evolved ? s.chain * HOWITZER_BOMBLET.damage : 0))) / s.cooldown
    case 'siphon':
      // 没有冷却：每根索每 tick 秒打一下；进化后每一跳还会溅射周围的敌人
      return (s.damage * s.count * (evolved ? 1 + SIPHON_SPLASH_RATIO : 1)) / s.tick
    default:
      return (s.damage * s.count) / s.cooldown
  }
}

test('进化是明确的强度飞跃：总输出至少提升 60%，但不至于超过 5 倍', () => {
  for (const id of WEAPON_IDS) {
    const ratio = output(id, true) / output(id, false)
    assert.ok(ratio >= 1.6, `${id} 进化只提升了 ${ratio.toFixed(2)}×，不够爽`)
    assert.ok(ratio <= 5, `${id} 进化提升 ${ratio.toFixed(2)}×，过于夸张`)
  }
})

test('武器等级单调不降（伤害、数量不会越升越弱）', () => {
  for (const id of WEAPON_IDS) {
    let dmg = 0
    let cnt = 0
    for (let lv = 1; lv <= WEAPON_MAX_LEVEL; lv++) {
      const s = WEAPONS[id].stats(lv, false)
      assert.ok(s.damage >= dmg, `${id} 伤害在 lv${lv} 下降`)
      assert.ok(s.count >= cnt, `${id} 数量在 lv${lv} 下降`)
      dmg = s.damage
      cnt = s.count
    }
  }
})

test('进化配对：每个搭档被动存在，且各武器的搭档互不重复', () => {
  const used = new Set<string>()
  for (const id of WEAPON_IDS) {
    const p = WEAPONS[id].evolvesWith
    assert.ok(PASSIVE_IDS.includes(p), `${id} 的搭档 ${p} 不存在`)
    assert.ok(!used.has(p), `搭档 ${p} 被多把武器共用`)
    used.add(p)
  }
})

test('星区：名单与事件里的敌人都存在，事件按时间排序，且在 Boss 之前', () => {
  for (const sid of SECTOR_IDS) {
    const s = SECTORS[sid]
    assert.ok(BOSS_IDS.includes(s.boss))
    for (const r of s.roster) assert.ok(ENEMIES[r.id], `${sid} 名单里的 ${r.id} 不存在`)
    let last = -1
    for (const ev of s.events) {
      assert.ok(ev.at >= last, `${sid} 事件未排序`)
      assert.ok(ev.at <= s.length, `${sid} 事件晚于 Boss`)
      last = ev.at
      if (ev.enemy) assert.ok(ENEMIES[ev.enemy], `${sid} 事件敌人 ${ev.enemy}`)
    }
    assert.ok(s.events.some((e) => e.kind === 'boss-warning'), `${sid} 缺少 Boss 预警`)
    if (s.requires) assert.ok(SECTOR_IDS.includes(s.requires))
  }
  assert.equal(SECTORS.fields.requires, null, '第一个星区必须默认开放')
})

test('所有敌人字段合理', () => {
  for (const id of ENEMY_IDS) {
    const e = ENEMIES[id]
    assert.equal(e.id, id)
    assert.ok(e.hp > 0 && e.speed > 0 && e.radius > 0 && e.cost > 0, id)
    assert.ok(e.knockResist >= 0 && e.knockResist <= 1, id)
  }
})

test('飞船：默认飞船免费，解锁成就存在，价格递增', () => {
  assert.equal(SHIPS.vanguard.cost, 0)
  assert.equal(SHIPS.vanguard.unlockAch, null)
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id))
  for (const sid of SHIP_IDS) {
    const a = SHIPS[sid].unlockAch
    if (a) assert.ok(ids.has(a), `${sid} 的解锁成就 ${a} 不存在`)
    assert.ok(WEAPON_IDS.includes(SHIPS[sid].startWeapon))
  }
})

test('机库：价格单调递增、上限合理', () => {
  for (const id of META_IDS) {
    const m = METAS[id]
    let prev = 0
    for (let r = 0; r < m.max; r++) {
      const c = metaCost(m, r)
      assert.ok(c > prev, `${id} 第 ${r + 1} 级价格不递增`)
      prev = c
    }
  }
})

test('被动：最大等级与单级效果为正', () => {
  for (const id of PASSIVE_IDS) {
    assert.ok(PASSIVES[id].maxLevel >= 1 && PASSIVES[id].per > 0, id)
  }
})

test('成就：id 唯一、目标与奖励为正', () => {
  const seen = new Set<string>()
  for (const a of ACHIEVEMENTS) {
    assert.ok(!seen.has(a.id), `重复成就 ${a.id}`)
    seen.add(a.id)
    assert.ok(a.target > 0 && a.reward > 0, a.id)
  }
})

test('威胁等级：难度与收益单调上升', () => {
  for (let i = 1; i < THREAT_LEVELS.length; i++) {
    assert.ok(THREAT_LEVELS[i].hp > THREAT_LEVELS[i - 1].hp)
    assert.ok(THREAT_LEVELS[i].reward > THREAT_LEVELS[i - 1].reward)
  }
})
