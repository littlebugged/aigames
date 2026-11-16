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
import { FORMS, WAVE_TAGS } from '../src/data/waves'
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

test('星区：12 波脚本合法——时长之和 = 星区长度，敌人 / 阵型 / 小队参数都有效，且在 Boss 之前', () => {
  for (const sid of SECTOR_IDS) {
    const s = SECTORS[sid]
    assert.ok(BOSS_IDS.includes(s.boss))
    assert.equal(s.waves.length, 12, `${sid} 应是 12 波`)
    assert.equal(
      s.waves.reduce((n, w) => n + w.len, 0),
      s.length,
      `${sid} 各波时长之和应等于星区长度`,
    )
    for (const [i, wv] of s.waves.entries()) {
      const at = `${sid} 第 ${i + 1} 波`
      assert.ok(WAVE_TAGS.includes(wv.tag), `${at} 主题 ${wv.tag} 不存在`)
      assert.ok(wv.len >= 40, `${at} 太短`)
      assert.ok(wv.pulses.length >= 4, `${at} 脉冲太少，不成"攻势"`)
      for (const pd of wv.pulses) {
        assert.ok(FORMS.includes(pd.form), `${at} 阵型 ${pd.form} 不存在`)
        if (pd.form === 'strike' || pd.form === 'well') assert.ok((pd.n ?? 0) >= 1, `${at} ${pd.form} 需要数量 n`)
        else {
          assert.ok(pd.enemy && ENEMIES[pd.enemy], `${at} 脉冲敌人 ${pd.enemy}`)
          assert.equal(ENEMIES[pd.enemy].tier, 'fodder', `${at} 脉冲里只能是杂兵（特殊兵种走小队）`)
          assert.ok(pd.w > 0, `${at} 数量权重必须为正`)
        }
        if (pd.mix) assert.equal(ENEMIES[pd.mix].tier, 'fodder', `${at} 混编只能是杂兵`)
        if (pd.warn) assert.ok(['pincer', 'wall', 'lanes', 'stream'].includes(pd.form), `${at} 只有从边缘压来的阵型才有伏击预警`)
      }
      for (const sq of wv.squads ?? []) {
        assert.ok(ENEMIES[sq.enemy], `${at} 小队敌人 ${sq.enemy}`)
        assert.equal(ENEMIES[sq.enemy].tier, 'special', `${at} 小队里应是特殊兵种`)
        assert.ok(sq.n >= 1)
        assert.ok((sq.after ?? 1) < wv.pulses.length, `${at} 小队跟在不存在的脉冲后面`)
      }
    }
    // 名单 = 脚本里出现过的兵种
    assert.ok(s.roster.length >= 3)
    for (const r of s.roster) assert.ok(ENEMIES[r], `${sid} 名单里的 ${r} 不存在`)
    // 小 Boss：落在"mini"主题的波次里，每个星区两只，体型档位合法，不是本星区自己的 Boss
    assert.equal(s.minis.length, 2, `${sid} 应有两只小 Boss`)
    for (const m of s.minis) {
      assert.ok(BOSS_IDS.includes(m.boss) && m.boss !== s.boss, `${sid} 的小 Boss 应该是别的星区的先遣体`)
      assert.equal(s.waves[m.wave - 1]?.tag, 'mini', `${sid} 第 ${m.wave} 波应是 mini 主题`)
      assert.ok(m.tier === 1 || m.tier === 2)
    }
    assert.ok(new Set(s.minis.map((m) => m.wave)).size === s.minis.length)
    assert.ok(s.minis[0].tier < s.minis[1].tier, `${sid} 后一只小 Boss 应更强`)
    // Boss 战补兵
    assert.ok(s.adds.length >= 3, `${sid} 缺少 Boss 战补兵脉冲`)
    for (const pd of s.adds) assert.ok(pd.enemy && ENEMIES[pd.enemy] && ENEMIES[pd.enemy].tier === 'fodder')
    if (s.requires) assert.ok(SECTOR_IDS.includes(s.requires))
  }
  assert.equal(SECTORS.fields.requires, null, '第一个星区必须默认开放')
})

test('星区：每个星区都有自己的"新体验"机关（伏击 / 引力井 / 陨火），第一个星区是纯粹的割草', () => {
  const has = (sid: (typeof SECTOR_IDS)[number], f: (pd: { form: string; warn?: number }) => boolean): boolean => SECTORS[sid].waves.some((wv) => wv.pulses.some(f))
  assert.ok(has('wasteland', (pd) => !!pd.warn), '荒原：带预警箭头的伏击')
  assert.ok(has('void', (pd) => pd.form === 'well'), '虚空：引力井')
  assert.ok(has('crucible', (pd) => pd.form === 'strike'), '熔炉：陨火')
  assert.ok(!has('fields', (pd) => pd.form === 'well' || pd.form === 'strike' || !!pd.warn), '原野：没有机关，纯割草')
  // 四个星区的特殊兵种阵容各不相同
  const sig = SECTOR_IDS.map((sid) => [...SECTORS[sid].roster].sort().join(','))
  assert.equal(new Set(sig).size, SECTOR_IDS.length, '兵种阵容应各不相同')
})

test('兵种分层：杂兵脆且不随时间变厚，特殊兵种厚且持续成长', () => {
  let fodder = 0
  let special = 0
  for (const id of ENEMY_IDS) {
    const e = ENEMIES[id]
    if (e.tier === 'fodder') {
      fodder++
      assert.ok(e.hp <= 40, `${id} 杂兵血量 ${e.hp} 太厚，割不动`)
      assert.equal(e.grow, 0, `${id} 杂兵不该随时间变厚——难度靠数量`)
      assert.ok(e.xp <= 2, `${id}`)
    } else {
      special++
      assert.ok(e.hp >= 100, `${id} 特殊兵种血量 ${e.hp} 太薄，会被顺手割掉`)
      assert.ok(e.grow >= 0.5, `${id} 特殊兵种应持续成长`)
    }
  }
  assert.ok(fodder >= 3 && special >= 6, `杂兵 ${fodder} 种 / 特殊兵种 ${special} 种`)
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
