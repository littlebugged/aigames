import { PASSIVES } from '../data/passives'
import { WEAPONS } from '../data/weapons'
import { WEAPON_MAX_LEVEL } from '../data/ids'
import type { World } from '../game/world'
import { dyn, fmtInt, fmtTime, t } from '../i18n'
import type { UiCtx } from './ctx'
import { clear, h, iconEl, svgEl } from './dom'
import { passiveIcon, weaponIcon } from './icons'

/** 战斗 HUD。每帧只在数值变化时写 DOM。 */
export class Hud {
  readonly el: HTMLElement

  private readonly xpFill = h('i')
  private readonly xpLv = h('span', { class: 'xp-lv' })
  private readonly hpFill = h('i', { class: 'hp-fill' })
  private readonly hpTrail = h('i', { class: 'hp-trail' })
  private readonly hpText = h('span', { class: 'hp-text' })
  private readonly hpWrap: HTMLElement
  private readonly timer = h('div', { class: 'timer' }, '0:00')
  private readonly eta = h('div', { class: 'boss-eta' })
  private readonly kills = h('b', null, '0')
  private readonly bossBar: HTMLElement
  private readonly bossName = h('span', { class: 'boss-name' })
  private readonly bossFill = h('i')
  private readonly weapons = h('div', { class: 'slots weapons' })
  private readonly passives = h('div', { class: 'slots passives' })
  private readonly dash: HTMLElement
  private readonly dashBtn: HTMLElement
  private readonly banner = h('div', { class: 'banner' })
  private readonly toasts = h('div', { class: 'toasts' })
  private readonly hint = h('div', { class: 'hint' })

  private last = { xp: -1, lv: -1, hp: -1, hpMax: -1, time: -1, kills: -1, boss: -1, dash: -1 }
  private wSig = ''
  private pSig = ''
  private bannerT = 0
  private hintT = 0
  private bossShown = false

  constructor(
    private readonly ctx: UiCtx,
    onPause: () => void,
  ) {
    this.hpWrap = h('div', { class: 'hp' }, iconEl('heal', 'hp-ico'), h('div', { class: 'hp-bar' }, this.hpTrail, this.hpFill), this.hpText)
    this.bossBar = h('div', { class: 'boss-bar', hidden: true }, this.bossName, h('div', { class: 'boss-track' }, this.bossFill))
    this.dash = h('div', { class: 'dash-ring ready' }, iconEl('dash'))
    this.dashBtn = h('button', { class: 'dash-btn ready', tabindex: -1, 'aria-label': t('hud.dash') }, iconEl('dash'), h('span', null, t('hud.dash')))
    this.dashBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      ctx.input.pressDash()
    })
    const pauseBtn = h(
      'button',
      {
        class: 'btn icon hud-pause',
        tabindex: -1,
        'aria-label': t('hud.pause'),
        onClick: (e: Event) => {
          ;(e.currentTarget as HTMLElement).blur()
          onPause()
        },
      },
      iconEl('pause'),
    )

    this.el = h(
      'div',
      { class: 'hud', hidden: true },
      h('div', { class: 'hud-xp' }, this.xpFill, this.xpLv),
      h('div', { class: 'hud-tl' }, this.hpWrap),
      h('div', { class: 'hud-tc' }, this.timer, this.eta, this.bossBar),
      h('div', { class: 'hud-tr' }, h('div', { class: 'kills' }, iconEl('skull'), this.kills), pauseBtn),
      h('div', { class: 'hud-bl' }, this.weapons, this.passives),
      h('div', { class: 'hud-bc' }, this.dash),
      h('div', { class: 'hud-br' }, this.dashBtn),
      this.banner,
      this.toasts,
      this.hint,
    )
  }

  show(): void {
    this.el.hidden = false
  }

  hide(): void {
    this.el.hidden = true
  }

  /** 新的一局：清空所有状态 */
  reset(w: World): void {
    this.last = { xp: -1, lv: -1, hp: -1, hpMax: -1, time: -1, kills: -1, boss: -1, dash: -1 }
    this.wSig = ''
    this.pSig = ''
    this.bannerT = 0
    this.hintT = 0
    this.bossShown = false
    this.bossBar.hidden = true
    this.banner.className = 'banner'
    this.banner.textContent = ''
    this.hint.className = 'hint'
    clear(this.toasts)
    this.hpTrail.style.width = '100%'
    this.eta.textContent = ''
    this.update(w, 0)
  }

  setTouch(touch: boolean): void {
    this.el.classList.toggle('touch', touch)
  }

  update(w: World, dt: number): void {
    const p = w.player
    const L = this.last

    const xp = Math.round((p.xp / p.xpNext) * 500) / 500
    if (xp !== L.xp) {
      L.xp = xp
      this.xpFill.style.width = `${(xp * 100).toFixed(1)}%`
    }
    if (p.level !== L.lv) {
      L.lv = p.level
      this.xpLv.textContent = t('hud.level', { n: p.level })
    }

    const hp = Math.max(0, Math.ceil(p.hp))
    if (hp !== L.hp || Math.round(p.maxHp) !== L.hpMax) {
      L.hp = hp
      L.hpMax = Math.round(p.maxHp)
      const r = Math.max(0, Math.min(1, p.hp / p.maxHp))
      this.hpFill.style.width = `${(r * 100).toFixed(1)}%`
      this.hpTrail.style.width = `${(r * 100).toFixed(1)}%`
      this.hpText.textContent = `${hp} / ${L.hpMax}`
      this.hpWrap.classList.toggle('low', r < 0.3)
    }

    const tm = Math.floor(w.time)
    if (tm !== L.time) {
      L.time = tm
      this.timer.textContent = fmtTime(tm)
      const left = w.sector.length - tm
      this.eta.textContent = !w.boss && left > 0 && !w.stats.bossKilled ? t('hud.bossEta', { t: fmtTime(left) }) : ''
      this.eta.classList.toggle('soon', left <= 30 && left > 0)
    }
    if (w.stats.kills !== L.kills) {
      L.kills = w.stats.kills
      this.kills.textContent = fmtInt(L.kills)
    }

    // Boss 血条
    const b = w.boss && w.boss.alive ? w.boss : null
    if (b) {
      if (!this.bossShown) {
        this.bossShown = true
        this.bossBar.hidden = false
        this.bossName.textContent = t(dyn(`boss.${b.id}.name`))
        this.eta.textContent = ''
      }
      const r = Math.round(Math.max(0, b.hp / b.maxHp) * 1000) / 1000
      if (r !== L.boss) {
        L.boss = r
        this.bossFill.style.width = `${(r * 100).toFixed(1)}%`
      }
      this.bossBar.classList.toggle('intro', b.intro > 0)
    } else if (this.bossShown) {
      this.bossShown = false
      this.bossBar.hidden = true
      L.boss = -1
    }

    // 冲刺冷却
    const dp = p.dashCd > 0 ? 1 - Math.max(0, p.dashCd) / p.st.dashCd : 1
    const dq = Math.round(dp * 50) / 50
    if (dq !== L.dash) {
      L.dash = dq
      const ready = dq >= 1
      for (const e of [this.dash, this.dashBtn]) {
        e.style.setProperty('--p', String(dq))
        e.classList.toggle('ready', ready)
      }
    }

    this.updateSlots(w)

    if (dt > 0) {
      if (this.bannerT > 0) {
        this.bannerT -= dt
        if (this.bannerT <= 0) this.banner.className = 'banner'
      }
      if (this.hintT > 0) {
        this.hintT -= dt
        if (this.hintT <= 0) this.hint.className = 'hint'
      }
    }
  }

  private updateSlots(w: World): void {
    const p = w.player
    const wSig = p.weapons.map((x) => `${x.id}${x.level}${x.evolved ? '*' : ''}`).join(',') + '|' + Object.keys(p.passives).map((k) => `${k}${p.passives[k as keyof typeof p.passives]}`).join(',')
    if (wSig === this.wSig) return
    this.wSig = wSig
    clear(this.weapons)
    for (const wi of p.weapons) {
      const def = WEAPONS[wi.id]
      const partner = def.evolvesWith
      const hasPartner = (p.passives[partner] ?? 0) > 0
      const maxed = wi.level >= WEAPON_MAX_LEVEL && !wi.evolved
      const slot = h(
        'div',
        {
          class: `slot ${wi.evolved ? 'evolved' : ''} ${maxed && hasPartner ? 'evo-ready' : ''}`,
          style: { '--c': wi.evolved ? '#ffd84a' : def.color },
          title: `${t(dyn(`weapon.${wi.id}.name`))} Lv.${wi.level}${wi.evolved ? ' ★' : ''}`,
        },
        svgEl(weaponIcon(wi.id)),
        h('em', null, wi.evolved ? '★' : wi.level >= WEAPON_MAX_LEVEL ? 'MAX' : String(wi.level)),
        maxed && !hasPartner ? h('i', { class: 'need', style: { color: PASSIVES[partner].color } }, svgEl(passiveIcon(partner))) : null,
      )
      this.weapons.appendChild(slot)
    }
    clear(this.passives)
    for (const [id, lv] of Object.entries(p.passives)) {
      if (!lv) continue
      const def = PASSIVES[id as keyof typeof PASSIVES]
      this.passives.appendChild(
        h(
          'div',
          { class: 'slot passive', style: { '--c': def.color }, title: `${t(dyn(`passive.${id}.name`))} Lv.${lv}` },
          svgEl(passiveIcon(id as keyof typeof PASSIVES)),
          h('em', null, String(lv)),
        ),
      )
    }
  }

  // ───────────────────────── 文字提示 ─────────────────────────

  showBanner(text: string, sev: 1 | 2, big = false): void {
    this.banner.textContent = text
    this.banner.className = `banner show sev${sev} ${big ? 'big' : ''}`
    // 重启动画
    void this.banner.offsetWidth
    this.bannerT = sev === 2 ? 3.2 : 2.2
  }

  toast(text: string, kind: 'info' | 'good' | 'gold' | 'bad' = 'info', ms = 2400): void {
    const el = h('div', { class: `toast ${kind}` }, text)
    this.toasts.appendChild(el)
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove()
    setTimeout(() => {
      el.classList.add('out')
      setTimeout(() => el.remove(), 400)
    }, ms)
  }

  showHint(text: string, secs = 6): void {
    this.hint.textContent = text
    this.hint.className = 'hint show'
    this.hintT = secs
  }

  hideHint(): void {
    this.hint.className = 'hint'
    this.hintT = 0
  }

  /** 供 e2e 读取的快照 */
  snapshot(): { wSig: string } {
    return { wSig: this.wSig }
  }
}
