import { ACHIEVEMENTS } from '../data/achievements'
import { META_IDS, type ShipId } from '../data/ids'
import { nextMetaCost } from '../game/progress'
import { SHIPS } from '../data/ships'
import { fmtInt, t } from '../i18n'
import { shipPortrait } from '../render/sprites'
import type { Screen, UiCtx } from './ctx'
import { clear, h, iconEl } from './dom'
import { coresChip } from './parts'

export function createMenu(ctx: UiCtx): Screen {
  const el = h('div', { class: 'screen menu' })
  const cores = coresChip(() => ctx.save.cores)

  const render = (): void => {
    clear(el)
    const s = ctx.save
    const unlocked = Object.keys(s.ach).length
    const canBuy = META_IDS.some((id) => {
      const c = nextMetaCost(s, id)
      return c !== null && s.cores >= c
    })

    const logo = h(
      'header',
      { class: 'logo' },
      h(
        'div',
        { class: 'logo-en', role: 'img', 'aria-label': t('app.titleEn') },
        h('span', { class: 'l1' }, 'NEON'),
        h('span', { class: 'l2' }, 'SURGE'),
      ),
      h('div', { class: 'logo-rule', 'aria-hidden': 'true' }, h('i'), h('b'), h('i')),
      // 英文界面里中文名和 logo 是同一个词，不重复显示
      t('app.title') === t('app.titleEn') ? null : h('div', { class: 'logo-zh' }, t('app.title')),
      h('p', { class: 'tagline' }, t('app.tagline')),
    )

    // 英雄位：当前选中的飞船悬在发射台上（立绘按显示尺寸重画，大尺寸下也锐利）
    const shipId: ShipId = s.ships.includes(s.last.ship) && SHIPS[s.last.ship] ? s.last.ship : 'vanguard'
    const hero = h(
      'div',
      { class: 'hero', 'aria-hidden': 'true' },
      h(
        'div',
        { class: 'hero-stage' },
        h('div', { class: 'hero-pad' }, h('i'), h('i'), h('i')),
        h('div', { class: 'hero-shadow' }),
        h('div', { class: 'hero-ship' }, shipPortrait(shipId, 280, true)),
      ),
    )

    const play = h(
      'button',
      {
        class: 'btn primary xl play',
        onClick: () => {
          ctx.sfx('confirm')
          ctx.go('deploy')
        },
      },
      iconEl('play'),
      h('span', null, t('menu.play')),
    )

    const nav = h(
      'div',
      { class: 'menu-row' },
      h(
        'button',
        {
          class: 'btn lg',
          onClick: () => {
            ctx.sfx('click')
            ctx.go('hangar')
          },
        },
        iconEl('hangar'),
        h('span', null, t('menu.hangar')),
        canBuy ? h('i', { class: 'dot', title: '!' }) : null,
      ),
      h(
        'button',
        {
          class: 'btn lg',
          onClick: () => {
            ctx.sfx('click')
            ctx.go('ach')
          },
        },
        iconEl('trophy'),
        h('span', null, t('menu.achievements')),
        h('em', null, `${unlocked}/${ACHIEVEMENTS.length}`),
      ),
      h(
        'button',
        {
          class: 'btn lg',
          onClick: () => {
            ctx.sfx('click')
            ctx.openSettings()
          },
        },
        iconEl('gear'),
        h('span', null, t('menu.settings')),
      ),
    )

    const top = h(
      'div',
      { class: 'menu-top' },
      cores.el,
      h(
        'div',
        { class: 'menu-top-r' },
        ctx.canInstall()
          ? h(
              'button',
              {
                class: 'btn icon install',
                title: t('page.install'),
                'aria-label': t('page.install'),
                onClick: () => {
                  ctx.sfx('click')
                  ctx.install()
                },
              },
              iconEl('download'),
            )
          : null,
        h(
          'button',
          {
            class: 'btn icon',
            title: t('menu.fullscreen'),
            'aria-label': t('menu.fullscreen'),
            onClick: () => ctx.toggleFullscreen(),
          },
          iconEl('fullscreen'),
        ),
        h(
          'button',
          {
            class: 'btn icon lang',
            'aria-label': 'Language',
            onClick: () => {
              ctx.sfx('click')
              ctx.setLang(ctx.save.settings.lang === 'zh' ? 'en' : 'zh')
            },
          },
          t('menu.langToggle'),
        ),
      ),
    )

    const foot = h(
      'footer',
      { class: 'menu-foot' },
      s.totals.runs > 0
        ? h('p', { class: 'menu-stats' }, t('menu.stats', { runs: fmtInt(s.totals.runs), kills: fmtInt(s.totals.kills), wins: fmtInt(s.totals.wins) }))
        : null,
      h(
        'p',
        { class: 'menu-hint' },
        h('span', { class: 'kbd-only' }, t('menu.hint')),
        h('a', { href: guideHref(), class: 'link', onClick: () => ctx.sfx('click') }, iconEl('book'), t('menu.guide')),
      ),
    )

    el.append(top, h('div', { class: 'menu-center' }, logo, hero), h('div', { class: 'menu-main' }, play, nav), foot)
    cores.update()
  }

  return {
    el,
    refresh: render,
    onKey(e) {
      if (e.key === 'Enter' && document.activeElement === document.body) {
        ctx.sfx('confirm')
        ctx.go('deploy')
        return true
      }
      return false
    },
  }
}

/** 指南页路径：英文界面指向 /en/guide/ */
function guideHref(): string {
  return document.documentElement.lang.startsWith('zh') ? '/guide/' : '/en/guide/'
}
