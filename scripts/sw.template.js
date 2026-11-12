/* 霓虹浪涌 Service Worker —— 构建时由 vite 插件注入 __BUILD_ID__ 与预缓存清单。
 * 策略：
 *  - 页面（导航请求）：网络优先，失败回退缓存 → 推送后用户尽快拿到新版本，离线也能玩
 *  - /assets/ 下带哈希的资源：缓存优先（内容不变，文件名就不变）
 *  - 其它同源静态文件（图标、清单）：先给缓存，后台更新
 *  - 缓存名带构建号，新版本激活时自动清理旧缓存
 *  - version.json / sw.js 永远走网络，部署检查与更新探测依赖它们
 */
const BUILD = '__BUILD_ID__'
const CACHE = 'neon-surge-' + BUILD
const PRECACHE = __PRECACHE__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 逐个添加：某个文件失败不会拖垮整个预缓存
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('neon-surge-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function put(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return
  const copy = response.clone()
  caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined)
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/version.json' || url.pathname === '/sw.js') return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          put(req, res)
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/'))),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            put(req, res)
            return res
          }),
      ),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          put(req, res)
          return res
        })
        .catch(() => hit)
      return hit || net
    }),
  )
})
