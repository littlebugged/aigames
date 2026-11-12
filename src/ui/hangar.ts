import { META_IDS, type MetaId } from '../data/ids'
import { METAS, formatMetaValue } from '../data/meta'
import { buyMeta, metaRank, nextMetaCost, refundMeta } from '../game/progress'
import { dyn, fmtInt, t } from '../i18n'
import type { Screen, UiCtx } from './ctx'
import { clear, h, iconEl, svgEl } from './dom'
import { passiveIcon, uiIcon } from './icons'
import { coresChip, pips, screenHead } from './parts'

const META_ICON: Record<MetaId, () => string> = {
  m_power: () => passiveIcon('power'),
  m_hull: () => passiveIcon('hull'),
  m_speed: () => passiveIcon('thruster'),
  m_magnet: () => passiveIcon('magnet'),
  m_xp: () => passiveIcon('learning'),
  m_regen: () => passiveIcon('regen'),
  m_armor: () => passiveIcon('armor'),
  m_luck: () => passiveIcon('luck'),
  m_dash: () => uiIcon('dash'),
  m_reroll: () => uiIcon('dice'),
  m_banish: () => uiIcon('ban'),
  m_revive: () => uiIcon('heal'),
  m_greed: () => uiIcon('core'),
}

export function createHangar(ctx: UiCtx): Screen {
  const el = h('div', { class: 'screen hangar' })
  const cores = coresChip(() => ctx.save.cores)
  let confirmRefund = false

  const render = (): void => {
    clear(el)
    const s = ctx.save
    const cards = META_IDS.map((id) => {
      const d = METAS[id]
      const rank = metaRank(s, id)
      const cost = nextMetaCost(s, id)
      const maxed = cost === null
      const afford = cost !== null && s.cores >= cost
      return h(
        'div',
        { class: `card meta ${maxed ? 'maxed' : ''} ${afford ? 'afford' : ''}`, style: { '--c': d.color } },
        h('div', { class: 'meta-ico', style: { color: d.color } }, svgEl(META_ICON[id]())),
        h(
          'div',
          { class: 'card-main' },
          h('div', { class: 'card-title' }, h('b', null, t(dyn(`meta.${id}.name`))), h('span', { class: 'tag' }, t('hangar.rank', { r: rank, max: d.max }))),
          h('p', { class: 'card-desc' }, t(dyn(`meta.${id}.desc`))),
          h(
            'div',
            { class: 'meta-vals' },
            pips(rank, d.max, d.color),
            h(
              'span',
              null,
              maxed
                ? t('hangar.maxed')
                : `${t('hangar.now', { v: rank === 0 ? '—' : formatMetaValue(d, rank) })} → ${formatMetaValue(d, rank + 1)}`,
            ),
          ),
        ),
        h(
          'button',
          {
            class: `btn sm buy ${afford ? 'gold' : ''}`,
            disabled: maxed ? true : null,
            onClick: () => {
              if (buyMeta(s, id)) {
                ctx.sfx('buy')
                ctx.persist()
                ctx.toast(t('hangar.bought', { name: t(dyn(`meta.${id}.name`)) }), 'good', 1600)
                render()
              } else {
                ctx.sfx('deny')
                ctx.toast(t('hangar.notEnough'), 'bad', 1400)
              }
            },
          },
          ...(maxed ? [t('common.max')] : [iconEl('core'), fmtInt(cost ?? 0)]),
        ),
      )
    })

    const hasAny = Object.keys(s.meta).length > 0
    const refund = h(
      'button',
      {
        class: `btn sm ${confirmRefund ? 'danger' : 'ghost'}`,
        disabled: hasAny ? null : true,
        title: t('hangar.refundDesc'),
        onClick: () => {
          if (!confirmRefund) {
            confirmRefund = true
            ctx.sfx('click')
            ctx.toast(t('hangar.refundConfirm'), 'info', 3200)
            render()
            return
          }
          confirmRefund = false
          const n = refundMeta(s)
          ctx.persist()
          ctx.sfx('buy')
          ctx.toast(t('hangar.refunded', { n: fmtInt(n) }), 'good')
          render()
        },
      },
      iconEl('refresh'),
      confirmRefund ? t('common.confirm') : t('hangar.refund'),
    )

    el.append(
      screenHead(t('hangar.title'), () => ctx.go('menu'), h('div', { class: 'row-gap' }, refund, cores.el)),
      h('p', { class: 'scr-sub' }, t('hangar.desc')),
      h('div', { class: 'grid meta-grid' }, ...cards),
    )
    cores.update()
  }

  return {
    el,
    refresh() {
      confirmRefund = false
      render()
    },
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
