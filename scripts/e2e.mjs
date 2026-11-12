/**
 * 无头浏览器端到端验证（永远不会弹出浏览器窗口）。
 *
 *   node scripts/e2e.mjs desktop            # 桌面：菜单 → 出击 → 战斗 → 升级 → Boss → 结算 → 各屏幕截图
 *   node scripts/e2e.mjs mobile             # 手机横屏 + 竖屏模拟：触屏摇杆、冲刺按钮、升级面板
 *   node scripts/e2e.mjs smoke              # 冒烟：能启动、无控制台错误、能开一局并推进、音频有输出且不削波
 *   node scripts/e2e.mjs flows              # 关键流程：英文界面、失败结算、机库购买、暂停放弃、手柄
 *   node scripts/e2e.mjs pwa                # Service Worker：激活、离线可玩、新版本提示、清单与图标
 *   node scripts/e2e.mjs play [选项]        # 直接开一局并快进截图：--sector --ship --threat --ff --wait --name --q --audio 1
 *   node scripts/e2e.mjs perf [选项]        # 性能探针：--q high|medium|low|auto --dpr 2 --gpu 1 --secs 6
 *   node scripts/e2e.mjs live [--url URL]   # 对线上地址做冒烟测试（默认 https://aigames.de5.net）
 *
 * 需要先 `npm run build`（本地模式会起一个静态服务器托管 dist/）。
 * 截图输出到 .e2e/，用图片查看器 / 编辑器直接打开即可。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dist, launch, root, serveDist } from './lib/headless.mjs'

const out = join(root, '.e2e')
mkdirSync(out, { recursive: true })

const args = process.argv.slice(2)
const mode = args[0] ?? 'smoke'
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const problems = []

function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${label}] console.error: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`))
  page.on('requestfailed', (r) => {
    if (!/favicon|analytics|insights/.test(r.url())) problems.push(`[${label}] requestfailed: ${r.url()}`)
  })
}

async function shot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0)) // Playwright 的 click 可能顺带滚动文档，截图前复位
  const file = join(out, `${name}.png`)
  await page.screenshot({ path: file })
  console.log('  📸', file.replace(root + '/', ''))
}

const dbg = (page) => page.evaluate(() => window.__neon?.debug())

async function waitReady(page) {
  await page.waitForSelector('body.ready', { timeout: 15000 })
  await page.waitForSelector('.screen.menu', { timeout: 15000 })
}

async function startRunFromMenu(page) {
  await page.click('.btn.play')
  await page.waitForSelector('.screen.deploy')
  await sleep(450)
}

// ───────────────────────── 场景 ─────────────────────────

async function desktop(base) {
  const browser = await launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  watch(page, 'desktop')
  await page.goto(`${base}/?e2e=1&q=high`, { waitUntil: 'load' })
  await waitReady(page)
  await sleep(3500)
  await shot(page, 'd01-menu')

  // 机库 / 成就 / 设置
  await page.click('.menu-row .btn:nth-child(1)')
  await page.waitForSelector('.screen.hangar')
  await sleep(500)
  await shot(page, 'd02-hangar')
  await page.click('.scr-head .back')
  await page.waitForSelector('.screen.menu')
  await page.click('.menu-row .btn:nth-child(2)')
  await page.waitForSelector('.screen.ach')
  await sleep(500)
  await shot(page, 'd03-achievements')
  await page.click('.scr-head .back')
  await page.waitForSelector('.screen.menu')
  await page.click('.menu-row .btn:nth-child(3)')
  await page.waitForSelector('.modal.settings:not([hidden])')
  await sleep(400)
  await shot(page, 'd04-settings')
  await page.keyboard.press('Escape')

  // 出击准备
  await startRunFromMenu(page)
  await shot(page, 'd05-deploy')
  await page.click('.btn.start')
  await page.waitForSelector('.hud:not([hidden])')
  await sleep(7000)
  await shot(page, 'd06-play-early')
  console.log('  debug:', JSON.stringify(await dbg(page)))

  // 快进到中期（机器人代打 + 无敌），再实时看一会儿
  await page.evaluate(() => {
    window.__neon.godMode = true
    window.__neon.autoPilot = true
    window.__neon.fastForward(240)
  })
  await sleep(2500)
  await shot(page, 'd07-play-mid')
  console.log('  debug:', JSON.stringify(await dbg(page)))

  // 手动触发一次升级面板（经验拉满）
  await page.evaluate(() => {
    const a = window.__neon
    a.autoPilot = false // 机器人会立刻替玩家选卡，这里要让面板真正停留
    a.game.player.xp = a.game.player.xpNext
  })
  try {
    await page.waitForSelector('.overlay.levelup:not([hidden])', { timeout: 8000 })
  } catch {
    problems.push('[desktop] 升级面板没有出现')
  }
  await sleep(900)
  await shot(page, 'd08-levelup')
  await page.keyboard.press('1')
  await sleep(600)
  if ((await dbg(page)).phase !== 'play') problems.push('[desktop] 按 1 选卡后没有回到战斗')
  await page.evaluate(() => (window.__neon.autoPilot = true))

  // 暂停
  await page.keyboard.press('Escape')
  await page.waitForSelector('.overlay.pause:not([hidden])')
  await sleep(500)
  await shot(page, 'd09-pause')
  await page.keyboard.press('Escape')
  await sleep(300)

  // Boss：快进到 Boss 出现前后
  await page.evaluate(() => window.__neon.fastForward(600 - window.__neon.game.time - 1))
  await sleep(4500)
  await shot(page, 'd10-boss-intro')
  await sleep(6000)
  await shot(page, 'd11-boss-fight')
  console.log('  debug:', JSON.stringify(await dbg(page)))

  // 把 Boss 打掉 → 结算
  await page.evaluate(() => {
    const w = window.__neon.game
    if (w.boss) w.boss.hp = 1
  })
  await page.evaluate(() => window.__neon.fastForward(30))
  await page.waitForSelector('.overlay.results:not([hidden])', { timeout: 20000 })
  await sleep(2600)
  await shot(page, 'd12-results')
  console.log('  debug:', JSON.stringify(await dbg(page)))

  await browser.close()
}

async function mobile(base) {
  const browser = await launch()
  for (const [label, vp] of [
    ['land', { width: 844, height: 390 }],
    ['port', { width: 390, height: 844 }],
  ]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })
    const page = await ctx.newPage()
    watch(page, `mobile-${label}`)
    await page.goto(`${base}/?e2e=1&q=medium`, { waitUntil: 'load' })
    await waitReady(page)
    await sleep(2500)
    await shot(page, `m-${label}-01-menu`)
    await page.tap('.btn.play')
    await page.waitForSelector('.screen.deploy')
    await sleep(500)
    await shot(page, `m-${label}-02-deploy`)
    await page.tap('.btn.start')
    await page.waitForSelector('.hud:not([hidden])')
    await sleep(2500)
    // 模拟触摸拖动摇杆
    const cdp = await ctx.newCDPSession(page)
    const x0 = vp.width * 0.25
    const y0 = vp.height * 0.6
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] })
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 6, y: y0 - i * 4, id: 1 }] })
      await sleep(60)
    }
    await sleep(700)
    await shot(page, `m-${label}-03-play-joystick`)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.evaluate(() => window.__neon.fastForward(150))
    await page.evaluate(() => {
      const w = window.__neon.game
      w.player.xp = w.player.xpNext
    })
    await page.waitForSelector('.overlay.levelup:not([hidden])', { timeout: 8000 }).catch(() => {})
    await sleep(1000)
    await shot(page, `m-${label}-04-levelup`)
    console.log(`  [${label}] debug:`, JSON.stringify(await dbg(page)))
    await ctx.close()
  }
  await browser.close()
}

/** 直接开一局并快进，用来快速检查某个星区 / 飞船 / 时间点的画面。例：play --sector void --ff 560 --wait 6 --name void-boss */
async function play(base) {
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  const sector = opt('sector', 'fields')
  const ship = opt('ship', 'vanguard')
  const threat = Number(opt('threat', '0'))
  const ff = Number(opt('ff', '120'))
  const wait = Number(opt('wait', '3'))
  const name = opt('name', 'play')
  const vw = Number(opt('w', '1440'))
  const vh = Number(opt('h', '810'))
  const quality = opt('q', 'high')
  const browser = await launch()
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  watch(page, 'play')
  await page.goto(`${base}/?e2e=1&q=${quality}`, { waitUntil: 'load' })
  await waitReady(page)
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
  await sleep(wait * 1000)
  await shot(page, name)
  console.log('  debug:', JSON.stringify(await dbg(page)))
  if (opt('audio', '0') === '1') await checkAudio(page, 'play')
  await browser.close()
}


/** 性能探针：固定后期战局，统计 rAF 帧间隔与渲染耗时。例：perf --q high --gpu 1 --dpr 2 */
async function perf(base) {
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  const quality = opt('q', 'high')
  const dpr = Number(opt('dpr', '1'))
  const vw = Number(opt('w', '1440'))
  const vh = Number(opt('h', '810'))
  const ff = Number(opt('ff', '300'))
  const secs = Number(opt('secs', '6'))
  const gpu = opt('gpu', '0') === '1'
  const browser = await launch(gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy'] : [])
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr })
  const page = await ctx.newPage()
  watch(page, 'perf')
  await page.goto(`${base}/?e2e=1${quality === 'auto' ? '' : `&q=${quality}`}`, { waitUntil: 'load' })
  await waitReady(page)
  await page.evaluate(
    (ff) => {
      const a = window.__neon
      a.startRun({ ship: 'vanguard', sector: 'wasteland', threat: 1, endless: false })
      a.godMode = true
      a.autoPilot = true
      a.fastForward(ff)
    },
    ff,
  )
  const smooth = opt('smooth', '')
  if (smooth) {
    await page.evaluate((v) => {
      const r = window.__neon.renderer
      for (const c of [r.ctx, r.bhC, r.bqC, r.beC]) c.imageSmoothingQuality = v
    }, smooth)
  }
  await sleep(1500)
  const r = await page.evaluate(
    (secs) =>
      new Promise((resolve) => {
        const ts = []
        const ms = []
        const t0 = performance.now()
        const tick = (now) => {
          ts.push(now)
          const d = window.__neon.debug()
          ms.push(Number(d.frameMs))
          if (now - t0 < secs * 1000) requestAnimationFrame(tick)
          else {
            const dts = ts.slice(1).map((v, i) => v - ts[i]).sort((x, y) => x - y)
            const avg = dts.reduce((s, v) => s + v, 0) / dts.length
            resolve({
              frames: ts.length,
              avgDt: +avg.toFixed(1),
              p95Dt: +dts[Math.floor(dts.length * 0.95)].toFixed(1),
              fps: +(1000 / avg).toFixed(1),
              renderMs: +(ms.reduce((s, v) => s + v, 0) / ms.length).toFixed(1),
              debug: d,
            })
          }
        }
        requestAnimationFrame(tick)
      }),
    secs,
  )
  console.log(`  perf q=${quality} dpr=${dpr} ${vw}x${vh} gpu=${gpu}:`, JSON.stringify({ ...r, debug: { enemies: r.debug.enemies, canvas: r.debug.canvas, quality: r.debug.quality } }))
  await browser.close()
}

/** PWA：Service Worker 激活、离线可玩、新版本提示、清单与图标 */
async function pwa() {
  let bump = ''
  const srv = await serveDist({ transform: (p, buf) => (p === '/sw.js' && bump ? Buffer.concat([buf, Buffer.from(`\n// ${bump}`)]) : buf) })
  const base = `http://127.0.0.1:${srv.port}`
  console.log(`e2e: pwa @ ${base}`)
  const browser = await launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  watch(page, 'pwa')
  await page.goto(`${base}/`, { waitUntil: 'load' })
  await waitReady(page)
  const active = await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active)
  console.log('  sw active:', active)
  if (!active) problems.push('[pwa] Service Worker 没有激活')
  await sleep(600)

  await page.reload({ waitUntil: 'load' })
  await waitReady(page)
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null)
  console.log('  controlled after reload:', controlled)
  if (!controlled) problems.push('[pwa] 刷新后页面没有被 Service Worker 控制')

  // 离线：整站应该仍然能打开并进入菜单
  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'load' })
  await waitReady(page)
  console.log('  offline reload: menu visible')
  await shot(page, 'pwa-offline')
  // 从未访问过的 /en/ 也应该来自预缓存
  await page.goto(`${base}/en/`, { waitUntil: 'load' })
  await waitReady(page)
  const enLang = await page.evaluate(() => document.documentElement.lang)
  console.log('  offline /en/ lang:', enLang)
  if (!enLang.startsWith('en')) problems.push('[pwa] 离线访问 /en/ 失败')
  await ctx.setOffline(false)

  // 新版本：改变 sw.js 字节 → 浏览器检测到更新 → 新 SW 接管 → 菜单出现"刷新"提示
  bump = 'v2-' + Date.now()
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration()
    await r?.update()
  })
  try {
    await page.waitForSelector('.toast.update', { timeout: 15000 })
    console.log('  update toast:', JSON.stringify(await page.textContent('.toast.update')))
    await shot(page, 'pwa-update')
  } catch {
    problems.push('[pwa] 新版本接管后没有出现更新提示')
  }

  // 清单与图标
  const mres = await page.request.get(`${base}/manifest.webmanifest`)
  const manifest = await mres.json()
  console.log('  manifest:', manifest.name, manifest.icons.length, 'icons')
  for (const ic of manifest.icons) {
    const r = await page.request.get(base + ic.src)
    if (r.status() !== 200) problems.push(`[pwa] 图标 ${ic.src} → ${r.status()}`)
  }
  for (const f of ['/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/og-image.jpg', '/_headers']) {
    const r = await page.request.get(base + f)
    if (r.status() !== 200) problems.push(`[pwa] ${f} → ${r.status()}`)
  }
  await browser.close()
  srv.server.close()
}

/** 关键用户流程：英文界面、失败结算、机库购买、暂停→放弃、手柄全流程 */
async function flows(base) {
  const browser = await launch()
  const fresh = async (path = '/', { pad = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    if (pad) {
      await ctx.addInitScript(() => {
        window.__padOn = false
        window.__pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }
        navigator.getGamepads = () => (window.__padOn ? [window.__pad] : [])
      })
    }
    const page = await ctx.newPage()
    watch(page, path)
    await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}e2e=1&q=low`, { waitUntil: 'load' })
    await waitReady(page)
    await sleep(500)
    return { ctx, page }
  }
  const a = (page) => page.evaluate(() => window.__neon.debug())

  // A) 英文界面：整条主流程
  {
    const { ctx, page } = await fresh('/en/')
    const lang = await page.evaluate(() => document.documentElement.lang)
    const play = (await page.textContent('.btn.play'))?.trim()
    console.log('  [en] lang =', lang, '| play button =', JSON.stringify(play))
    if (!lang.startsWith('en') || play !== 'Deploy') problems.push('[flows/en] 英文界面没有生效')
    await shot(page, 'f-en-menu')
    await page.click('.btn.play')
    await page.waitForSelector('.screen.deploy')
    await sleep(450)
    await shot(page, 'f-en-deploy')
    await page.click('.btn.start')
    await page.waitForSelector('.hud:not([hidden])')
    await page.evaluate(() => {
      const n = window.__neon
      n.godMode = true
      n.autoPilot = true
      n.fastForward(150)
      n.autoPilot = false
      n.game.player.xp = n.game.player.xpNext
    })
    await page.waitForSelector('.overlay.levelup:not([hidden])', { timeout: 8000 }).catch(() => problems.push('[flows/en] 升级面板没有出现'))
    await sleep(600)
    await shot(page, 'f-en-levelup')
    await ctx.close()
  }

  // B) 失败 → 结算
  {
    const { ctx, page } = await fresh()
    await page.click('.btn.play')
    await page.waitForSelector('.screen.deploy')
    await page.click('.btn.start')
    await page.waitForSelector('.hud:not([hidden])')
    await sleep(1500)
    await page.evaluate(() => {
      const w = window.__neon.game
      w.player.invuln = 0
      w.hurtPlayer(1e6, w.player.x + 1, w.player.y, 'e2e')
    })
    await page.waitForSelector('.overlay.results:not([hidden])', { timeout: 12000 }).catch(() => problems.push('[flows/loss] 失败后没有出现结算'))
    await sleep(1800)
    const d = await a(page)
    console.log('  [loss] phase =', d.phase, 'state =', d.state, 'cores =', d.cores)
    if (d.phase !== 'lost') problems.push(`[flows/loss] 期望 lost，实际 ${d.phase}`)
    await shot(page, 'f-loss-results')
    // 再来一局
    await page.click('.overlay.results .btn.primary')
    await page.waitForSelector('.hud:not([hidden])', { timeout: 8000 }).catch(() => problems.push('[flows/loss] 再来一局没有进入战斗'))
    await sleep(800)
    if ((await a(page)).state !== 'play') problems.push('[flows/loss] 再来一局后不在战斗状态')
    await ctx.close()
  }

  // C) 机库购买：扣费、等级、持久化
  {
    const { ctx, page } = await fresh()
    await page.evaluate(() => {
      const n = window.__neon
      n.save.cores = 5000
      n.ctx.persist()
      n.go('hangar')
    })
    await page.waitForSelector('.screen.hangar')
    await sleep(400)
    const before = await page.evaluate(() => window.__neon.save.cores)
    await page.click('.card.meta .btn.buy')
    await sleep(300)
    const after = await page.evaluate(() => ({ cores: window.__neon.save.cores, meta: { ...window.__neon.save.meta } }))
    console.log('  [hangar] cores', before, '→', after.cores, 'meta', JSON.stringify(after.meta))
    if (!(after.cores < before) || Object.values(after.meta).reduce((s, v) => s + v, 0) !== 1) problems.push('[flows/hangar] 购买没有生效')
    await page.reload({ waitUntil: 'load' })
    await waitReady(page)
    const persisted = await page.evaluate(() => ({ cores: window.__neon.save.cores, meta: { ...window.__neon.save.meta } }))
    if (persisted.cores !== after.cores) problems.push('[flows/hangar] 刷新后存档没有保留')
    await shot(page, 'f-hangar-bought')
    await ctx.close()
  }

  // D) 暂停 → 放弃本局 → 结算
  {
    const { ctx, page } = await fresh()
    await page.click('.btn.play')
    await page.waitForSelector('.screen.deploy')
    await page.click('.btn.start')
    await page.waitForSelector('.hud:not([hidden])')
    await sleep(1200)
    await page.keyboard.press('Escape')
    await page.waitForSelector('.overlay.pause:not([hidden])')
    const t1 = (await a(page)).time
    await sleep(900)
    const t2 = (await a(page)).time
    if (Math.abs(t2 - t1) > 0.05) problems.push(`[flows/pause] 暂停期间时间仍在走 (${t1} → ${t2})`)
    await page.click('.btn.danger-ghost')
    await page.click('.overlay.pause .btn.danger')
    await page.waitForSelector('.overlay.results:not([hidden])', { timeout: 12000 }).catch(() => problems.push('[flows/abandon] 放弃后没有出现结算'))
    await ctx.close()
  }

  // E) 手柄：菜单确认 → 出击 → 摇杆移动 → 冲刺 → Start 暂停
  {
    const { ctx, page } = await fresh('/', { pad: true })
    const press = async (i, ms = 140) => {
      await page.evaluate((i) => (window.__pad.buttons[i].pressed = true), i)
      await sleep(ms)
      await page.evaluate((i) => (window.__pad.buttons[i].pressed = false), i)
      await sleep(120)
    }
    await page.evaluate(() => (window.__padOn = true))
    await press(0) // A：菜单上的"出击"
    await page.waitForSelector('.screen.deploy', { timeout: 5000 }).catch(() => problems.push('[flows/pad] 手柄 A 没能进入出击准备'))
    await sleep(500)
    await press(0) // A：开始出击
    await page.waitForSelector('.hud:not([hidden])', { timeout: 5000 }).catch(() => problems.push('[flows/pad] 手柄 A 没能开始战斗'))
    await sleep(800)
    const x0 = await page.evaluate(() => window.__neon.game.player.x)
    await page.evaluate(() => (window.__pad.axes[0] = 1))
    await sleep(1200)
    await page.evaluate(() => (window.__pad.axes[0] = 0))
    const x1 = await page.evaluate(() => window.__neon.game.player.x)
    console.log('  [pad] 摇杆右推 1.2s：x', Math.round(x0), '→', Math.round(x1))
    if (!(x1 - x0 > 80)) problems.push('[flows/pad] 摇杆没有驱动飞船移动')
    const dashes0 = await page.evaluate(() => window.__neon.game.stats.dashes)
    await press(5)
    const dashes1 = await page.evaluate(() => window.__neon.game.stats.dashes)
    if (!(dashes1 > dashes0)) problems.push('[flows/pad] 手柄冲刺没有触发')
    await press(9) // Start：暂停
    await page.waitForSelector('.overlay.pause:not([hidden])', { timeout: 3000 }).catch(() => problems.push('[flows/pad] Start 没有暂停'))
    await ctx.close()
  }

  // F) 升级卡片：等级点区分"已有 / 本次新增"，升到顶标"升至满级"，卡片下方显示栏位（x/6）和满级标记
  {
    const { ctx, page } = await fresh()
    await page.click('.btn.play')
    await page.waitForSelector('.screen.deploy')
    await page.click('.btn.start')
    await page.waitForSelector('.hud:not([hidden])')
    await sleep(500)
    const trigger = (fill) =>
      page.evaluate((fill) => {
        const n = window.__neon
        const w = n.game
        const P = w.player
        const Inst = P.weapons[0].constructor
        if (fill) {
          const have = new Set(P.weapons.map((x) => x.id))
          for (const id of ['pulse', 'orbit', 'arc', 'missile', 'laser', 'mine', 'nova', 'drone']) {
            if (P.weapons.length >= 6) break
            if (!have.has(id)) P.weapons.push(new Inst(id, P.weapons.length))
          }
        } else {
          n.godMode = true
          n.autoPilot = false
          P.weapons[0].level = 7
          for (const [i, [id, lv]] of [['orbit', 8], ['arc', 3]].entries()) {
            const x = new Inst(id, i + 1)
            x.level = lv
            P.weapons.push(x)
          }
          P.passives.power = 4
          P.passives.haste = 5
        }
        w.recalc()
        P.xp = P.xpNext
        w.addXp(0)
      }, fill)
    await trigger(false)
    await page.waitForSelector('.overlay.levelup:not([hidden])', { timeout: 8000 }).catch(() => problems.push('[flows/cards] 升级面板没有出现'))
    await sleep(500)
    // 手工摆出最容易被误读的卡：武器 7→8、被动 4→5、普通升级
    await page.evaluate(() => {
      const n = window.__neon
      n.game.offers = [
        { kind: 'weapon', id: 'pulse', to: 8, isNew: false, evolve: false },
        { kind: 'passive', id: 'power', to: 5, isNew: false },
        { kind: 'weapon', id: 'arc', to: 4, isNew: false, evolve: false },
      ]
      n.levelup.refresh()
    })
    await sleep(500)
    const probe = () =>
      page.evaluate(() => {
        const q = (sel, root = document) => Array.from(root.querySelectorAll(sel))
        const cards = q('.lv-card')
        return {
          gain: cards.map((c) => q('.pips i.gain', c).length),
          maxtag: cards.map((c) => q('.lv-maxtag', c).length),
          groups: q('.lv-grp-h').map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()),
          maxedChips: q('.lv-chip.maxed').length,
          emptyChips: q('.lv-chip.empty').length,
          fullGroups: q('.lv-grp.full').length,
          kinds: window.__neon.game.offers.map((o) => (o.kind === 'weapon' ? (o.evolve ? 'evolve' : o.isNew ? 'new-weapon' : 'weapon-up') : o.kind)),
        }
      })
    const r1 = await probe()
    console.log('  [cards]', JSON.stringify(r1))
    if (r1.gain.join() !== '1,1,1') problems.push(`[flows/cards] 每张升级卡应恰好有 1 个"新增"等级点，实际 ${r1.gain}`)
    if (r1.maxtag.join() !== '1,1,0') problems.push(`[flows/cards] 只有升到顶的卡才标"升至满级"，实际 ${r1.maxtag}`)
    if (!r1.groups[0]?.includes('3/6') || !r1.groups[1]?.includes('2/6')) problems.push(`[flows/cards] 栏位计数不对：${r1.groups}`)
    if (r1.maxedChips !== 2) problems.push(`[flows/cards] 满级图标应为 2 个，实际 ${r1.maxedChips}`)
    if (r1.emptyChips !== 3 + 4) problems.push(`[flows/cards] 空位应为 7 个，实际 ${r1.emptyChips}`)
    await shot(page, 'f-levelup-cards')
    await page.click('.lv-card:nth-child(3)')
    await page.waitForSelector('.overlay.levelup', { state: 'hidden', timeout: 5000 }).catch(() => problems.push('[flows/cards] 选卡后面板没有关闭'))
    // 武器栏占满 → 显示"已满"，且真实生成的候选里不会再有新武器
    await trigger(true)
    await page.waitForSelector('.overlay.levelup:not([hidden])', { timeout: 8000 }).catch(() => problems.push('[flows/cards] 第二次升级面板没有出现'))
    await sleep(500)
    const r2 = await probe()
    console.log('  [cards/full]', JSON.stringify({ groups: r2.groups, kinds: r2.kinds }))
    if (r2.fullGroups < 1 || !r2.groups[0]?.includes('6/6')) problems.push(`[flows/cards] 武器栏已满时没有标出：${r2.groups}`)
    if (r2.kinds.includes('new-weapon')) problems.push('[flows/cards] 武器栏已满，却仍给出新武器')
    await shot(page, 'f-levelup-full')
    await ctx.close()
  }

  await browser.close()
}

async function smoke(base) {
  const browser = await launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  watch(page, 'smoke')
  await page.goto(`${base}/?e2e=1&q=low`, { waitUntil: 'load' })
  await waitReady(page)
  await sleep(1200)
  await page.click('.btn.play')
  await page.waitForSelector('.screen.deploy')
  await page.click('.btn.start')
  await page.waitForSelector('.hud:not([hidden])')
  await sleep(2500)
  const d = await dbg(page)
  console.log('  debug:', JSON.stringify(d))
  if (!d || d.state !== 'play' || !(d.time > 0.5)) problems.push('[smoke] 战斗没有推进')
  await checkAudio(page, 'smoke')
  await shot(page, 'smoke-play')
  await browser.close()
}

/** 采样 3 秒主输出电平：必须在运行且有声音（合成器没坏），且不能削波爆音 */
async function checkAudio(page, label) {
  const samples = []
  await page.evaluate(() => window.__neon.audioLevel())
  for (let i = 0; i < 30; i++) {
    samples.push(await page.evaluate(() => window.__neon.audioLevel()))
    await sleep(100)
  }
  const ok = samples.filter(Boolean)
  const peak = Math.max(0, ...ok.map((x) => x.peak))
  const rms = ok.reduce((s, x) => s + x.rms, 0) / Math.max(1, ok.length)
  const state = ok[ok.length - 1]?.state ?? 'none'
  console.log(`  audio: state=${state} avgRms=${rms.toFixed(4)} peak=${peak.toFixed(3)}`)
  if (state !== 'running') problems.push(`[${label}] AudioContext 状态 ${state}`)
  else if (!(rms > 0.002)) problems.push(`[${label}] 音频输出几乎静音 (rms=${rms.toFixed(5)})`)
  if (peak > 0.995) problems.push(`[${label}] 音频削波 (peak=${peak.toFixed(3)})`)
}

async function live() {
  const base = (urlArg ?? 'https://aigames.de5.net').replace(/\/$/, '')
  const browser = await launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await ctx.newPage()
  watch(page, 'live')
  const res = await page.goto(`${base}/?e2e=1&q=low`, { waitUntil: 'load' })
  console.log('  status', res?.status(), 'title:', await page.title())
  await waitReady(page)
  await sleep(1200)
  await shot(page, 'live-menu')
  await page.click('.btn.play')
  await page.waitForSelector('.screen.deploy')
  await page.click('.btn.start')
  await page.waitForSelector('.hud:not([hidden])')
  await sleep(3000)
  const d = await dbg(page)
  console.log('  debug:', JSON.stringify(d))
  if (!d || d.state !== 'play' || !(d.time > 0.5)) problems.push('[live] 战斗没有推进')
  await shot(page, 'live-play')
  for (const p of ['/en/', '/guide/', '/en/guide/', '/about/', '/privacy/', '/robots.txt', '/sitemap.xml', '/version.json', '/manifest.webmanifest']) {
    const r = await page.request.get(base + p)
    console.log('  GET', p, r.status())
    if (r.status() !== 200) problems.push(`[live] ${p} → ${r.status()}`)
  }
  await browser.close()
}

// ───────────────────────── 入口 ─────────────────────────

let srv = null
let base = ''
if (mode !== 'live' && mode !== 'pwa') {
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('dist/ 不存在，请先运行 npm run build')
    process.exit(2)
  }
  srv = await serveDist()
  base = `http://127.0.0.1:${srv.port}`
}

try {
  if (mode !== 'pwa') console.log(`e2e: ${mode}${base ? ` @ ${base}` : ''}`)
  if (mode === 'desktop') await desktop(base)
  else if (mode === 'mobile') await mobile(base)
  else if (mode === 'smoke') await smoke(base)
  else if (mode === 'play') await play(base)
  else if (mode === 'perf') await perf(base)
  else if (mode === 'live') await live()
  else if (mode === 'pwa') await pwa()
  else if (mode === 'flows') await flows(base)
  else throw new Error(`未知模式 ${mode}`)
} finally {
  srv?.server.close()
}

if (problems.length > 0) {
  console.error('\n❌ 发现问题：')
  for (const p of problems) console.error('  -', p)
  process.exit(1)
}
console.log('\n✅ e2e 通过，无控制台错误')
