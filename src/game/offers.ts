import { MAX_PASSIVES, MAX_WEAPONS, PASSIVE_IDS, WEAPON_IDS, WEAPON_MAX_LEVEL } from '../data/ids'
import type { PassiveId, WeaponId } from '../data/ids'
import { PASSIVES } from '../data/passives'
import { WEAPONS } from '../data/weapons'
import { WeaponInst } from './entities'
import type { World } from './world'

/** 升级时给玩家挑的一张卡 */
export type Offer =
  | { kind: 'weapon'; id: WeaponId; to: number; isNew: boolean; evolve: boolean }
  | { kind: 'passive'; id: PassiveId; to: number; isNew: boolean }
  | { kind: 'heal' }
  | { kind: 'cores'; n: number }

/** 用于"放逐"：同一张卡的稳定标识 */
export function offerKey(o: Offer): string {
  switch (o.kind) {
    case 'weapon':
      return `w:${o.id}:${o.evolve ? 'evo' : o.isNew ? 'new' : 'up'}`
    case 'passive':
      return `p:${o.id}`
    case 'heal':
      return 'heal'
    default:
      return 'cores'
  }
}

interface Cand {
  offer: Offer
  weight: number
}

export function buildOffers(w: World): Offer[] {
  const p = w.player
  const cands: Cand[] = []
  const evolves: Offer[] = []
  const early = p.level <= 5
  const owned = new Set<WeaponId>()

  for (const wi of p.weapons) {
    owned.add(wi.id)
    const def = WEAPONS[wi.id]
    if (wi.evolved) continue
    if (wi.level >= WEAPON_MAX_LEVEL) {
      if ((p.passives[def.evolvesWith] ?? 0) > 0) {
        evolves.push({ kind: 'weapon', id: wi.id, to: wi.level, isNew: false, evolve: true })
      }
    } else {
      cands.push({
        offer: { kind: 'weapon', id: wi.id, to: wi.level + 1, isNew: false, evolve: false },
        weight: 3,
      })
    }
  }

  if (p.weapons.length < MAX_WEAPONS) {
    for (const id of WEAPON_IDS) {
      if (owned.has(id)) continue
      cands.push({
        offer: { kind: 'weapon', id, to: 1, isNew: true, evolve: false },
        weight: early ? 3.4 : 2.2,
      })
    }
  }

  // 被动：和已满级武器配对的优先
  const partnerOfOwned = new Set<PassiveId>()
  for (const wi of p.weapons) if (!wi.evolved) partnerOfOwned.add(WEAPONS[wi.id].evolvesWith)

  const passiveCount = Object.values(p.passives).filter((v) => (v ?? 0) > 0).length
  for (const id of PASSIVE_IDS) {
    const lv = p.passives[id] ?? 0
    const max = PASSIVES[id].maxLevel
    if (lv >= max) continue
    if (lv === 0 && passiveCount >= MAX_PASSIVES) continue
    let weight = lv > 0 ? 2.2 : 1.6
    if (partnerOfOwned.has(id)) weight *= 1.6
    cands.push({ offer: { kind: 'passive', id, to: lv + 1, isNew: lv === 0 }, weight })
  }

  const filtered = cands.filter((c) => !w.banished.has(offerKey(c.offer)))

  const want = 3 + (w.rng.chance(p.st.luck) ? 1 : 0)
  const out: Offer[] = []

  // 进化卡永远排第一，且稳定出现
  if (evolves.length > 0) out.push(evolves[0])

  const pool = filtered.slice()
  while (out.length < want && pool.length > 0) {
    const pick = w.rng.weighted(pool, (c) => c.weight)
    if (!pick) break
    out.push(pick.offer)
    pool.splice(pool.indexOf(pick), 1)
  }

  // 全部满级时的保底
  while (out.length < Math.min(want, 3)) {
    out.push(out.some((o) => o.kind === 'heal') ? { kind: 'cores', n: 25 } : { kind: 'heal' })
  }
  return out
}

/** 应用一张卡的效果 */
export function applyOffer(w: World, o: Offer): void {
  const p = w.player
  switch (o.kind) {
    case 'weapon': {
      if (o.isNew) {
        const wi = new WeaponInst(o.id, p.weapons.length)
        p.weapons.push(wi)
        w.stats.maxWeapons = Math.max(w.stats.maxWeapons, p.weapons.length)
      } else {
        const wi = p.weapons.find((x) => x.id === o.id)
        if (wi) {
          if (o.evolve) {
            wi.evolved = true
            wi.timer = 0.2
            w.stats.evolves++
            w.emit({ t: 'evolve', w: o.id })
          } else {
            wi.level = o.to
          }
        }
      }
      break
    }
    case 'passive':
      p.passives[o.id] = o.to
      break
    case 'heal':
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.4)
      break
    case 'cores':
      w.bonusCores += o.n
      break
  }
  w.recalc()
}
