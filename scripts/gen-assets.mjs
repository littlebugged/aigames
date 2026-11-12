/**
 * 生成站点静态素材（图标 / 社交分享图）。素材已提交到仓库，只有想换设计时才需要重新跑：
 *
 *   npm run build && node scripts/gen-assets.mjs
 *
 * 输出到 public/：favicon.svg、favicon-32.png、apple-touch-icon.png、icon-192.png、icon-512.png、
 * icon-maskable-512.png、og-image.jpg（1200×630，用真实游戏画面合成）。
 * 全程使用无头浏览器，不会弹出窗口。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dist, launch, root, serveDist, startDemoRun } from './lib/headless.mjs'

const pub = join(root, 'public')
mkdirSync(pub, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ───────────────────────── 图标 ─────────────────────────

const SHIP = [
  [1, 0],
  [-0.7, 0.92],
  [-0.38, 0.3],
  [-0.58, 0],
  [-0.38, -0.3],
  [-0.7, -0.92],
]
/** 先锋号轮廓，机头朝上 */
const shipPoints = (cx, cy, s) => SHIP.map(([x, y]) => `${(cx + y * s).toFixed(1)},${(cy - x * s).toFixed(1)}`).join(' ')

/** 512×512 坐标系；rounded=false 时是满铺方形（maskable / apple-touch），内容缩进到安全区 */
function iconSvg({ rounded = true, inset = 1 } = {}) {
  const bg = rounded
    ? `<rect x="8" y="8" width="496" height="496" rx="116" fill="url(#bg)"/><rect x="8" y="8" width="496" height="496" rx="116" fill="url(#halo)"/><rect x="11" y="11" width="490" height="490" rx="113" fill="none" stroke="#3df2ff" stroke-opacity=".38" stroke-width="3"/>`
    : `<rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#halo)"/>`
  const ship = shipPoints(256, 280, 146)
  const k = inset
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d1538"/><stop offset="1" stop-color="#04050b"/></linearGradient>
  <radialGradient id="halo" cx=".5" cy=".55" r=".62"><stop offset="0" stop-color="#3df2ff" stop-opacity=".26"/><stop offset=".6" stop-color="#7a5cff" stop-opacity=".07"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="13" result="b1"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b2"/>
    <feMerge><feMergeNode in="b1"/><feMergeNode in="b1"/><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
${bg}
<g transform="translate(256 256) scale(${k}) translate(-256 -256)">
  <g stroke-linecap="round" fill="none">
    <circle cx="256" cy="262" r="206" stroke="#3df2ff" stroke-opacity=".12" stroke-width="2"/>
    <circle cx="256" cy="262" r="206" stroke="#ff4fd8" stroke-width="11" stroke-dasharray="170 124" transform="rotate(-62 256 262)" filter="url(#glow)" opacity=".9"/>
  </g>
  <g filter="url(#glow)">
    <circle cx="${(256 + 206 * Math.cos((-50 * Math.PI) / 180)).toFixed(1)}" cy="${(262 + 206 * Math.sin((-50 * Math.PI) / 180)).toFixed(1)}" r="17" fill="#ffd84a"/>
    <polygon points="124,122 146,164 102,164" fill="none" stroke="#ff4a6a" stroke-width="8" stroke-linejoin="round" opacity=".95"/>
    <rect x="386" y="428" width="24" height="24" fill="none" stroke="#ff4a6a" stroke-width="8" stroke-linejoin="round" transform="rotate(45 398 440)" opacity=".95"/>
  </g>
  <g filter="url(#glow)">
    <polygon points="${ship}" fill="#3df2ff" fill-opacity=".2" stroke="#3df2ff" stroke-width="15" stroke-linejoin="round"/>
  </g>
  <polygon points="${ship}" fill="none" stroke="#eafcff" stroke-width="4.5" stroke-linejoin="round" opacity=".95"/>
</g>
</svg>`
}

// ───────────────────────── 社交分享图 ─────────────────────────

function fontCss() {
  const f = (w) => {
    const file = join(root, 'node_modules/@fontsource/orbitron/files', `orbitron-latin-${w}-normal.woff2`)
    return `@font-face{font-family:Orb;font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(file).toString('base64')}) format('woff2')}`
  }
  return [600, 800, 900].map(f).join('\n')
}

function ogHtml(shotDataUrl) {
  const chip = (txt, c) => `<span class="chip" style="--c:${c}">${txt}</span>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontCss()}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1200px;height:630px;position:relative;overflow:hidden;background:#05060d;color:#eaf6ff;
  font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',system-ui,sans-serif}
.shot{position:absolute;left:250px;top:0;width:1100px;height:630px;background:url(${shotDataUrl}) center/cover;filter:saturate(1.15) contrast(1.05)}
.shade{position:absolute;inset:0;background:
  linear-gradient(90deg,#05060d 0%,rgba(5,6,13,.97) 28%,rgba(5,6,13,.7) 48%,rgba(5,6,13,.12) 74%,rgba(5,6,13,0) 100%),
  linear-gradient(0deg,rgba(5,6,13,.85) 0%,rgba(5,6,13,0) 30%),
  linear-gradient(180deg,rgba(5,6,13,.55) 0%,rgba(5,6,13,0) 22%)}
.edge{position:absolute;inset:14px;border-radius:26px;border:2px solid rgba(61,242,255,.28);box-shadow:inset 0 0 60px rgba(61,242,255,.08)}
.badge{position:absolute;left:64px;top:62px;display:flex;align-items:center;gap:12px;font:600 21px/1 Orb;letter-spacing:.2em;color:#3df2ff}
.badge i{width:34px;height:2px;background:linear-gradient(90deg,#3df2ff,transparent)}
.t1,.t2{position:absolute;left:58px;font:900 128px/1 Orb;letter-spacing:.015em;color:transparent;-webkit-background-clip:text;background-clip:text}
.t1{top:106px;background-image:linear-gradient(90deg,#ffffff,#9ff7ff);filter:drop-shadow(0 0 26px rgba(61,242,255,.5))}
.t2{top:228px;background-image:linear-gradient(90deg,#3df2ff 5%,#a58bff 55%,#ff4fd8 100%);filter:drop-shadow(0 0 28px rgba(255,79,216,.45))}
.zh{position:absolute;left:68px;top:376px;font-size:44px;font-weight:700;letter-spacing:.55em;color:#fff;text-shadow:0 0 22px rgba(61,242,255,.7)}
.tag{position:absolute;left:68px;top:446px;width:640px;font-size:23px;line-height:1.5;color:#b9cde6}
.chips{position:absolute;left:68px;top:540px;display:flex;gap:12px}
.chip{padding:9px 16px;border-radius:999px;font-size:19px;font-weight:600;color:var(--c);border:1.5px solid color-mix(in srgb,var(--c) 70%,transparent);background:color-mix(in srgb,var(--c) 12%,rgba(5,6,13,.6))}
.url{position:absolute;right:56px;bottom:40px;font:600 24px/1 Orb;letter-spacing:.12em;color:#eaf6ff;text-shadow:0 0 14px rgba(61,242,255,.8)}
</style></head><body>
<div class="shot"></div><div class="shade"></div><div class="edge"></div>
<div class="badge"><i></i>FREE · BROWSER · NO INSTALL</div>
<div class="t1">NEON</div><div class="t2">SURGE</div>
<div class="zh">霓虹浪涌</div>
<div class="tag">在霓虹怪潮中生存，进化你的武器库。<br>Free neon survivor roguelite — play in your browser.</div>
<div class="chips">${chip('8 武器', '#3df2ff')}${chip('武器进化', '#ff4fd8')}${chip('3 大 Boss', '#ff4a6a')}${chip('手机 / 键盘 / 手柄', '#ffd84a')}</div>
<div class="url">aigames.de5.net</div>
</body></html>`
}

// ───────────────────────── 主流程 ─────────────────────────

async function main() {
  const browser = await launch()

  // 1) 图标
  writeFileSync(join(pub, 'favicon.svg'), iconSvg({ rounded: true }))
  const targets = [
    ['favicon-32.png', 32, iconSvg({ rounded: true })],
    ['apple-touch-icon.png', 180, iconSvg({ rounded: false, inset: 0.92 })],
    ['icon-192.png', 192, iconSvg({ rounded: true })],
    ['icon-512.png', 512, iconSvg({ rounded: true })],
    ['icon-maskable-512.png', 512, iconSvg({ rounded: false, inset: 0.74 })],
  ]
  {
    const ctx = await browser.newContext({ deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    for (const [name, size, svg] of targets) {
      await page.setViewportSize({ width: size, height: size })
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
      await page.screenshot({ path: join(pub, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
      console.log('  ✓', name)
    }
    await ctx.close()
  }

  // 2) 社交分享图：先截一张真实的游戏画面
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ 不存在，请先运行 npm run build')
  const srv = await serveDist()
  let shot
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 630 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${srv.port}/?e2e=1&q=high`, { waitUntil: 'load' })
    await page.waitForSelector('body.ready')
    await sleep(800)
    await startDemoRun(page, { sector: 'wasteland', ff: 330 })
    await page.addStyleTag({ content: '.hint,.toasts,.banner{display:none!important}' })
    await sleep(3200)
    shot = await page.screenshot({ type: 'jpeg', quality: 92 })
    await ctx.close()
  }
  srv.server.close()
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.setContent(ogHtml(`data:image/jpeg;base64,${shot.toString('base64')}`))
    await sleep(400)
    await page.screenshot({ path: join(pub, 'og-image.jpg'), type: 'jpeg', quality: 90 })
    console.log('  ✓ og-image.jpg')
    await ctx.close()
  }
  await browser.close()
}

await main()
