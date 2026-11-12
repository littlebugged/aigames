import { PASSIVES } from '../data/passives'
import { WEAPONS } from '../data/weapons'
import { MAX_PASSIVES, MAX_WEAPONS, WEAPON_MAX_LEVEL } from '../data/ids'
import type { World } from '../game/world'
import { dyn, fmtInt, fmtTime, t } from '../i18n'
import type { UiCtx } from './ctx'
import { clear, h, iconEl, svgEl } from './dom'
import { passiveIcon, weaponIcon } from './icons'
import { pips } from './parts'

export class PauseOverlay {
  readonly el: HTMLElement
  private readonly body = h('div', { class: 'pause-body' })
  private confirming = false
  isOpen = false
  private world: World | null = null

  constructor(
    private readonly ctx: UiCtx,
    private readonly cb: { resume(): void; abandon(): void; settings(): void },
    title?: string,
  ) {
    this.el = h('div', { class: 'overlay pause', hidden: true, role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'pause-panel' }, h('h2', null, title ?? t('pause.title')), this.body))
  }

  show(w: World): void {
    this.world = w
    this.confirming = false
    this.isOpen = true
    this.el.hidden = false
    this.render()
    this.ctx.sfx('open')
    queueMicrotask(() => this.el.querySelector<HTMLElement>('.btn.primary')?.focus({ preventScroll: true }))
  }

  hide(): void {
    this.isOpen = false
    this.el.hidden = true
    this.world = null
  }

  refresh(): void {
    if (this.isOpen) this.render()
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (this.confirming) {
        this.confirming = false
        this.render()
      } else this.cb.resume()
      return true
    }
    return false
  }

  private render(): void {
    const w = this.world
    if (!w) return
    const p = w.player
    this.el.querySelector('h2')!.textContent = t('pause.title')
    clear(this.body)

    const weapons = p.weapons.map((wi) => {
      const def = WEAPONS[wi.id]
      const c = wi.evolved ? '#ffd84a' : def.color
      return h(
        'div',
        { class: `bi ${wi.evolved ? 'evolved' : ''}`, style: { '--c': c } },
        svgEl(weaponIcon(wi.id)),
        h('div', { class: 'bi-main' }, h('b', null, t(dyn(wi.evolved ? `weapon.${wi.id}.evoName` : `weapon.${wi.id}.name`))), pips(wi.evolved ? WEAPON_MAX_LEVEL : wi.level, WEAPON_MAX_LEVEL, c)),
        h('em', { class: wi.evolved || wi.level >= WEAPON_MAX_LEVEL ? 'max' : '' }, wi.evolved ? '★' : wi.level >= WEAPON_MAX_LEVEL ? 'MAX' : `Lv.${wi.level}`),
      )
    })
    const passives = Object.entries(p.passives)
      .filter(([, lv]) => lv)
      .map(([id, lv]) => {
        const def = PASSIVES[id as keyof typeof PASSIVES]
        return h(
          'div',
          { class: 'bi', style: { '--c': def.color } },
          svgEl(passiveIcon(id as keyof typeof PASSIVES)),
          h('div', { class: 'bi-main' }, h('b', null, t(dyn(`passive.${id}.name`))), pips(lv ?? 0, def.maxLevel, def.color)),
          h('em', { class: (lv ?? 0) >= def.maxLevel ? 'max' : '' }, (lv ?? 0) >= def.maxLevel ? 'MAX' : `Lv.${lv}`),
        )
      })

    this.body.append(
      h(
        'div',
        { class: 'pause-stats' },
        h('div', null, iconEl('clock'), h('b', null, fmtTime(w.time))),
        h('div', null, iconEl('skull'), h('b', null, fmtInt(w.stats.kills))),
        h('div', null, h('span', { class: 'lvtag' }, t('hud.level', { n: p.level }))),
      ),
      h('h3', null, t('pause.build')),
      h(
        'div',
        { class: 'build' },
        h('div', { class: 'bcol' }, h('h4', null, `${t('hud.weapons')} ${weapons.length}/${MAX_WEAPONS}`), ...weapons),
        passives.length > 0 ? h('div', { class: 'bcol' }, h('h4', null, `${t('hud.passives')} ${passives.length}/${MAX_PASSIVES}`), ...passives) : null,
      ),
      this.confirming
        ? h(
            'div',
            { class: 'confirm-box' },
            h('p', null, t('pause.abandonConfirm')),
            h(
              'div',
              { class: 'row-gap' },
              h('button', { class: 'btn danger', onClick: () => this.cb.abandon() }, t('common.confirm')),
              h(
                'button',
                {
                  class: 'btn ghost',
                  onClick: () => {
                    this.confirming = false
                    this.render()
                  },
                },
                t('common.cancel'),
              ),
            ),
          )
        : h(
            'div',
            { class: 'pause-actions' },
            h('button', { class: 'btn primary lg', onClick: () => this.cb.resume() }, iconEl('play'), t('pause.resume')),
            h('button', { class: 'btn lg', onClick: () => this.cb.settings() }, iconEl('gear'), t('pause.settings')),
            h(
              'button',
              {
                class: 'btn lg danger-ghost',
                onClick: () => {
                  this.confirming = true
                  this.ctx.sfx('click')
                  this.render()
                  this.el.querySelector<HTMLElement>('.btn.danger')?.focus({ preventScroll: true })
                },
              },
              t('pause.abandon'),
            ),
          ),
    )
  }
}
