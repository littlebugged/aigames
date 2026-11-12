import { SECTOR_IDS, SHIP_IDS, type ShipId } from '../data/ids'
import { SECTORS, THREAT_LEVELS } from '../data/sectors'
import { SHIPS } from '../data/ships'
import { ACHIEVEMENTS } from '../data/achievements'
import { buyShip, isSectorUnlocked, isShipOwned, maxSelectableThreat } from '../game/progress'
import { dyn, fmtInt, fmtTime, t } from '../i18n'
import type { Screen, Selection, UiCtx } from './ctx'
import { clear, h, iconEl, svgEl } from './dom'
import { shipIcon, weaponIcon } from './icons'
import { coresChip, screenHead, statBar } from './parts'

const maxOf = (f: (id: ShipId) => number): number => Math.max(...SHIP_IDS.map(f))

export function createDeploy(ctx: UiCtx): Screen {
  const el = h('div', { class: 'screen deploy' })
  const cores = coresChip(() => ctx.save.cores)
  let sel: Selection = { ship: 'vanguard', sector: 'fields', threat: 0, endless: false }

  /** 把选择夹回当前存档允许的范围 */
  const normalize = (): void => {
    const s = ctx.save
    if (!isShipOwned(s, sel.ship)) sel.ship = 'vanguard'
    if (!isSectorUnlocked(s, sel.sector)) sel.sector = 'fields'
    sel.threat = Math.min(sel.threat, maxSelectableThreat(s, sel.sector))
    if (s.clears[sel.sector] === 0) sel.endless = false
  }

  const render = (): void => {
    normalize()
    clear(el)
    const s = ctx.save

    // ── 飞船 ──
    const maxHp = maxOf((i) => SHIPS[i].hp)
    const maxSpd = maxOf((i) => SHIPS[i].speed)
    const maxDmg = maxOf((i) => SHIPS[i].dmg)
    const minDash = Math.min(...SHIP_IDS.map((i) => SHIPS[i].dashCd))
    const shipCards = SHIP_IDS.map((id) => {
      const d = SHIPS[id]
      const owned = isShipOwned(s, id)
      const active = sel.ship === id
      const ach = d.unlockAch ? ACHIEVEMENTS.find((a) => a.id === d.unlockAch) : null
      const card = h(
        'div',
        {
          class: `card ship ${active ? 'active' : ''} ${owned ? '' : 'locked'}`,
          style: { '--c': d.color },
        },
        h(
          'button',
          {
            class: 'card-hit',
            'aria-pressed': active ? 'true' : 'false',
            'aria-label': t(dyn(`ship.${id}.name`)),
            onClick: () => {
              if (!owned) return ctx.sfx('deny')
              sel.ship = id
              ctx.sfx('click')
              render()
            },
          },
          h('div', { class: 'ship-ico', style: { color: d.color } }, svgEl(shipIcon(id))),
          h(
            'div',
            { class: 'card-main' },
            h('div', { class: 'card-title' }, h('b', null, t(dyn(`ship.${id}.name`))), h('span', { class: 'tag' }, t(dyn(`ship.${id}.tag`)))),
            h('p', { class: 'card-desc' }, t(dyn(`ship.${id}.desc`))),
            h(
              'div',
              { class: 'stats' },
              statBar(t('deploy.stat.hp'), d.hp / maxHp, d.color, String(d.hp)),
              statBar(t('deploy.stat.speed'), d.speed / maxSpd, d.color, String(d.speed)),
              statBar(t('deploy.stat.power'), d.dmg / maxDmg, d.color, `×${d.dmg}`),
              statBar(t('deploy.stat.dash'), minDash / d.dashCd, d.color, `${d.dashCd}s`),
            ),
            h(
              'div',
              { class: 'startw' },
              h('span', null, t('deploy.startWeapon')),
              h('span', { class: 'sw', style: { color: '#fff' } }, svgEl(weaponIcon(d.startWeapon)), t(dyn(`weapon.${d.startWeapon}.name`))),
            ),
          ),
          owned ? null : h('div', { class: 'lock-ico' }, iconEl('lock')),
        ),
        owned
          ? null
          : h(
              'div',
              { class: 'buy-row' },
              ach ? h('p', { class: 'unlock-hint' }, t('deploy.unlockBy', { name: t(dyn(`ach.${ach.id}.name`)) })) : null,
              h(
                'button',
                {
                  class: `btn sm ${s.cores >= d.cost ? 'gold' : ''}`,
                  onClick: () => {
                    if (buyShip(s, id)) {
                      ctx.sfx('buy')
                      ctx.persist()
                      sel.ship = id
                      render()
                    } else {
                      ctx.sfx('deny')
                      ctx.toast(t('deploy.notEnough'), 'bad')
                    }
                  },
                },
                iconEl('core'),
                t('deploy.buyShip', { cost: fmtInt(d.cost) }),
              ),
            ),
      )
      return card
    })

    // ── 星区 ──
    const sectorCards = SECTOR_IDS.map((id) => {
      const d = SECTORS[id]
      const open = isSectorUnlocked(s, id)
      const active = sel.sector === id
      const req = d.requires
      const clears = s.clears[id]
      return h(
        'button',
        {
          class: `card sector ${active ? 'active' : ''} ${open ? '' : 'locked'}`,
          style: {
            '--c': d.palette.accent,
            background: `linear-gradient(135deg, ${d.palette.bg0}ee, ${d.palette.bg1}ee)`,
          },
          'aria-pressed': active ? 'true' : 'false',
          onClick: () => {
            if (!open) return ctx.sfx('deny')
            sel.sector = id
            ctx.sfx('click')
            render()
          },
        },
        h(
          'div',
          { class: 'card-main' },
          h('div', { class: 'card-title' }, h('b', null, t(dyn(`sector.${id}.name`))), h('span', { class: 'tag' }, `×${d.reward}`)),
          h('p', { class: 'card-desc' }, t(dyn(`sector.${id}.desc`))),
          h(
            'div',
            { class: 'meta-line' },
            h('span', null, t('deploy.boss', { name: t(dyn(`boss.${d.boss}.name`)) })),
            clears > 0 ? h('span', { class: 'good' }, t('deploy.cleared', { n: clears })) : null,
            s.bestTime[id] > 0 ? h('span', null, t('deploy.best', { t: fmtTime(s.bestTime[id]) })) : null,
            s.bestEndless[id] > 0 ? h('span', null, t('deploy.bestEndless', { t: fmtTime(s.bestEndless[id]) })) : null,
          ),
          open ? null : h('p', { class: 'unlock-hint' }, iconEl('lock'), t('deploy.lockedSector', { name: t(dyn(`sector.${req}.name`)) })),
        ),
      )
    })

    // ── 威胁等级 ──
    const maxT = maxSelectableThreat(s, sel.sector)
    const th = THREAT_LEVELS[sel.threat]
    const threatBtns = THREAT_LEVELS.map((_, i) => {
      const open = i <= maxT
      return h(
        'button',
        {
          class: `seg ${sel.threat === i ? 'active' : ''} ${open ? '' : 'locked'} t${i}`,
          'aria-pressed': sel.threat === i ? 'true' : 'false',
          onClick: () => {
            if (!open) {
              ctx.sfx('deny')
              ctx.toast(t('deploy.lockedThreat', { name: t(dyn(`threat.${i - 1}.name`)) }), 'info')
              return
            }
            sel.threat = i
            ctx.sfx('click')
            render()
          },
        },
        open ? null : iconEl('lock'),
        t(dyn(`threat.${i}.name`)),
      )
    })

    const canEndless = s.clears[sel.sector] > 0
    const endless = h(
      'button',
      {
        class: `toggle-row ${sel.endless ? 'on' : ''} ${canEndless ? '' : 'locked'}`,
        role: 'switch',
        'aria-checked': sel.endless ? 'true' : 'false',
        onClick: () => {
          if (!canEndless) return ctx.sfx('deny')
          sel.endless = !sel.endless
          ctx.sfx('click')
          render()
        },
      },
      iconEl('infinity'),
      h('span', { class: 'tr-main' }, h('b', null, t('deploy.endless')), h('small', null, t('deploy.endlessDesc'))),
      canEndless ? h('span', { class: 'sw-knob' }) : iconEl('lock'),
    )

    const reward = (SECTORS[sel.sector].reward * th.reward).toFixed(1).replace(/\.0$/, '')

    const body = h(
      'div',
      { class: 'deploy-body' },
      h('section', { class: 'col' }, h('h3', null, t('deploy.ship')), ...shipCards),
      h('section', { class: 'col' }, h('h3', null, t('deploy.sector')), ...sectorCards),
      h(
        'section',
        { class: 'col' },
        h('h3', null, t('deploy.threat')),
        h('div', { class: 'segs' }, ...threatBtns),
        h('p', { class: 'threat-desc' }, t('threat.desc', { hp: th.hp, spawn: th.spawn, reward: th.reward })),
        endless,
        h('p', { class: 'loadout' }, Object.keys(s.meta).length > 0 ? t('deploy.loadout') : ''),
      ),
    )

    const foot = h(
      'div',
      { class: 'deploy-foot' },
      h('div', { class: 'summary' }, h('b', null, t('deploy.reward', { n: reward }))),
      h(
        'button',
        {
          class: 'btn primary xl start',
          onClick: () => {
            normalize()
            ctx.sfx('confirm')
            ctx.start({ ...sel })
          },
        },
        iconEl('play'),
        h('span', null, t('deploy.start')),
      ),
    )

    el.append(screenHead(t('deploy.title'), () => ctx.go('menu'), cores.el), body, foot)
    cores.update()
  }

  return {
    el,
    refresh() {
      // 进入时优先使用上一次出击的选择
      const last = ctx.save.last
      sel = { ship: last.ship, sector: last.sector, threat: last.threat, endless: last.endless }
      render()
    },
    onKey(e) {
      if (e.key === 'Escape') {
        ctx.sfx('back')
        ctx.go('menu')
        return true
      }
      if (e.key === 'Enter' && document.activeElement === document.body) {
        ctx.sfx('confirm')
        ctx.start({ ...sel })
        return true
      }
      return false
    },
  }
}

