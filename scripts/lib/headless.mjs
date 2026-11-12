/**
 * 无头浏览器工具：找 Chromium、起静态服务器托管 dist/、启动（永远不会弹出窗口）。
 * 供 e2e.mjs 与 gen-assets.mjs 共用。
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

export const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
export const dist = join(root, 'dist')

export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  // 优先无头 shell：体积小、不会出现窗口
  const candidates = [
    [join(homedir(), 'Library/Caches/ms-playwright'), ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64']],
    [join(homedir(), '.cache/ms-playwright'), ['chrome-headless-shell-linux64']],
  ]
  for (const [base, subs] of candidates) {
    if (!existsSync(base)) continue
    for (const d of readdirSync(base).filter((x) => x.startsWith('chromium_headless_shell')).sort().reverse()) {
      for (const sub of subs) {
        const p = join(base, d, sub, 'chrome-headless-shell')
        if (existsSync(p)) return p
      }
    }
  }
  throw new Error('找不到无头 Chromium。请先运行：npx playwright-core install chromium-headless-shell，或设置 CHROME_PATH')
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
}

/** 把 dist/ 当成站点托管（含 404.html），随机端口，仅本机可访问 */
export function serveDist({ transform } = {}) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (p.endsWith('/')) p += 'index.html'
    const file = normalize(join(dist, p))
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      res.end(existsSync(join(dist, '404.html')) ? readFileSync(join(dist, '404.html')) : 'not found')
      return
    }
    let body = readFileSync(file)
    if (transform) body = transform(p, body) ?? body
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })))
}

export async function launch(extra = []) {
  return chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', ...extra],
  })
}

/** 让页面进入"后期战局"：开一局并快进（需要 ?e2e=1 暴露的 window.__neon） */
export async function startDemoRun(page, { sector = 'fields', ship = 'vanguard', threat = 0, ff = 120 } = {}) {
  await page.evaluate(
    ([sector, ship, threat, ff]) => {
      const a = window.__neon
      a.startRun({ ship, sector, threat, endless: false })
      a.godMode = true
      a.autoPilot = true
      if (ff > 0) a.fastForward(ff)
    },
    [sector, ship, threat, ff],
  )
}
