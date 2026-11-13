import type { RunSummary, Settlement } from '../game/progress'
import { dictKeys, dyn, fmtInt, fmtTime, getLang, t, type Key } from '../i18n'
import type { UiCtx } from './ctx'
import { shipPortrait } from '../render/sprites'
import { clear, h, iconEl } from './dom'

export interface ResultsData {
  summary: RunSummary
  settlement: Settlement
  won: boolean
}

const KEYSET = new Set<string>(dictKeys)
const SITE = 'https://aigames.de5.net/'

/** 击坠者来源 → 可读名称 */
function killerName(src: string): string {
  if (!src) return ''
  for (const k of [`enemy.${src}.name`, `boss.${src}.name`, `src.${src}`]) {
    if (KEYSET.has(k)) return t(k as Key)
  }
  return src
}

export class ResultsScreen {
  readonly el: HTMLElement
  private data: ResultsData | null = null
  private raf = 0
  isOpen = false

  constructor(
    private readonly ctx: UiCtx,
    private readonly cb: { again(): void; menu(): void; hangar(): void },
  ) {
    this.el = h('div', { class: 'overlay results', hidden: true })
  }

  show(d: ResultsData): void {
    this.data = d
    this.isOpen = true
    this.el.hidden = false
    this.render()
  }

  hide(): void {
    this.isOpen = false
    this.el.hidden = true
    cancelAnimationFrame(this.raf)
  }

  refresh(): void {
    if (this.isOpen) this.render()
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false
    if (e.key === 'Enter' && document.activeElement === document.body) {
      this.cb.again()
      return true
    }
    if (e.key === 'Escape') {
      this.cb.menu()
      return true
    }
    return false
  }

  private shareText(): string {
    const d = this.data
    if (!d) return ''
    const { summary, won } = d
    return t('res.shareText', {
      sector: t(dyn(`sector.${summary.sector}.name`)),
      result: won ? t('res.shareWon') : t('res.shareLost'),
      time: fmtTime(summary.stats.time),
      kills: fmtInt(summary.stats.kills),
      level: summary.stats.level,
      url: getLang() === 'zh' ? SITE : `${SITE}en/`,
    })
  }

  private async share(): Promise<void> {
    const text = this.shareText()
    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
    } catch {
      /* 用户取消分享，不当作错误 */
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      this.ctx.toast(t('res.copied'), 'good')
    } catch {
      window.prompt(t('res.share'), text)
    }
  }

  private render(): void {
    const d = this.data
    if (!d) return
    cancelAnimationFrame(this.raf)
    clear(this.el)
    const { summary, settlement: s, won } = d
    const st = summary.stats
    const c = s.cores
    const title = summary.endless && st.bossKilled ? t('res.endless') : won ? t('res.win') : t('res.lose')
    const killer = !won && st.killedBy ? killerName(st.killedBy) : ''

    const total = c.total + s.achCores
    const totalEl = h('b', { class: 'cores-total' }, '0')

    const parts: [string, number][] = [
      [t('res.part.kills'), c.kills],
      [t('res.part.time'), c.time],
      [t('res.part.level'), c.level],
      [t('res.part.evolves'), c.evolves],
      [t('res.part.boss'), c.boss],
      [t('res.part.bonus'), c.bonus],
      [t('res.part.ach'), s.achCores],
    ]
    const rows = parts
      .filter(([, v]) => v > 0)
      .map(([label, v], i) => h('div', { class: 'cr', style: { animationDelay: `${300 + i * 90}ms` } }, h('span', null, label), h('b', null, `+${fmtInt(v)}`)))

    const tiles = [
      { ico: iconEl('clock'), label: t('res.time'), val: fmtTime(st.time), rec: s.records.time || s.records.endless },
      { ico: iconEl('skull'), label: t('res.kills'), val: fmtInt(st.kills), rec: s.records.kills },
      { ico: iconEl('trophy'), label: t('res.level'), val: String(st.level), rec: false },
      { ico: iconEl('swords'), label: t('res.evolves'), val: String(st.evolves), rec: false },
    ].map((x, i) =>
      h(
        'div',
        { class: 'tile', style: { animationDelay: `${i * 80}ms` } },
        x.ico,
        h('span', { class: 'tile-l' }, x.label),
        h('b', null, x.val),
        x.rec ? h('em', { class: 'rec' }, t('res.newRecord')) : null,
      ),
    )

    const notices: HTMLElement[] = []
    if (s.unlockedSector) notices.push(h('div', { class: 'notice good' }, iconEl('check'), t('res.unlockSector', { name: t(dyn(`sector.${s.unlockedSector}.name`)) })))
    if (s.unlockedThreat !== null) notices.push(h('div', { class: 'notice good' }, iconEl('check'), t('res.unlockThreat', { name: t(dyn(`threat.${s.unlockedThreat}.name`)) })))
    for (const id of s.unlockedShips) {
      notices.push(h('div', { class: 'notice gold' }, shipPortrait(id, 30), t('res.unlockShip', { name: t(dyn(`ship.${id}.name`)) })))
    }

    const achs =
      s.newAch.length > 0
        ? h(
            'div',
            { class: 'res-ach' },
            h('h4', null, t('res.achievements')),
            h(
              'div',
              { class: 'ach-list' },
              ...s.newAch.map((a) =>
                h('div', { class: 'ach-line' }, iconEl('trophy'), h('b', null, t(dyn(`ach.${a.id}.name`))), h('span', null, t('ach.reward', { n: a.reward }))),
              ),
            ),
          )
        : null

    this.el.append(
      h(
        'div',
        { class: `res-panel ${won ? 'won' : 'lost'}` },
        h('div', { class: 'res-head' }, h('h1', null, title), h('p', null, `${t(dyn(`sector.${summary.sector}.name`))} · ${t(dyn(`threat.${summary.threat}.name`))}`, ' · ', shipPortrait(summary.ship, 26), t(dyn(`ship.${summary.ship}.name`)))),
        killer ? h('p', { class: 'killer' }, iconEl('skull'), t('res.killedBy'), ' ', h('b', null, killer)) : null,
        h(
          'div',
          { class: 'res-grid' },
          h('div', { class: 'tiles' }, ...tiles),
          h(
            'div',
            { class: 'cores-box' },
            h('div', { class: 'cores-head' }, iconEl('core'), h('span', null, t('res.cores')), h('i', { class: 'mult' }, t('res.mult', { n: c.mult.toFixed(2) }))),
            h('div', { class: 'cores-rows' }, ...rows),
            h('div', { class: 'cores-sum' }, totalEl),
          ),
        ),
        notices.length > 0 ? h('div', { class: 'notices' }, ...notices) : null,
        achs,
        h(
          'div',
          { class: 'res-actions' },
          h('button', { class: 'btn primary xl', onClick: () => this.cb.again() }, iconEl('refresh'), t('res.again')),
          h('button', { class: 'btn lg', onClick: () => this.cb.hangar() }, iconEl('hangar'), t('res.hangar')),
          h('button', { class: 'btn lg', onClick: () => this.cb.menu() }, t('res.menu')),
          h('button', { class: 'btn lg ghost', onClick: () => void this.share() }, iconEl('share'), t('res.share')),
        ),
      ),
    )

    // 晶核数字滚动
    const t0 = performance.now()
    const dur = 1100
    const tick = (): void => {
      const k = Math.min(1, (performance.now() - t0 - 250) / dur)
      const e = k <= 0 ? 0 : 1 - Math.pow(1 - k, 3)
      totalEl.textContent = fmtInt(total * e)
      if (k < 1) this.raf = requestAnimationFrame(tick)
      else totalEl.textContent = fmtInt(total)
    }
    this.raf = requestAnimationFrame(tick)
    queueMicrotask(() => this.el.querySelector<HTMLElement>('.btn.primary')?.focus({ preventScroll: true }))
  }
}
