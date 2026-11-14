import { PASSIVES, formatPassiveValue } from '../data/passives'
import { MAX_PASSIVES, MAX_WEAPONS, WEAPON_IDS, WEAPON_MAX_LEVEL, type PassiveId, type WeaponId } from '../data/ids'
import { WEAPONS, type WStats } from '../data/weapons'
import type { Offer } from '../game/offers'
import { resolveWeaponStats } from '../game/stats'
import type { World } from '../game/world'
import { dictKeys, dyn, fmtInt, t, type Key } from '../i18n'
import type { UiCtx } from './ctx'
import { clear, h, iconEl, svgEl } from './dom'
import { passiveIcon, uiIcon, weaponIcon } from './icons'
import { pips } from './parts'

const KEYSET = new Set<string>(dictKeys)

function statLabel(wid: WeaponId, key: keyof WStats): string {
  const specific = `stat.${wid}.${key}`
  return t((KEYSET.has(specific) ? specific : `stat.${key}`) as Key)
}

function fmtStat(key: keyof WStats, v: number): string {
  switch (key) {
    case 'cooldown':
    case 'tick':
    case 'duration':
      return `${v.toFixed(2).replace(/\.?0+$/, '')}${t('stat.unit.s')}`
    case 'damage':
      return v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '')
    case 'count':
      return String(Math.round(v * 10) / 10)
    case 'heal':
      return v.toFixed(2).replace(/\.?0+$/, '')
    default:
      return String(Math.round(v))
  }
}

/** 数值越小越好的项 */
const LOWER_BETTER: Partial<Record<keyof WStats, true>> = { cooldown: true, tick: true }

/**
 * 卡面上的"等级行"：Lv.7 → Lv.8 + 等级点（已有的点 + 本次新增的高亮点）。
 * 升到顶时额外标出"升至满级"，避免把"升级后满格"误读成"已经满级"。
 */
function levelLine(from: number, to: number, max: number, color: string): HTMLElement {
  return h(
    'div',
    { class: 'lv-line' },
    h('span', null, from > 0 ? `${t('lv.toLevel', { n: from })} → ` : '', h('b', null, t('lv.toLevel', { n: to }))),
    pips(to, max, color, from),
    to >= max ? h('span', { class: 'lv-maxtag' }, t('lv.toMax')) : null,
  )
}

/** 当前构筑的一个小图标（等级角标；满级金边；进化 ★；空位虚线框） */
function chip(icon: string | null, color: string, label: string, kind: '' | 'maxed' | 'evolved' | 'empty', title = ''): HTMLElement {
  return h(
    'div',
    { class: `lv-chip ${kind}`, style: { '--c': color }, title: title || null },
    icon ? svgEl(icon) : null,
    label ? h('em', null, label) : null,
  )
}

/** 升级 / 补给箱的选卡面板 */
export class LevelUpOverlay {
  readonly el: HTMLElement
  private readonly title = h('h2', { class: 'lv-title' })
  private readonly cardsEl = h('div', { class: 'lv-cards' })
  private readonly buildEl = h('div', { class: 'lv-build' })
  private readonly tools = h('div', { class: 'lv-tools' })
  private readonly banishHint = h('p', { class: 'lv-banish-hint', hidden: true }, t('lv.banishHint'))
  private world: World | null = null
  private banishMode = false
  private openedAt = 0
  private focusIdx = 0
  isOpen = false

  constructor(
    private readonly ctx: UiCtx,
    private readonly cb: { choose(i: number): void; reroll(): boolean; banish(i: number): boolean },
  ) {
    this.el = h('div', { class: 'overlay levelup', hidden: true, role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'lv-wrap' }, this.title, this.cardsEl, this.buildEl, this.banishHint, this.tools))
  }

  show(w: World): void {
    this.world = w
    this.banishMode = false
    this.isOpen = true
    this.openedAt = performance.now()
    this.focusIdx = 0
    this.el.hidden = false
    this.render(true)
    this.ctx.sfx('open')
  }

  hide(): void {
    this.isOpen = false
    this.el.hidden = true
    this.world = null
  }

  /** 选卡之后若还有连续升级，面板内容刷新为下一组 */
  refresh(): void {
    this.banishMode = false
    this.openedAt = performance.now()
    this.focusIdx = 0
    this.render(true)
  }

  private choose(i: number): void {
    if (!this.world || performance.now() - this.openedAt < 320) return
    if (this.banishMode) {
      if (this.cb.banish(i)) {
        this.ctx.sfx('deny')
        this.banishMode = false
        this.openedAt = performance.now() - 200
        this.render(false)
      } else this.ctx.sfx('deny')
      return
    }
    this.ctx.sfx('confirm')
    this.cb.choose(i)
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.isOpen || !this.world) return false
    const n = this.world.offers.length
    const k = e.key
    if (k >= '1' && k <= '9') {
      const i = Number(k) - 1
      if (i < n) {
        this.choose(i)
        return true
      }
    }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      this.focusCard((this.focusIdx + n - 1) % n)
      return true
    }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      this.focusCard((this.focusIdx + 1) % n)
      return true
    }
    if (k === 'Enter' || k === ' ') {
      const a = document.activeElement as HTMLElement | null
      if (a && this.el.contains(a) && a.tagName === 'BUTTON') return false // 交给按钮自己的默认行为
      this.choose(this.focusIdx)
      return true
    }
    if (k === 'r' || k === 'R') {
      this.doReroll()
      return true
    }
    if (k === 'b' || k === 'B') {
      this.toggleBanish()
      return true
    }
    return false
  }

  navigate(dir: 'left' | 'right' | 'up' | 'down' | 'confirm' | 'back'): void {
    if (!this.world) return
    const n = this.world.offers.length
    if (dir === 'left') this.focusCard((this.focusIdx + n - 1) % n)
    else if (dir === 'right') this.focusCard((this.focusIdx + 1) % n)
    else if (dir === 'confirm') this.choose(this.focusIdx)
  }

  private focusCard(i: number): void {
    this.focusIdx = i
    const cards = this.cardsEl.querySelectorAll<HTMLElement>('.lv-card')
    cards[i]?.focus({ preventScroll: true })
    this.ctx.sfx('hover')
  }

  private doReroll(): void {
    if (!this.world || performance.now() - this.openedAt < 200) return
    if (this.cb.reroll()) {
      this.ctx.sfx('reroll')
      this.banishMode = false
      this.render(true)
    } else this.ctx.sfx('deny')
  }

  private toggleBanish(): void {
    if (!this.world || this.world.banishes <= 0) return this.ctx.sfx('deny')
    this.banishMode = !this.banishMode
    this.ctx.sfx('click')
    this.render(false)
  }

  private render(animate: boolean): void {
    const w = this.world
    if (!w) return
    this.title.textContent = w.offerSource === 'chest' ? t('lv.chestTitle') : t('lv.title')
    this.el.classList.toggle('chest', w.offerSource === 'chest')
    this.el.classList.toggle('banishing', this.banishMode)
    this.banishHint.hidden = !this.banishMode
    clear(this.cardsEl)
    w.offers.forEach((o, i) => {
      const c = this.card(w, o, i)
      if (animate) c.style.animationDelay = `${i * 70}ms`
      else c.classList.add('static')
      this.cardsEl.appendChild(c)
    })
    this.renderBuild(w)
    clear(this.tools)
    const showTools = w.rerolls > 0 || w.banishes > 0 || this.banishMode
    if (showTools) {
      this.tools.append(
        h(
          'button',
          { class: 'btn sm', disabled: w.rerolls > 0 ? null : true, onClick: () => this.doReroll() },
          iconEl('dice'),
          t('lv.reroll', { n: w.rerolls }),
          h('kbd', null, 'R'),
        ),
        h(
          'button',
          { class: `btn sm ${this.banishMode ? 'danger' : ''}`, disabled: w.banishes > 0 || this.banishMode ? null : true, onClick: () => this.toggleBanish() },
          iconEl('ban'),
          this.banishMode ? t('lv.banishCancel') : t('lv.banish', { n: w.banishes }),
          h('kbd', null, 'B'),
        ),
      )
    }
    queueMicrotask(() => this.cardsEl.querySelectorAll<HTMLElement>('.lv-card')[this.focusIdx]?.focus({ preventScroll: true }))
  }

  /** 卡片下方的"当前构筑"：让玩家看到栏位上限（6/6）、哪些已经满级——满级的不会再出现在候选里 */
  private renderBuild(w: World): void {
    const p = w.player
    clear(this.buildEl)

    const weaponChips = p.weapons.map((wi) => {
      const name = t(dyn(wi.evolved ? `weapon.${wi.id}.evoName` : `weapon.${wi.id}.name`))
      if (wi.evolved) return chip(weaponIcon(wi.id), '#ffd84a', '★', 'evolved', `${name} ★`)
      const maxed = wi.level >= WEAPON_MAX_LEVEL
      return chip(weaponIcon(wi.id), WEAPONS[wi.id].color, maxed ? 'MAX' : String(wi.level), maxed ? 'maxed' : '', `${name} Lv.${wi.level}`)
    })
    for (let i = p.weapons.length; i < MAX_WEAPONS; i++) weaponChips.push(chip(null, '#8aa0d0', '', 'empty'))

    const gear = (Object.entries(p.passives) as [PassiveId, number][]).filter(([, lv]) => lv > 0)
    const gearChips = gear.map(([id, lv]) => {
      const def = PASSIVES[id]
      const maxed = lv >= def.maxLevel
      return chip(passiveIcon(id), def.color, maxed ? 'MAX' : String(lv), maxed ? 'maxed' : '', `${t(dyn(`passive.${id}.name`))} Lv.${lv}`)
    })
    for (let i = gear.length; i < MAX_PASSIVES; i++) gearChips.push(chip(null, '#8aa0d0', '', 'empty'))

    const group = (label: string, n: number, cap: number, chips: HTMLElement[]): HTMLElement =>
      h(
        'div',
        { class: `lv-grp ${n >= cap ? 'full' : ''}` },
        h('div', { class: 'lv-grp-h' }, h('span', null, label), h('b', null, `${n}/${cap}`), n >= cap ? h('i', null, t('lv.slotFull')) : null),
        h('div', { class: 'lv-chips' }, ...chips),
      )
    this.buildEl.append(
      group(t('hud.weapons'), p.weapons.length, MAX_WEAPONS, weaponChips),
      group(t('hud.passives'), gear.length, MAX_PASSIVES, gearChips),
    )
  }

  private card(w: World, o: Offer, i: number): HTMLElement {
    const p = w.player
    let badge = ''
    let badgeCls = ''
    let name = ''
    let icon = ''
    let color = '#3df2ff'
    let desc = ''
    let line: HTMLElement | null = null
    let rows: HTMLElement[] = []
    let hint: HTMLElement | null = null
    let kind = 'weapon'

    if (o.kind === 'weapon') {
      const def = WEAPONS[o.id]
      color = def.color
      icon = weaponIcon(o.id)
      const wi = p.weapons.find((x) => x.id === o.id)
      const toStats = resolveWeaponStats(o.id, o.to, o.evolve, p.st)
      if (o.evolve) {
        kind = 'evolve'
        badge = t('lv.evolve')
        badgeCls = 'evolve'
        name = t(dyn(`weapon.${o.id}.evoName`))
        desc = t(dyn(`weapon.${o.id}.evoDesc`))
        color = '#ffd84a'
        const fromStats = resolveWeaponStats(o.id, o.to, false, p.st)
        rows = this.diffRows(o.id, fromStats, toStats, true)
        line = h('div', { class: 'lv-line' }, h('span', { class: 'star' }, t('lv.evoLine')))
      } else if (o.isNew) {
        badge = t('lv.new')
        badgeCls = 'new'
        name = t(dyn(`weapon.${o.id}.name`))
        desc = t(dyn(`weapon.${o.id}.desc`))
        rows = this.diffRows(o.id, null, toStats, false)
        line = levelLine(0, 1, WEAPON_MAX_LEVEL, color)
      } else {
        badge = t('lv.upgrade')
        badgeCls = 'up'
        name = t(dyn(`weapon.${o.id}.name`))
        desc = t(dyn(`weapon.${o.id}.desc`))
        const fromStats = resolveWeaponStats(o.id, o.to - 1, false, p.st)
        rows = this.diffRows(o.id, fromStats, toStats, false)
        line = levelLine(o.to - 1, o.to, WEAPON_MAX_LEVEL, color)
      }
      if (!o.evolve) {
        const partner = def.evolvesWith
        const owns = (p.passives[partner] ?? 0) > 0
        hint = h(
          'div',
          { class: `lv-hint ${owns ? 'ok' : ''}` },
          svgEl(passiveIcon(partner)),
          h('span', null, t('lv.pairsWith', { name: t(dyn(`passive.${partner}.name`)) })),
          owns ? iconEl('check') : null,
        )
      }
      void wi
    } else if (o.kind === 'passive') {
      kind = 'passive'
      const def = PASSIVES[o.id]
      color = def.color
      icon = passiveIcon(o.id)
      badge = o.isNew ? t('lv.passive') : t('lv.upgrade')
      badgeCls = 'passive'
      name = t(dyn(`passive.${o.id}.name`))
      desc = t(dyn(`passive.${o.id}.desc`))
      const prev = o.to - 1
      rows = [
        h(
          'div',
          { class: 'row' },
          h('span', null, name),
          h('b', null, prev > 0 ? h('s', null, formatPassiveValue(def, prev)) : null, prev > 0 ? ' → ' : '', h('em', { class: 'up' }, formatPassiveValue(def, o.to))),
        ),
      ]
      line = levelLine(o.to - 1, o.to, def.maxLevel, color)
      const partners = WEAPON_IDS.filter((wid) => WEAPONS[wid].evolvesWith === o.id)
      const owned = partners.find((wid) => p.weapons.some((x) => x.id === wid && !x.evolved))
      const shown = owned ?? partners[0]
      if (shown) {
        hint = h(
          'div',
          { class: `lv-hint ${owned ? 'ok' : ''}` },
          svgEl(weaponIcon(shown)),
          h('span', null, t('lv.pairsWith', { name: t(dyn(`weapon.${shown}.name`)) })),
          owned ? iconEl('check') : null,
        )
      }
    } else if (o.kind === 'heal') {
      kind = 'heal'
      color = '#6dff8a'
      icon = uiIcon('heal')
      badge = t('lv.upgrade')
      badgeCls = 'heal'
      name = t('lv.heal')
      desc = t('lv.healDesc')
    } else {
      kind = 'cores'
      color = '#d58bff'
      icon = uiIcon('core')
      badge = t('lv.upgrade')
      badgeCls = 'cores'
      name = t('lv.cores')
      desc = t('lv.coresDesc', { n: fmtInt(o.n) })
    }

    return h(
      'button',
      {
        class: `lv-card ${kind}`,
        style: { '--c': color },
        onClick: () => {
          this.focusIdx = i
          this.choose(i)
        },
        onMouseEnter: () => {
          this.focusIdx = i
          this.ctx.sfx('hover')
        },
        'aria-label': name,
      },
      h('kbd', { class: 'lv-key' }, String(i + 1)),
      h('span', { class: `lv-badge ${badgeCls}` }, badge),
      h('div', { class: 'lv-ico' }, svgEl(icon)),
      h('h3', null, name),
      line,
      h('p', { class: 'lv-desc' }, desc),
      rows.length > 0 ? h('div', { class: 'lv-rows' }, ...rows) : null,
      hint,
      this.banishMode ? h('div', { class: 'lv-ban' }, iconEl('ban')) : null,
    )
  }

  private diffRows(wid: WeaponId, from: WStats | null, to: WStats, evolve: boolean): HTMLElement[] {
    const def = WEAPONS[wid]
    const out: HTMLElement[] = []
    for (const key of def.shown) {
      const b = to[key]
      const a = from ? from[key] : null
      if (a !== null && Math.abs(a - b) < 1e-6) continue
      let cls = ''
      if (a !== null) cls = (LOWER_BETTER[key] ? b < a : b > a) ? 'up' : 'down'
      out.push(
        h(
          'div',
          { class: 'row' },
          h('span', null, statLabel(wid, key)),
          h('b', null, a !== null ? h('s', null, fmtStat(key, a)) : null, a !== null ? ' → ' : '', h('em', { class: cls }, fmtStat(key, b))),
        ),
      )
    }
    if (evolve && out.length === 0) {
      out.push(h('div', { class: 'row' }, h('span', null, t('lv.evolve')), h('b', null, h('em', { class: 'up' }, '★'))))
    }
    return out
  }
}

export type { PassiveId }
