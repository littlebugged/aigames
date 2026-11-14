import { ACHIEVEMENTS, type AchDef } from '../data/achievements'
import { SHIPS } from '../data/ships'
import { SHIP_IDS } from '../data/ids'
import { achCurrent, achProgress } from '../game/progress'
import { dyn, fmtInt, t } from '../i18n'
import type { Screen, UiCtx } from './ctx'
import { clear, h, iconEl } from './dom'
import { MEDAL_TIERS, medalEl, medalTier } from './medals'
import { screenHead } from './parts'

export function createAchievements(ctx: UiCtx): Screen {
  const el = h('div', { class: 'screen ach' })

  const render = (): void => {
    clear(el)
    const s = ctx.save
    const gotOf = (a: AchDef): boolean => !!s.ach[a.id]
    const done = ACHIEVEMENTS.filter(gotOf).length
    const earned = ACHIEVEMENTS.filter(gotOf).reduce((n, a) => n + a.reward, 0)
    const total = ACHIEVEMENTS.reduce((n, a) => n + a.reward, 0)

    // 进行中的按完成度从高到低排（最接近的排前面），已解锁的保持定义顺序
    const todo = ACHIEVEMENTS.filter((a) => !gotOf(a)).sort((a, b) => achProgress(s, b) - achProgress(s, a))
    const finished = ACHIEVEMENTS.filter(gotOf)

    const card = (a: AchDef): HTMLElement => {
      const got = gotOf(a)
      const p = achProgress(s, a)
      const tier = medalTier(a.reward)
      const ship = SHIP_IDS.find((id) => SHIPS[id].unlockAch === a.id)
      return h(
        'div',
        { class: `card ach-card tier-${tier} ${got ? 'done' : 'todo'}` },
        medalEl(a, got, 'md'),
        h(
          'div',
          { class: 'card-main' },
          h('div', { class: 'card-title' }, h('b', null, t(dyn(`ach.${a.id}.name`))), h('span', { class: 'tag reward' }, t('ach.reward', { n: a.reward }))),
          h('p', { class: 'card-desc' }, t(dyn(`ach.${a.id}.desc`), { n: fmtInt(a.target) })),
          ship ? h('p', { class: 'unlock-hint good' }, t('ach.shipHint', { name: t(dyn(`ship.${ship}.name`)) })) : null,
          got
            ? h('div', { class: 'ach-done' }, iconEl('check'), t('ach.completed'))
            : h(
                'div',
                { class: 'prog' },
                h('span', { class: 'prog-bar' }, h('i', { style: { width: `${Math.max(p > 0 ? 4 : 0, Math.round(p * 100))}%` } })),
                h('span', { class: 'prog-v' }, `${fmtInt(achCurrent(s, a))}/${fmtInt(a.target)}`),
              ),
        ),
      )
    }

    // 收藏面板：小勋章按档位分组排开，每组下面写这一档的进度；右上角是已入账晶核
    const groups = MEDAL_TIERS.map((tier) => {
      const list = ACHIEVEMENTS.filter((a) => medalTier(a.reward) === tier)
      const medals = list.map((a) => {
        const m = medalEl(a, gotOf(a), 'sm')
        m.title = t(dyn(`ach.${a.id}.name`))
        return m
      })
      const got = list.filter(gotOf).length
      return h(
        'div',
        { class: `tier-group tier-${tier}` },
        h('div', { class: 'medal-row' }, ...medals),
        h('div', { class: 'tier-key' }, h('i'), t(`ach.tier.${tier}`), h('b', null, `${got}/${list.length}`)),
      )
    })
    const summary = h(
      'section',
      { class: 'card ach-sum' },
      h(
        'div',
        { class: 'ach-sum-top' },
        h('div', { class: 'ach-sum-count' }, h('b', null, fmtInt(done)), h('span', null, `/ ${fmtInt(ACHIEVEMENTS.length)}`)),
        h('div', { class: 'ach-sum-lab' }, t('ach.collection')),
        h('div', { class: 'ach-sum-cores' }, iconEl('core'), t('ach.earned', { n: fmtInt(earned), total: fmtInt(total) })),
      ),
      h('div', { class: 'medal-strip' }, ...groups),
    )

    const section = (key: 'ach.section.todo' | 'ach.section.done', n: number): HTMLElement =>
      h('h3', { class: 'ach-sec' }, t(key), h('b', null, fmtInt(n)))

    el.append(
      screenHead(t('ach.title'), () => ctx.go('menu')),
      h(
        'div',
        { class: 'ach-body' },
        summary,
        h(
          'div',
          { class: 'grid ach-grid' },
          todo.length > 0 ? section('ach.section.todo', todo.length) : null,
          ...todo.map(card),
          finished.length > 0 ? section('ach.section.done', finished.length) : null,
          ...finished.map(card),
        ),
      ),
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
