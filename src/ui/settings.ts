import { defaultSave, sanitize, serializeSave, type QualityPref, type Settings } from '../game/progress'
import { dyn, getLang, t } from '../i18n'
import type { UiCtx } from './ctx'
import { clear, h, iconEl } from './dom'

type BoolKey = 'shake' | 'dmgNumbers' | 'reduceFlash' | 'leftHanded' | 'vibration'
type VolKey = 'master' | 'music' | 'sfx'

/** 设置面板：模态，战斗外与暂停菜单里共用。 */
export class SettingsModal {
  readonly el: HTMLElement
  private body: HTMLElement
  private onClose: (() => void) | null = null
  private mode: 'none' | 'import' | 'export' | 'reset' = 'none'
  private exportText = ''
  isOpen = false

  constructor(private readonly ctx: UiCtx) {
    this.body = h('div', { class: 'modal-body' })
    this.el = h(
      'div',
      { class: 'modal settings', role: 'dialog', 'aria-modal': 'true', hidden: true },
      h('div', { class: 'modal-backdrop', onClick: () => this.close() }),
      h('div', { class: 'modal-panel' }, this.body),
    )
  }

  open(onClose?: () => void): void {
    this.onClose = onClose ?? null
    this.mode = 'none'
    this.isOpen = true
    this.el.hidden = false
    this.render()
    this.ctx.sfx('open')
    queueMicrotask(() => this.body.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true }))
    document.body.classList.add('modal-open')
  }

  close(): void {
    if (!this.isOpen) return
    this.isOpen = false
    this.el.hidden = true
    document.body.classList.remove('modal-open')
    this.ctx.persist()
    this.ctx.sfx('back')
    const cb = this.onClose
    this.onClose = null
    cb?.()
  }

  refresh(): void {
    if (this.isOpen) this.render()
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false
    if (e.key === 'Escape') {
      this.close()
      return true
    }
    return false
  }

  private render(): void {
    const ctx = this.ctx
    const st = ctx.save.settings
    clear(this.body)

    const section = (title: string, ...kids: (Node | null)[]): HTMLElement =>
      h('section', { class: 'set-sec' }, h('h3', null, title), ...kids)

    const slider = (key: VolKey, label: string): HTMLElement => {
      const val = h('output', null, `${Math.round(st[key] * 100)}`)
      const input = h('input', {
        type: 'range',
        min: 0,
        max: 100,
        value: Math.round(st[key] * 100),
        'aria-label': label,
        onInput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value)
          st[key] = v / 100
          val.textContent = String(v)
          ctx.applySettings()
        },
        onChange: () => {
          ctx.persist()
          ctx.sfx('click')
        },
      })
      return h('label', { class: 'set-row slider' }, h('span', null, label), input, val)
    }

    const toggle = (key: BoolKey, label: string): HTMLElement => {
      const on = st[key]
      return h(
        'button',
        {
          class: `toggle-row ${on ? 'on' : ''}`,
          role: 'switch',
          'aria-checked': on ? 'true' : 'false',
          onClick: () => {
            st[key] = !st[key]
            ctx.applySettings()
            ctx.persist()
            ctx.sfx('click')
            this.render()
          },
        },
        h('span', { class: 'tr-main' }, h('b', null, label)),
        h('span', { class: 'sw-knob' }),
      )
    }

    const seg = <T extends string>(cur: T, opts: { v: T; label: string }[], on: (v: T) => void): HTMLElement =>
      h(
        'div',
        { class: 'segs compact' },
        ...opts.map((o) =>
          h(
            'button',
            {
              class: `seg ${cur === o.v ? 'active' : ''}`,
              'aria-pressed': cur === o.v ? 'true' : 'false',
              onClick: () => {
                on(o.v)
                ctx.sfx('click')
              },
            },
            o.label,
          ),
        ),
      )

    const qualities: QualityPref[] = ['auto', 'high', 'medium', 'low']

    // 数据区的内联交互（导入/导出/重置）
    let dataArea: HTMLElement | null = null
    if (this.mode === 'import') {
      const ta = h('textarea', { class: 'save-text', rows: 4, placeholder: t('settings.importPrompt'), spellcheck: 'false' })
      dataArea = h(
        'div',
        { class: 'data-area' },
        h('p', null, t('settings.importPrompt')),
        ta,
        h(
          'div',
          { class: 'row-gap' },
          h(
            'button',
            {
              class: 'btn sm primary',
              onClick: () => {
                try {
                  const raw: unknown = JSON.parse(ta.value.trim())
                  if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1) throw new Error('bad')
                  ctx.replaceSave(sanitize(raw, getLang()))
                  ctx.toast(t('settings.importOk'), 'good')
                  ctx.sfx('confirm')
                  this.mode = 'none'
                  this.render()
                } catch {
                  ctx.toast(t('settings.importFail'), 'bad')
                  ctx.sfx('deny')
                }
              },
            },
            t('common.confirm'),
          ),
          h('button', { class: 'btn sm ghost', onClick: () => ((this.mode = 'none'), this.render()) }, t('common.cancel')),
        ),
      )
    } else if (this.mode === 'export') {
      const ta = h('textarea', { class: 'save-text', rows: 4, readonly: true, spellcheck: 'false' })
      ta.value = this.exportText
      dataArea = h(
        'div',
        { class: 'data-area' },
        ta,
        h('div', { class: 'row-gap' }, h('button', { class: 'btn sm ghost', onClick: () => ((this.mode = 'none'), this.render()) }, t('common.close'))),
      )
      queueMicrotask(() => {
        ta.focus({ preventScroll: true })
        ta.select()
      })
    } else if (this.mode === 'reset') {
      dataArea = h(
        'div',
        { class: 'data-area' },
        h('p', { class: 'warn-text' }, t('settings.resetConfirm')),
        h(
          'div',
          { class: 'row-gap' },
          h(
            'button',
            {
              class: 'btn sm danger',
              onClick: () => {
                const fresh = defaultSave(getLang())
                fresh.settings = { ...ctx.save.settings } as Settings
                ctx.replaceSave(fresh)
                ctx.toast(t('settings.resetDone'), 'info')
                this.mode = 'none'
                this.render()
              },
            },
            t('common.confirm'),
          ),
          h('button', { class: 'btn sm ghost', onClick: () => ((this.mode = 'none'), this.render()) }, t('common.cancel')),
        ),
      )
    }

    const lang = getLang()
    const guide = lang === 'zh' ? '/about/' : '/en/about/'
    const privacy = lang === 'zh' ? '/privacy/' : '/en/privacy/'

    const secLang = section(
      t('settings.language'),
      seg(lang, [
        { v: 'zh' as const, label: '中文' },
        { v: 'en' as const, label: 'English' },
      ], (v) => ctx.setLang(v)),
    )

    const secVideo = section(
      t('settings.video'),
      h('div', { class: 'set-row' }, h('span', null, t('settings.quality')), seg(st.quality, qualities.map((q) => ({ v: q, label: t(dyn(`settings.quality.${q}`)) })), (v) => {
        st.quality = v
        ctx.applySettings()
        ctx.persist()
        this.render()
      })),
      toggle('shake', t('settings.shake')),
      toggle('dmgNumbers', t('settings.dmgNumbers')),
      toggle('reduceFlash', t('settings.reduceFlash')),
      toggle('leftHanded', t('settings.leftHanded')),
      toggle('vibration', t('settings.vibration')),
    )

    const secAudio = section(t('settings.audio'), slider('master', t('settings.master')), slider('music', t('settings.music')), slider('sfx', t('settings.sfx')))

    const exportSave = async (): Promise<void> => {
      const text = serializeSave(ctx.save)
      try {
        await navigator.clipboard.writeText(text)
        ctx.toast(t('settings.exportDone'), 'good')
        ctx.sfx('confirm')
      } catch {
        this.exportText = text
        this.mode = 'export'
        this.render()
      }
    }

    const secData = section(
      t('settings.data'),
      h(
        'div',
        { class: 'row-gap wrap' },
        h('button', { class: 'btn sm', onClick: () => void exportSave() }, t('settings.export')),
        h('button', { class: 'btn sm', onClick: () => ((this.mode = 'import'), this.render()) }, t('settings.import')),
        h('button', { class: 'btn sm danger-ghost', onClick: () => ((this.mode = 'reset'), this.render()) }, t('settings.reset')),
      ),
      dataArea,
      h('p', { class: 'about-links' }, h('a', { href: guide, class: 'link' }, t('settings.about')), ' · ', h('a', { href: privacy, class: 'link' }, lang === 'zh' ? '隐私政策' : 'Privacy')),
      h('p', { class: 'build-id' }, `NEON SURGE · build ${__BUILD_ID__}`),
    )

    // 两列：左 语言+画面，右 音频+存档（高度接近，窄屏自动叠成一列）
    this.body.append(
      h('div', { class: 'modal-head' }, h('h2', null, t('settings.title')), h('button', { class: 'btn icon', 'aria-label': t('common.close'), onClick: () => this.close() }, iconEl('close'))),
      h('div', { class: 'set-grid' }, h('div', { class: 'set-col' }, secLang, secVideo), h('div', { class: 'set-col' }, secAudio, secData)),
    )
  }
}
