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

/**
 * 512×512 坐标系；rounded=false 时是满铺方形（maskable / apple-touch），内容缩进到安全区。
 * 美术方向与游戏一致（哑光硬表面）：实心机体 + 深墨描边 + 明暗两面，只在驾驶舱和引擎点一小粒自发光；
 * 不使用任何 filter / 模糊发光。
 */
function iconSvg({ rounded = true, inset = 1 } = {}) {
  const INK = '#04060d'
  const bg = rounded
    ? `<rect x="8" y="8" width="496" height="496" rx="116" fill="url(#bg)"/><rect x="8" y="8" width="496" height="496" rx="116" fill="url(#dots)"/><rect x="8" y="8" width="496" height="496" rx="116" fill="url(#vig)"/><rect x="10" y="10" width="492" height="492" rx="114" fill="none" stroke="url(#rim)" stroke-width="3"/>`
    : `<rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#dots)"/><rect width="512" height="512" fill="url(#vig)"/>`
  const P = (cx, cy, s, pts) => pts.map(([x, y]) => `${(cx + y * s).toFixed(1)},${(cy - x * s).toFixed(1)}`).join(' ')
  const ship = P(256, 280, 146, SHIP)
  // 左半边（受光面）：机头 → 左翼尖 → 左凹口 → 尾心
  const lit = P(256, 280, 146, [SHIP[0], SHIP[5], SHIP[4], SHIP[3]])
  const k = inset
  const arc = (a) => `${(256 + 206 * Math.cos((a * Math.PI) / 180)).toFixed(1)}`
  const arcY = (a) => `${(262 + 206 * Math.sin((a * Math.PI) / 180)).toFixed(1)}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#1b2342"/><stop offset="1" stop-color="#070a15"/></linearGradient>
  <pattern id="dots" width="48" height="48" patternUnits="userSpaceOnUse"><circle cx="24" cy="24" r="2.2" fill="#8fb0ff" fill-opacity=".14"/></pattern>
  <radialGradient id="vig" cx=".5" cy=".5" r=".72"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".28"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".04"/><stop offset="1" stop-color="#ffffff" stop-opacity=".1"/></linearGradient>
  <linearGradient id="hullR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8396b8"/><stop offset="1" stop-color="#2e3b5a"/></linearGradient>
  <linearGradient id="hullL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f9ff"/><stop offset=".55" stop-color="#b3c4e0"/><stop offset="1" stop-color="#6f83aa"/></linearGradient>
  <radialGradient id="lamp" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#8ff6ff"/><stop offset="1" stop-color="#1ea9cf"/></radialGradient>
  <linearGradient id="flame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8feff"/><stop offset=".35" stop-color="#3de6ff"/><stop offset="1" stop-color="#3de6ff" stop-opacity="0"/></linearGradient>
  <radialGradient id="shadow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs>
${bg}
<g transform="translate(256 256) scale(${k}) translate(-256 -256)">
  <g fill="none" stroke-linecap="round">
    <circle cx="256" cy="262" r="206" stroke="${INK}" stroke-opacity=".55" stroke-width="20"/>
    <circle cx="256" cy="262" r="206" stroke="#26335a" stroke-width="10"/>
    <circle cx="256" cy="262" r="206" stroke="${INK}" stroke-width="22" stroke-dasharray="170 124" transform="rotate(-62 256 262)"/>
    <circle cx="256" cy="262" r="206" stroke="#3df2ff" stroke-width="11" stroke-dasharray="170 124" transform="rotate(-62 256 262)"/>
    <circle cx="256" cy="262" r="206" stroke="#e6fdff" stroke-opacity=".75" stroke-width="3" stroke-dasharray="170 124" stroke-dashoffset="0" transform="rotate(-62 256 258)"/>
  </g>
  <g stroke-linejoin="round">
    <circle cx="${arc(-50)}" cy="${arcY(-50)}" r="21" fill="${INK}"/>
    <circle cx="${arc(-50)}" cy="${arcY(-50)}" r="16" fill="#ffd84a"/>
    <circle cx="${(+arc(-50) - 5).toFixed(1)}" cy="${(+arcY(-50) - 5).toFixed(1)}" r="6" fill="#fff6c9"/>
    <polygon points="124,116 152,170 96,170" fill="${INK}" stroke="${INK}" stroke-width="14"/>
    <polygon points="124,116 152,170 96,170" fill="#ff4a6a"/>
    <polygon points="124,116 124,170 96,170" fill="#ff8da0"/>
    <g transform="rotate(45 398 440)"><rect x="378" y="420" width="40" height="40" fill="${INK}" stroke="${INK}" stroke-width="14"/><rect x="378" y="420" width="40" height="40" fill="#ff8a3d"/><rect x="378" y="420" width="40" height="20" fill="#ffb07a"/></g>
  </g>
  <ellipse cx="274" cy="404" rx="104" ry="24" fill="url(#shadow)"/>
  <g>
    <polygon points="226,360 246,360 236,424" fill="url(#flame)"/>
    <polygon points="266,360 286,360 276,424" fill="url(#flame)"/>
    <polygon points="${ship}" fill="${INK}" stroke="${INK}" stroke-width="30" stroke-linejoin="round"/>
    <polygon points="${ship}" fill="url(#hullR)"/>
    <polygon points="${lit}" fill="url(#hullL)"/>
    <polyline points="${P(256, 280, 146, [SHIP[0], SHIP[5]])}" fill="none" stroke="#ffffff" stroke-opacity=".7" stroke-width="4" stroke-linecap="round"/>
    <rect x="224" y="344" width="22" height="18" rx="3" fill="#161d33" stroke="${INK}" stroke-width="5"/>
    <rect x="266" y="344" width="22" height="18" rx="3" fill="#161d33" stroke="${INK}" stroke-width="5"/>
    <ellipse cx="256" cy="236" rx="17" ry="32" fill="url(#lamp)" stroke="${INK}" stroke-width="7"/>
  </g>
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
.shot{position:absolute;left:250px;top:0;width:1100px;height:630px;background:url(${shotDataUrl}) center/cover;filter:saturate(1.05) contrast(1.04)}
.shade{position:absolute;inset:0;background:
  linear-gradient(90deg,#05060d 0%,rgba(5,6,13,.97) 28%,rgba(5,6,13,.7) 48%,rgba(5,6,13,.12) 74%,rgba(5,6,13,0) 100%),
  linear-gradient(0deg,rgba(5,6,13,.85) 0%,rgba(5,6,13,0) 30%),
  linear-gradient(180deg,rgba(5,6,13,.55) 0%,rgba(5,6,13,0) 22%)}
.edge{position:absolute;inset:14px;border-radius:26px;border:2px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.badge{position:absolute;left:64px;top:62px;display:flex;align-items:center;gap:12px;font:600 21px/1 Orb;letter-spacing:.2em;color:#3df2ff}
.badge i{width:34px;height:2px;background:linear-gradient(90deg,#3df2ff,transparent)}
.t1,.t2{position:absolute;left:58px;font:900 128px/1 Orb;letter-spacing:.015em;color:transparent;-webkit-background-clip:text;background-clip:text}
.t1{top:106px;background-image:linear-gradient(180deg,#ffffff 0%,#eef3ff 44%,#a8b9da 100%);filter:drop-shadow(0 6px 0 rgba(0,0,0,.45))}
.t2{top:228px;background-image:linear-gradient(90deg,#3df2ff 5%,#a58bff 55%,#ff4fd8 100%);filter:drop-shadow(0 6px 0 rgba(0,0,0,.45))}
.zh{position:absolute;left:68px;top:376px;font-size:44px;font-weight:700;letter-spacing:.55em;color:#fff;text-shadow:0 3px 0 rgba(0,0,0,.5)}
.tag{position:absolute;left:68px;top:446px;width:640px;font-size:23px;line-height:1.5;color:#b9cde6}
.chips{position:absolute;left:68px;top:540px;display:flex;gap:12px}
.chip{padding:9px 16px;border-radius:999px;font-size:19px;font-weight:600;color:var(--c);border:1.5px solid color-mix(in srgb,var(--c) 55%,rgba(255,255,255,.1));background:rgba(14,20,36,.82)}
.url{position:absolute;right:56px;bottom:40px;font:600 24px/1 Orb;letter-spacing:.12em;color:#eaf6ff;text-shadow:0 2px 0 rgba(0,0,0,.6)}
</style></head><body>
<div class="shot"></div><div class="shade"></div><div class="edge"></div>
<div class="badge"><i></i>FREE · BROWSER · NO INSTALL</div>
<div class="t1">NEON</div><div class="t2">SURGE</div>
<div class="zh">霓虹浪涌</div>
<div class="tag">在霓虹怪潮中生存，进化你的武器库。<br>Free neon survivor roguelite — play in your browser.</div>
<div class="chips">${chip('10 武器', '#3df2ff')}${chip('武器进化', '#ff4fd8')}${chip('3 大 Boss', '#ff4a6a')}${chip('手机 / 键盘 / 手柄', '#ffd84a')}</div>
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
    await startDemoRun(page, { sector: 'fields', threat: 3, ff: 330 })
    await page.addStyleTag({ content: '.hint,.toasts,.banner{display:none!important}' })
    await sleep(1200)
    // 等到场上有一批像样的敌人再截（自动驾驶会清场，随机性大）
    for (let i = 0; i < 40; i++) {
      if ((await page.evaluate(() => window.__neon.debug().enemies)) > 220) break
      await sleep(150)
    }
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
