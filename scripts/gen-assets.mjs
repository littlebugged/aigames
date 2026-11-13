/**
 * 生成站点静态素材（图标 / 社交分享图）。素材已提交到仓库，只有想换设计时才需要重新跑：
 *
 *   npm run build && node scripts/gen-assets.mjs
 *
 * 输出到 public/：favicon.svg、favicon-32.png、apple-touch-icon.png、icon-192.png、icon-512.png、
 * icon-maskable-512.png、og-image.jpg（1200×630，用真实游戏画面合成）。
 * 图标里的飞船 / 敌人 / 宝石直接取自游戏里的真实精灵（8× 超采样重画一份），和局内美术保持一致。
 * 全程使用无头浏览器，不会弹出窗口。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dist, launch, root, serveDist, startDemoRun } from './lib/headless.mjs'

const pub = join(root, 'public')
mkdirSync(pub, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ───────────────────────── 图标 ─────────────────────────

/**
 * 在游戏页面里用真实精灵合成图标（512×512 坐标系），返回各尺寸的 PNG dataURL。
 * rounded=false 时是满铺方形（maskable / apple-touch），内容按 inset 缩进到安全区。
 * 美术方向与游戏一致（哑光硬表面）：不使用任何 filter / 模糊发光，只在引擎处叠一点加色火焰。
 */
async function renderIcons(page) {
  return page.evaluate(() => {
    const r = window.__neon.renderer
    const hb = new r.bank.constructor(8) // 高倍超采样的精灵库，只用来出图
    const TAU = Math.PI * 2
    const S = 512
    const INK = '#04060d'

    function draw(g, { rounded, inset }) {
      g.clearRect(0, 0, S, S)
      const shape = () => {
        g.beginPath()
        if (rounded) g.roundRect(8, 8, 496, 496, 116)
        else g.rect(0, 0, S, S)
      }
      g.save()
      shape()
      g.clip()
      const bg = g.createLinearGradient(0, 0, S * 0.6, S)
      bg.addColorStop(0, '#1b2342')
      bg.addColorStop(1, '#070a15')
      g.fillStyle = bg
      g.fillRect(0, 0, S, S)
      g.fillStyle = 'rgba(143,176,255,0.14)'
      for (let y = 24; y < S; y += 48) {
        for (let x = 24; x < S; x += 48) {
          g.beginPath()
          g.arc(x, y, 2.2, 0, TAU)
          g.fill()
        }
      }
      const vg = g.createRadialGradient(256, 256, 0, 256, 256, S * 0.72)
      vg.addColorStop(0.55, 'rgba(0,0,0,0)')
      vg.addColorStop(1, 'rgba(0,0,0,0.45)')
      g.fillStyle = vg
      g.fillRect(0, 0, S, S)
      g.restore()
      if (rounded) {
        const rim = g.createLinearGradient(0, 10, 0, 502)
        rim.addColorStop(0, 'rgba(255,255,255,0.28)')
        rim.addColorStop(0.5, 'rgba(255,255,255,0.04)')
        rim.addColorStop(1, 'rgba(255,255,255,0.1)')
        g.beginPath()
        g.roundRect(10, 10, 492, 492, 114)
        g.lineWidth = 3
        g.strokeStyle = rim
        g.stroke()
      }

      g.save()
      g.translate(256, 256)
      g.scale(inset, inset)
      g.translate(-256, -256)
      g.lineCap = 'round'
      g.lineJoin = 'round'

      // 外环：深色底 → 钢蓝环 → 一段青色高亮弧
      const ring = (w, color, dash, rotC) => {
        g.save()
        g.translate(256, rotC)
        g.rotate((-62 * Math.PI) / 180)
        g.setLineDash(dash)
        g.lineWidth = w
        g.strokeStyle = color
        g.beginPath()
        g.arc(0, 262 - rotC, 206, 0, TAU)
        g.stroke()
        g.restore()
      }
      g.lineWidth = 20
      g.strokeStyle = 'rgba(4,6,13,0.55)'
      g.beginPath()
      g.arc(256, 262, 206, 0, TAU)
      g.stroke()
      g.lineWidth = 10
      g.strokeStyle = '#26335a'
      g.stroke()
      ring(22, INK, [170, 124], 262)
      ring(11, '#3df2ff', [170, 124], 262)
      ring(3, 'rgba(230,253,255,0.75)', [170, 124], 258)

      // 环上的金色光球
      const ox = 256 + 206 * Math.cos((-50 * Math.PI) / 180)
      const oy = 262 + 206 * Math.sin((-50 * Math.PI) / 180)
      g.fillStyle = INK
      g.beginPath()
      g.arc(ox, oy, 21, 0, TAU)
      g.fill()
      g.fillStyle = '#ffd84a'
      g.beginPath()
      g.arc(ox, oy, 16, 0, TAU)
      g.fill()
      g.fillStyle = '#fff6c9'
      g.beginPath()
      g.arc(ox - 5, oy - 5, 6, 0, TAU)
      g.fill()

      const put = (spr, x, y, k, rot, alpha = 1) => {
        g.save()
        g.translate(x, y)
        g.rotate(rot)
        g.globalAlpha = alpha
        g.drawImage(spr.c, (-spr.w / 2) * k, (-spr.h / 2) * k, spr.w * k, spr.h * k)
        g.restore()
      }

      // 迎面扑来的无人机（朝向飞船），和右下角的晶簇宝石
      put(hb.enemy.drone.n, 122, 140, 4.6, Math.atan2(276 - 140, 256 - 122))
      put(hb.gemBare(3), 408, 436, 3.7, 0)

      // 接触阴影
      g.save()
      g.translate(274, 410)
      g.scale(1, 24 / 104)
      const sh = g.createRadialGradient(0, 0, 0, 0, 0, 104)
      sh.addColorStop(0, 'rgba(0,0,0,0.55)')
      sh.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = sh
      g.beginPath()
      g.arc(0, 0, 104, 0, TAU)
      g.fill()
      g.restore()

      // 先锋号：机头朝上，两道尾焰（加色）压在机身下面
      const K = 8.2
      g.save()
      g.translate(256, 266)
      g.rotate(-Math.PI / 2)
      g.scale(K, K)
      const fl = hb.flame('#3df2ff')
      g.globalCompositeOperation = 'lighter'
      for (const my of [5.85, -5.85]) {
        g.save()
        g.translate(-16.8, my)
        g.rotate(Math.PI)
        g.scale(9 / 36, 6.5 / 12)
        g.drawImage(fl.c, 17 - fl.w / 2, -fl.h / 2, fl.w, fl.h)
        g.restore()
      }
      g.globalCompositeOperation = 'source-over'
      const ship = hb.ship.vanguard.n
      g.drawImage(ship.c, -ship.w / 2, -ship.h / 2, ship.w, ship.h)
      g.restore()

      g.restore()
    }

    /** 逐级对半缩小，比一次缩到位清晰得多 */
    const shrink = (src, size) => {
      let cur = src
      while (cur.width / 2 >= size) {
        const c = document.createElement('canvas')
        c.width = c.height = cur.width / 2
        const x = c.getContext('2d')
        x.imageSmoothingQuality = 'high'
        x.drawImage(cur, 0, 0, c.width, c.height)
        cur = c
      }
      if (cur.width !== size) {
        const c = document.createElement('canvas')
        c.width = c.height = size
        const x = c.getContext('2d')
        x.imageSmoothingQuality = 'high'
        x.drawImage(cur, 0, 0, size, size)
        cur = c
      }
      return cur.toDataURL('image/png')
    }

    const make = (opts) => {
      const c = document.createElement('canvas')
      c.width = c.height = S
      draw(c.getContext('2d'), opts)
      return c
    }
    const round = make({ rounded: true, inset: 1 })
    const apple = make({ rounded: false, inset: 0.92 })
    const mask = make({ rounded: false, inset: 0.74 })
    return {
      'favicon-32.png': shrink(round, 32),
      'favicon-48.png': shrink(round, 48),
      'apple-touch-icon.png': shrink(apple, 180),
      'icon-192.png': shrink(round, 192),
      'icon-512.png': shrink(round, 512),
      'icon-maskable-512.png': shrink(mask, 512),
    }
  })
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

  // 1) 图标：先要有 dist（精灵库就在游戏代码里）
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ 不存在，请先运行 npm run build')
  const srv = await serveDist()
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${srv.port}/?e2e=1&q=high`, { waitUntil: 'load' })
    await page.waitForSelector('body.ready')
    await sleep(500)
    const icons = await renderIcons(page)
    for (const [name, url] of Object.entries(icons)) {
      const buf = Buffer.from(url.split(',')[1], 'base64')
      if (name === 'favicon-48.png') {
        // SVG 图标里内嵌一张 48px 的位图：和 PNG 图标完全一致，又省得再手绘一份矢量
        writeFileSync(
          join(pub, 'favicon.svg'),
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><image width="48" height="48" href="${url}"/></svg>\n`,
        )
        console.log('  ✓ favicon.svg')
        continue
      }
      writeFileSync(join(pub, name), buf)
      console.log('  ✓', name)
    }
    await ctx.close()
  }

  // 2) 社交分享图：先截一张真实的游戏画面
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
