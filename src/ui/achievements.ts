import { ACHIEVEMENTS } from '../data/achievements'
import { SHIPS } from '../data/ships'
import { SHIP_IDS } from '../data/ids'
import { achCurrent, achProgress } from '../game/progress'
import { dyn, fmtInt, t } from '../i18n'
import type { Screen, UiCtx } from './ctx'
import { clear, h, iconEl } from './dom'
import { screenHead } from './parts'

export function createAchievements(ctx: UiCtx): Screen {
  const el = h('div', { class: 'screen ach' })

  const render = (): void => {
    clear(el)
    const s = ctx.save
    const done = ACHIEVEMENTS.filter((a) => s.ach[a.id]).length
    const sorted = [...ACHIEVEMENTS].sort((a, b) => {
      const da = s.ach[a.id] ? 1 : 0
      const db = s.ach[b.id] ? 1 : 0
      if (da !== db) return da - db
      return achProgress(s, b) - achProgress(s, a)
    })
    const cards = sorted.map((a) => {
      const got = !!s.ach[a.id]
      const p = achProgress(s, a)
      const ship = SHIP_IDS.find((id) => SHIPS[id].unlockAch === a.id)
      return h(
        'div',
        { class: `card ach-card ${got ? 'done' : ''}` },
        h('div', { class: 'ach-ico' }, iconEl(got ? 'check' : 'trophy')),
        h(
          'div',
          { class: 'card-main' },
          h('div', { class: 'card-title' }, h('b', null, t(dyn(`ach.${a.id}.name`))), h('span', { class: 'tag gold' }, t('ach.reward', { n: a.reward }))),
          h('p', { class: 'card-desc' }, t(dyn(`ach.${a.id}.desc`), { n: fmtInt(a.target) })),
          ship ? h('p', { class: 'unlock-hint good' }, t('ach.shipHint', { name: t(dyn(`ship.${ship}.name`)) })) : null,
          h(
            'div',
            { class: 'prog' },
            h('span', { class: 'prog-bar' }, h('i', { style: { width: `${Math.round(p * 100)}%` } })),
            h('span', { class: 'prog-v' }, got ? '✓' : `${fmtInt(achCurrent(s, a))}/${fmtInt(a.target)}`),
          ),
        ),
      )
    })
    el.append(
      screenHead(t('ach.title'), () => ctx.go('menu'), h('div', { class: 'chip' }, iconEl('trophy'), h('b', null, t('ach.summary', { n: done, total: ACHIEVEMENTS.length })))),
      h('div', { class: 'grid ach-grid' }, ...cards),
    )
  }

  return {
    el,
    refresh: render,
    onKey(e) {
      if (e.key === 'Escape') {
        ctx.sfx('back')
        ctx.go('menu')
        return true
      }
      return false
    },
  }
}
