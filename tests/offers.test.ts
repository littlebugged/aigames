import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_PASSIVES, MAX_WEAPONS, PASSIVE_IDS, WEAPON_IDS, WEAPON_MAX_LEVEL } from '../src/data/ids'
import { PASSIVES } from '../src/data/passives'
import { WEAPONS } from '../src/data/weapons'
import { RNG } from '../src/engine/rng'
import { WeaponInst, type InputState } from '../src/game/entities'
import type { Offer } from '../src/game/offers'
import { World, type RunConfig } from '../src/game/world'

const input: InputState = { mx: 0, my: 0, dash: false }
const base: RunConfig = { seed: 1, ship: 'vanguard', sector: 'fields', threat: 0, meta: {} }

/** 逐张检查一组候选卡是否符合"上限"规则 */
function checkOffers(w: World, label: string): void {
  const p = w.player
  const passiveCount = PASSIVE_IDS.filter((id) => (p.passives[id] ?? 0) > 0).length
  const seen = new Set<string>()
  for (const o of w.offers) {
    const tag = `${label} ${JSON.stringify(o)}`
    const key = o.kind === 'weapon' || o.kind === 'passive' ? `${o.kind}:${o.id}` : o.kind
    assert.ok(!seen.has(key) || o.kind === 'cores', `候选里不应出现重复的卡：${tag}`)
    seen.add(key)

    if (o.kind === 'weapon') {
      const owned = p.weapons.find((x) => x.id === o.id)
      if (o.evolve) {
        assert.ok(owned && !owned.evolved && owned.level >= WEAPON_MAX_LEVEL, `只有满级且未进化的武器才能给进化卡：${tag}`)
        assert.ok((p.passives[WEAPONS[o.id].evolvesWith] ?? 0) > 0, `进化卡要求已持有配对被动：${tag}`)
      } else if (o.isNew) {
        assert.ok(!owned, `已持有的武器不能再作为"新武器"出现：${tag}`)
        assert.ok(p.weapons.length < MAX_WEAPONS, `武器栏已满（${MAX_WEAPONS}）时不应再给新武器：${tag}`)
        assert.equal(o.to, 1)
      } else {
        assert.ok(owned, `升级卡对应的武器必须已持有：${tag}`)
        assert.ok(!owned.evolved, `已进化的武器不应再出现升级卡：${tag}`)
        assert.ok(owned.level < WEAPON_MAX_LEVEL, `满级武器不应再出现升级卡：${tag}`)
        assert.equal(o.to, owned.level + 1, `升级卡的目标等级应为当前等级+1：${tag}`)
      }
    } else if (o.kind === 'passive') {
      const lv = p.passives[o.id] ?? 0
      assert.ok(lv < PASSIVES[o.id].maxLevel, `满级被动不应再出现：${tag}`)
      assert.equal(o.to, lv + 1, `被动卡的目标等级应为当前等级+1：${tag}`)
      assert.equal(o.isNew, lv === 0)
      if (o.isNew) assert.ok(passiveCount < MAX_PASSIVES, `被动栏已满（${MAX_PASSIVES}）时不应再给新被动：${tag}`)
    }
  }
}

/** 用随机选卡把一局推到很高的等级，沿途检查每一组候选 */
function climb(cfg: RunConfig, levels: number, seed: number): World {
  const w = new World(cfg)
  const rng = new RNG(seed)
  for (let n = 0; n < levels; n++) {
    w.addXp(w.player.xpNext)
    w.update(1 / 60, input)
    assert.equal(w.phase, 'levelup')
    while (w.phase === 'levelup') {
      checkOffers(w, `seed=${seed} lv=${w.player.level}`)
      w.choose(rng.int(0, w.offers.length))
    }
    assert.ok(w.player.weapons.length <= MAX_WEAPONS)
    assert.ok(PASSIVE_IDS.filter((id) => (w.player.passives[id] ?? 0) > 0).length <= MAX_PASSIVES)
  }
  return w
}

test('候选卡：武器 ≤ 6、被动 ≤ 6、等级不超上限，满级的不会再出现（多局随机压测）', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const ship = (['vanguard', 'phantom', 'bulwark', 'reaper'] as const)[seed % 4]
    climb({ ...base, ship, seed }, 130, seed * 7919)
  }
})

test('候选卡：全部满级后只剩进化卡与保底（回血 / 晶核）', () => {
  const w = new World(base)
  const p = w.player
  // 直接把两个栏位塞满，并全部升到上限
  p.weapons.length = 0
  WEAPON_IDS.slice(0, MAX_WEAPONS).forEach((id, i) => {
    const wi = new WeaponInst(id, i)
    wi.level = WEAPON_MAX_LEVEL
    p.weapons.push(wi)
  })
  for (const id of PASSIVE_IDS.slice(0, MAX_PASSIVES)) p.passives[id] = PASSIVES[id].maxLevel
  w.recalc()

  w.addXp(w.player.xpNext)
  w.update(1 / 60, input)
  assert.equal(w.phase, 'levelup')
  checkOffers(w, 'maxed')
  const upgrades = w.offers.filter((o: Offer) => (o.kind === 'weapon' && !o.evolve) || o.kind === 'passive')
  assert.equal(upgrades.length, 0, '全部满级时不应出现任何升级 / 新卡')
  assert.ok(w.offers.length >= 3)
})
