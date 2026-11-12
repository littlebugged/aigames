import './styles/main.css'
import { App } from './app/app'
import { initPwa } from './app/pwa'

function boot(): void {
  const canvas = document.getElementById('c') as HTMLCanvasElement | null
  const ui = document.getElementById('ui')
  const stage = document.getElementById('stage')
  if (!canvas || !ui || !stage) return
  try {
    const app = new App(canvas, ui, stage)
    document.body.classList.add('ready')
    initPwa({ onUpdate: () => app.notifyUpdate(), onInstallChange: () => app.refreshMenu() })
  } catch (err) {
    console.error(err)
    const lang = document.documentElement.lang.startsWith('en')
    ui.innerHTML = `<div class="boot-error"><h2>${lang ? 'The game failed to start' : '游戏启动失败'}</h2><p>${lang ? 'Please use a recent browser with Canvas and JavaScript enabled, then refresh.' : '请使用较新的浏览器并开启 JavaScript 后刷新重试。'}</p><button class="btn primary lg">${lang ? 'Refresh' : '刷新页面'}</button></div>`
    ui.querySelector('button')?.addEventListener('click', () => location.reload())
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()
