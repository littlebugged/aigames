/**
 * PWA 能力：Service Worker 注册、新版本探测、"安装到桌面"提示。
 *
 * Service Worker 策略（见 scripts/sw.template.js → 构建后的 /sw.js）：
 * - HTML 网络优先（推送后用户尽快拿到新版本），失败回退缓存（离线可玩）
 * - 带哈希的静态资源缓存优先；缓存名带构建号，新版本上线自动清理旧缓存
 * 开发模式（vite dev）与 ?e2e=1 不注册，避免缓存干扰调试。
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface PwaHooks {
  /** 新版本已接管页面（用户刷新即可玩到） */
  onUpdate(): void
  /** "可安装"状态变化（出现/消失） */
  onInstallChange(): void
}

let deferred: BeforeInstallPromptEvent | null = null
let installListener: (() => void) | null = null

// 事件可能在 App 构造完成之前就触发，所以在模块加载时就监听并暂存
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as BeforeInstallPromptEvent
  installListener?.()
})
window.addEventListener('appinstalled', () => {
  deferred = null
  installListener?.()
})

export const canInstall = (): boolean => deferred !== null

/** 弹出系统安装对话框；返回用户是否接受 */
export async function promptInstall(): Promise<boolean> {
  const ev = deferred
  if (!ev) return false
  deferred = null
  installListener?.()
  try {
    await ev.prompt()
    const { outcome } = await ev.userChoice
    return outcome === 'accepted'
  } catch {
    return false
  }
}

export function initPwa(hooks: PwaHooks): void {
  installListener = hooks.onInstallChange
  if (!('serviceWorker' in navigator)) return
  if (import.meta.env.DEV) return
  if (new URLSearchParams(location.search).get('e2e') === '1') return

  // 只有"页面加载时已经受控"的情况下，controllerchange 才代表"新版本接管了"；
  // 首次访问时 SW 第一次 claim 也会触发该事件，那不是更新。
  const hadController = navigator.serviceWorker.controller !== null
  let notified = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || notified) return
    notified = true
    hooks.onUpdate()
  })

  const start = (): void => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // 长时间不关页面的玩家：回到标签页时、以及每 30 分钟主动探测一次新版本
        const check = (): void => void reg.update().catch(() => undefined)
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) check()
        })
        setInterval(check, 30 * 60 * 1000)
      })
      .catch(() => {
        /* 注册失败不影响游戏 */
      })
  }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}
