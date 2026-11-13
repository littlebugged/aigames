/**
 * 无头浏览器端到端验证（永远不会弹出浏览器窗口）。
 *
 *   node scripts/e2e.mjs desktop            # 桌面：菜单 → 出击 → 战斗 → 升级 → Boss → 结算 → 各屏幕截图
 *   node scripts/e2e.mjs mobile             # 手机横屏 + 竖屏模拟：触屏摇杆、冲刺按钮、升级面板
 *   node scripts/e2e.mjs smoke              # 冒烟：能启动、无控制台错误、能开一局并推进、音频有输出且不削波
 *   node scripts/e2e.mjs flows              # 关键流程：英文界面、失败结算、机库购买、暂停放弃、手柄
 *   node scripts/e2e.mjs pwa                # Service Worker：激活、离线可玩、新版本提示、清单与图标
 *   node scripts/e2e.mjs fx                 # 手感：伤害数字 8 档梯度 + 武器进化演出（蓄力 → 爆发 → 慢动作 → 横幅 → 光环），逐帧截图
 *   node scripts/e2e.mjs layout [--only 名]  # 版面审计：手机竖/横屏、平板、桌面，满配 HUD 元素互不遮挡、不出屏
 *   node scripts/e2e.mjs art [--scale N]    # 美术样张：把全部预渲染精灵（敌人/飞船/宝石/拾取物/武器件/Boss 部件）放大排在一张图上，逐个检查质感
 *   node scripts/e2e.mjs zoo [选项]         # 敌人动物园：全部敌人（普通 + 精英）定身摆成三排，真实比例截图，检查缩小后的辨识度：--dpr --face --bg --clip
 *   node scripts/e2e.mjs play [选项]        # 直接开一局并快进截图：--sector --ship --threat --ff --wait --name --q --audio 1
 *   node scripts/e2e.mjs perf [选项]        # 性能探针：--q high|medium|low|auto --dpr 2 --gpu 1 --secs 6
 *   node scripts/e2e.mjs live [--url URL]   # 对线上地址做冒烟测试（默认 https://aigames.de5.net）
 *
 * 需要先 `npm run build`（本地模式会起一个静态服务器托管 dist/）。
 * 除 pwa 外，所有模式都可以加 `--url https://aigames.de5.net` 改测线上地址（此时不需要 dist/）。
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
    a.game.addXp(0) // 经验只在 addXp 里结算；不主动结算就要等玩家下一次捡到宝石，8 秒窗口内偶尔等不到
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
      w.addXp(0)
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
  const dpr = Number(opt('dpr', '1'))
  // --touch 1：按手机的方式开（触屏 HUD、移动端 UA），配合 --w 390 --h 844 --dpr 2；--clean 1：截图前隐藏教学提示 / Toast / 横幅
  const touch = opt('touch', '0') === '1'
  const browser = await launch()
  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: dpr,
    ...(touch
      ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
      : {}),
  })
  const page = await ctx.newPage()
  watch(page, 'play')
  await page.goto(`${base}/?e2e=1&q=${quality}`, { waitUntil: 'load' })
  await waitReady(page)
  // --gear orbit,chakram,...：开局直接发这几把武器；--glv 5 设等级；--evo 1 直接进化（看各武器的造型 / 弹道）
  const gear = opt('gear', '')
  const glv = Number(opt('glv', '5'))
  const evo = opt('evo', '0') === '1'
  await page.evaluate(
    ([sector, ship, threat, ff, gear, glv, evo]) => {
      const a = window.__neon
      a.startRun({ ship, sector, threat, endless: false })
      a.godMode = true
      a.autoPilot = true
      if (gear) {
        const w = a.game
        const Inst = w.player.weapons[0].constructor
        for (const id of gear.split(',')) {
          let wi = w.player.weapons.find((x) => x.id === id)
          if (!wi) {
            wi = new Inst(id, w.player.weapons.length)
            w.player.weapons.push(wi)
          }
          wi.level = glv
          wi.evolved = evo
        }
        w.recalc()
      }
      if (ff > 0) a.fastForward(ff)
    },
    [sector, ship, threat, ff, gear, glv, evo],
  )
  await sleep(wait * 1000)
  // --catch beams|bolts|rings|ebullets|hbeams|hrings：一小步一小步往前跑，直到场上出现这种特效的那一帧，再暂停截图
  // （武器是自动开火的，直接截图常常拍不到光束 / 电弧 / 冲击环）。--skip N 再多跑 N 小步（0.03 秒一步）
  const catchWhat = opt('catch', '')
  if (catchWhat) {
    const skip = Number(opt('skip', '0'))
    const got = await page.evaluate(
      ([what, skip]) => {
        const a = window.__neon
        const w = a.game
        const has = () => {
          if (what === 'beams') return w.beams.some((b) => b.alive && !b.hostile)
          if (what === 'bolts') return w.bolts.some((b) => b.alive)
          if (what === 'rings') return w.rings.some((r) => r.alive && !r.hostile && r.delay <= 0 && r.r > 40)
          if (what === 'ebullets') return w.ebullets.length > 12
          if (what === 'hbeams') return w.beams.some((b) => b.alive && b.hostile)
          if (what === 'hrings') return w.rings.some((r) => r.alive && r.hostile && r.r > 120)
          return false
        }
        let n = 0
        while (!has() && n++ < 1500) a.fastForward(0.03)
        for (let i = 0; i < skip; i++) a.fastForward(0.03)
        a.paused = true
        return { n, ok: has() }
      },
      [catchWhat, skip],
    )
    console.log('  catch:', JSON.stringify(got))
    await sleep(200)
  }
  // --lab fx：清场后把激光 / 磁轨 / 电弧 / 冲击波 / 敌方子弹 / 敌方光束各摆一份定格样张并暂停
  // （看光束类特效和弹幕的造型；效果都是相对屏幕中心摆的，配合 --w 1280 --h 720 时 1 世界单位 = 1 像素）
  if (opt('lab', '') === 'fx') {
    // 敌方子弹样张：[kind, 颜色, 半径]；新增子弹造型后在这里补一行就能在样张里看到
    const labBullets = [
      ['orb', '#ff3ea5', 6.5],
      ['glob', '#ffd84a', 6],
      ['lens', '#ff3ea5', 6.5],
      ['shard', '#9dff4d', 6.5],
      ['fang', '#c9a0ff', 6],
      ['needle', '#ff6a8a', 5.5],
      ['needle', '#c8ff66', 5.5],
    ]
    await page.evaluate((BUL) => {
      const a = window.__neon
      const w = a.game
      const p = w.player
      a.autoPilot = false
      a.godMode = true
      for (const e of w.enemies) e.alive = false
      for (const b of w.ebullets) b.alive = false
      for (const b of w.beams) b.alive = false
      for (const r of w.rings) r.alive = false
      for (const t of w.bolts) t.alive = false
      p.vx = p.vy = 0
      a.renderer.cam.reset(p.x, p.y)
      const cx = p.x
      const cy = p.y
      // 光束：life 取中段，保证画出来是"满威力"的样子
      const beam = (x, y, len, width, color, o = {}) => {
        const b = w.addBeam()
        b.fixed = true
        b.hostile = !!o.hostile
        b.punch = !!o.punch
        b.style = o.style ?? 'laser'
        b.warn = o.warn ?? 0
        b.ox = cx + x
        b.oy = cy + y
        b.ang = o.ang ?? 0
        b.len = len
        b.width = width
        b.maxLife = o.maxLife ?? 1
        b.life = b.maxLife * (o.k ?? 0.6)
        b.tick = 99
        b.dmg = 0
        b.color = color
        return b
      }
      beam(-610, -225, 250, 16, '#c9a0ff') // 激光
      beam(-310, -225, 250, 26, '#ffe8a8') // 激光（进化）
      beam(0, -225, 300, 17, '#ff4d6d', { punch: true, style: 'rail', maxLife: 0.32, k: 0.8 }) // 磁轨
      beam(340, -225, 300, 14, '#ffb3c1', { style: 'scar' }) // 磁轨进化的灼痕
      beam(340, -225, 300, 28, '#ff8aa0', { punch: true, style: 'rail', maxLife: 0.32, k: 0.8 }) // 磁轨（进化）
      // 电弧：沿一条折线连跳
      const arc = (x0, y0, n, step, color) => {
        const pts = [x0, y0]
        for (let i = 1; i <= n; i++) pts.push(x0 + i * step, y0 + (i % 2 ? -26 : 22) + (i % 3) * 8)
        w.addBolt(pts.map((v, i) => v + (i % 2 ? cy : cx)), color, 0.22)
        const t = w.bolts[w.bolts.length - 1]
        t.life = t.maxLife * 0.9
      }
      arc(-600, -105, 3, 90, '#ffe66b')
      arc(-290, -105, 8, 66, '#fff7b0')
      // 冲击波
      const ring = (x, y, r, maxR, color, hostile) => {
        const g = w.addRing()
        g.x = cx + x
        g.y = cy + y
        g.r = r
        g.maxR = maxR
        g.color = color
        g.hostile = !!hostile
        g.delay = 0
        return g
      }
      ring(-440, 100, 105, 290, '#e8fbff')
      ring(-160, 100, 105, 290, '#ffe0a0')
      ring(120, 100, 105, 290, '#c9a0ff', true)
      // 敌方子弹：(kind, color, r)
      BUL.forEach(([kind, color, r], i) => {
        const x = 330 + (i % 4) * 70
        const y = 20 + Math.floor(i / 4) * 52
        w.spawnEnemyBullet(cx + x, cy + y, -0.5 + (i % 4) * 0.35, 220, 10, { kind, color, r, life: 99 })
      })
      // 敌方光束：预警（暗而细）与生效
      beam(-610, 235, 330, 22, '#ff4d6d', { hostile: true, style: 'boss', warn: 1 })
      beam(-250, 235, 330, 22, '#ff4d6d', { hostile: true, style: 'boss' })
      // 爆炸：同一颗在三个寿命阶段 + 换色两颗（星芒 / 冲击环 / 白热芯）
      const blast = (x, y, r, color, k) => {
        w.addBlast(cx + x, cy + y, r, color, 1)
        const b = w.blasts[w.blasts.length - 1]
        b.life = b.maxLife * k
      }
      blast(-110, 215, 72, '#ffb347', 0.85)
      blast(40, 215, 72, '#ffb347', 0.55)
      blast(190, 215, 72, '#ffb347', 0.3)
      blast(340, 215, 72, '#5dff9e', 0.55)
      blast(490, 215, 72, '#4dd8ff', 0.55)
      a.paused = true
    }, labBullets)
    await sleep(300)
  }
  // --pickups 2：不清场，把五种拾取物撒在玩家四周（距离 150~260），然后暂停——拍"战斗中的拾取物"用（README 配图）
  if (opt('pickups', '0') === '2') {
    await page.evaluate(() => {
      const a = window.__neon
      const w = a.game
      const p = w.player
      ;['heal', 'magnet', 'bomb', 'chest', 'cache'].forEach((k, i) => {
        const ang = -2.4 + i * 1.25
        const d = 170 + (i % 2) * 70
        w.addPickup(k, p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d * 0.8, k === 'cache' ? 30 : 0)
      })
      a.autoPilot = false
      a.paused = true
    })
    await sleep(300)
  }
  // --pickups 1：清场后在玩家下方一字排开五种拾取物，并暂停（看造型 / 光晕 / 缩放后的辨识度）
  if (opt('pickups', '0') === '1') {
    await page.evaluate(() => {
      const a = window.__neon
      const w = a.game
      const p = w.player
      for (const e of w.enemies) e.alive = false
      ;['heal', 'magnet', 'bomb', 'chest', 'cache'].forEach((k, i) => w.addPickup(k, p.x + (i - 2) * 56, p.y + 84, k === 'cache' ? 30 : 0))
      a.autoPilot = false
      a.paused = true
    })
    await sleep(300)
  }
  if (opt('clean', '0') === '1') await page.addStyleTag({ content: '.hint,.toasts,.banner,.evo-banner{display:none!important}' })
  // --tele 1：在玩家周围摆几条不同进度的 Boss 预警（直线 / 圆形 / 临出手快闪），看警示带的画法
  if (opt('tele', '0') === '1') {
    await page.evaluate(() => {
      const w = window.__neon.game
      const p = w.player
      const mk = (kind, x, y, prog, o) => {
        const tl = w.addTele(kind, x, y, 1000, '', o)
        tl.t = tl.maxT * (1 - prog)
      }
      mk('line', p.x - 420, p.y - 150, 0.2, { x2: p.x + 420, y2: p.y - 150, r: 15, color: '#9dff4d' })
      mk('line', p.x - 420, p.y + 10, 0.6, { x2: p.x + 420, y2: p.y + 10, r: 15, color: '#9dff4d' })
      mk('line', p.x - 420, p.y + 170, 0.9, { x2: p.x + 420, y2: p.y + 170, r: 15, color: '#9dff4d' })
      mk('circle', p.x - 260, p.y - 20, 0.55, { r: 80, color: '#ff3ea5' })
      mk('circle', p.x + 230, p.y - 20, 0.9, { r: 80, color: '#ff4a6a' })
    })
    await sleep(500)
  }
  await shot(page, name)
  // --clip x,y,w,h：按 CSS 像素再截一张局部放大图（配合 --dpr 2 看细节）
  const clip = opt('clip', '')
  if (clip) {
    const [x, y, w, h] = clip.split(',').map(Number)
    const file = join(out, `${name}-clip.png`)
    await page.screenshot({ path: file, clip: { x, y, width: w, height: h } })
    console.log('  📸', file.replace(root + '/', ''))
  }
  console.log('  debug:', JSON.stringify(await dbg(page)))
  if (opt('audio', '0') === '1') await checkAudio(page, 'play')
  await browser.close()
}


/**
 * 敌人动物园：把全部敌人（普通 + 精英）定身摆成两排，以游戏里的真实比例截图，检查"缩小后还认不认得出"。
 * 例：zoo --dpr 2 --name zoo；--face 0.6 统一朝向（弧度）；--bg void 换星区底色。
 */
async function zoo(base) {
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  const name = opt('name', 'zoo')
  const vw = Number(opt('w', '1280'))
  const vh = Number(opt('h', '720'))
  const dpr = Number(opt('dpr', '2'))
  const sector = opt('bg', 'fields')
  const face = Number(opt('face', '0'))
  const browser = await launch()
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr })
  const page = await ctx.newPage()
  watch(page, 'zoo')
  await page.goto(`${base}/?e2e=1&q=high`, { waitUntil: 'load' })
  await waitReady(page)
  await page.evaluate(
    ([sector, face]) => {
      const a = window.__neon
      a.startRun({ ship: 'vanguard', sector, threat: 0, endless: false })
      a.godMode = true
      const w = a.game
      const p = w.player
      const ids = ['drone', 'swarmer', 'brute', 'shooter', 'splitter', 'charger', 'bomber', 'shielder', 'wraith', 'shard']
      const put = (id, x, y, elite, ang) => {
        const e = w.spawnEnemy(id, x, y, { spawnT: 0, elite })
        e.stun = 1e9
        e.angle = e.ra = ang
        e.age = 1
      }
      ids.forEach((id, i) => {
        const x = p.x + (i - 4.5) * 92
        put(id, x, p.y - 150, false, face)
        put(id, x, p.y - 30, false, face + Math.PI * 0.75)
        put(id, x, p.y + 110, true, face - Math.PI * 0.4)
      })
    },
    [sector, face],
  )
  await sleep(900)
  await page.addStyleTag({ content: '.hint,.toasts,.banner{display:none!important}' })
  await sleep(200)
  await shot(page, name)
  const clip = opt('clip', '')
  if (clip) {
    const [x, y, w, h] = clip.split(',').map(Number)
    const file = join(out, `${name}-clip.png`)
    await page.screenshot({ path: file, clip: { x, y, width: w, height: h } })
    console.log('  📸', file.replace(root + '/', ''))
  }
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
  // --eval "js"：采样前在页面里执行一段脚本（做 A/B 实验用，例：--eval "__neon.renderer.bloomPass=()=>{}"）
  const pre = opt('eval', '')
  if (pre) await page.evaluate(pre)
  await sleep(1500)
  // --hits N：采样期间每帧额外灌入 N 次重击（T3–T7、含暴击），压测伤害数字 / 命中特效的限流
  const hits = Number(opt('hits', '0'))
  const r = await page.evaluate(
    ({ secs, hits }) =>
      new Promise((resolve) => {
        const ts = []
        const ms = []
        const t0 = performance.now()
        const DMG = [60, 120, 260, 520, 1400]
        const tick = (now) => {
          ts.push(now)
          if (hits > 0) {
            const w = window.__neon.game
            const p = w.player
            for (let i = 0; i < hits; i++) {
              w.emit({ t: 'hit', x: p.x + (Math.random() - 0.5) * 700, y: p.y + (Math.random() - 0.5) * 420, dmg: DMG[i % DMG.length], crit: i % 3 === 0, color: '#ff6a8a', boss: false })
            }
          }
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
    { secs, hits },
  )
  console.log(`  perf q=${quality} dpr=${dpr} ${vw}x${vh} gpu=${gpu}${hits ? ` hits/frame=${hits}` : ''}:`, JSON.stringify({ ...r, debug: { enemies: r.debug.enemies, canvas: r.debug.canvas, quality: r.debug.quality } }))
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
      n.game.addXp(0)
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
          for (const id of ['pulse', 'orbit', 'arc', 'missile', 'laser', 'mine', 'nova', 'drone', 'chakram', 'rail']) {
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

  // G) 吸附：吃到磁铁后全屏的经验石都被吸向飞机，机器人一路跑动，也不该出现绕着飞机转圈、几秒都收不走的石头
  {
    const { ctx, page } = await fresh()
    await page.click('.btn.play')
    await page.waitForSelector('.screen.deploy')
    await page.click('.btn.start')
    await page.waitForSelector('.hud:not([hidden])')
    await sleep(500)
    await page.evaluate(() => {
      const n = window.__neon
      const w = n.game
      n.godMode = true
      n.autoPilot = true
      const p = w.player
      p.xpNext = 1e9 // 别被升级面板打断
      for (let i = 0; i < 150; i++) {
        const a = Math.random() * Math.PI * 2
        const d = 100 + Math.random() * 900
        w.addGem(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1)
      }
      for (const g of w.gems) g.mag = true
    })
    let worst = 0
    for (let i = 0; i < 12; i++) {
      await sleep(500)
      const stuck = await page.evaluate(() => window.__neon.game.gems.filter((g) => g.mag && g.magT > 2.5).length)
      worst = Math.max(worst, stuck)
    }
    const left = await page.evaluate(() => window.__neon.game.gems.filter((g) => g.mag).length)
    console.log(`  [magnet] 吸附 6 秒后：滞留>2.5s 的石头最多 ${worst} 颗，仍在吸附中 ${left} 颗`)
    if (worst > 0) problems.push(`[flows/magnet] 有 ${worst} 颗被吸附的经验石超过 2.5 秒没被收走（绕着飞机转圈？）`)
    await ctx.close()
  }

  await browser.close()
}

/** 手感专项：伤害数字分级 + 武器进化演出。截图在 .e2e/fx*.png，同时断言演出时序（导演 / 横幅 / 慢动作 / 光环）。 */
async function fx(base) {
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  const browser = await launch()
  const ctx = await browser.newContext({ viewport: { width: Number(opt('w', '1280')), height: Number(opt('h', '720')) }, deviceScaleFactor: Number(opt('dpr', '1')) })
  const page = await ctx.newPage()
  watch(page, 'fx')
  await page.goto(`${base}/?e2e=1&q=high`, { waitUntil: 'load' })
  await waitReady(page)
  await page.evaluate(() => {
    const a = window.__neon
    a.startRun({ ship: 'vanguard', sector: 'fields', threat: 0, endless: false })
    a.godMode = true
  })
  await page.waitForSelector('.hud:not([hidden])')
  await sleep(600)

  // ⓪ 数字字样本：8 档 + 受伤数字，静止不动（寿命很长、不上浮、不弹出），逐档对比字形质感，不受截图时序影响
  await page.evaluate(() => {
    const a = window.__neon
    const p = a.game.player
    const specimens = [['6', 0, 11], ['14', 1, 13], ['30', 2, 15], ['60', 3, 19], ['120', 4, 23], ['260', 5, 28], ['520', 6, 34], ['1.4k', 7, 41], ['-18', 8, 18]]
    specimens.forEach(([text, tier, size], i) => {
      a.renderer.texts.add(p.x - 330 + i * 84, p.y + 40, text, { size, style: tier, life: 600, pop: 1, tier: tier === 8 ? 4 : tier, rise: 0 })
    })
  })
  await sleep(450)
  await shot(page, 'fx0-numbers-specimen')
  await page.evaluate(() => window.__neon.renderer.texts.clear())

  // ① 伤害数字梯度：上排普通命中，下排同样数值的暴击（上浮一档）
  await page.evaluate(() => {
    const w = window.__neon.game
    const p = w.player
    const dmgs = [6, 14, 30, 60, 120, 260, 520, 1400]
    dmgs.forEach((d, i) => {
      w.emit({ t: 'hit', x: p.x - 330 + i * 94, y: p.y - 120, dmg: d, crit: false, color: '#ff6a8a', boss: false })
      w.emit({ t: 'hit', x: p.x - 330 + i * 94, y: p.y + 120, dmg: d, crit: true, color: '#ff6a8a', boss: false })
    })
  })
  await sleep(90)
  await shot(page, 'fx1-numbers-pop')
  await sleep(330)
  await shot(page, 'fx2-numbers-settled')

  // ② 武器进化：升满第一把武器并补上配套被动 → 触发升级 → 在面板里选进化卡
  const PARTNER = { pulse: 'power', orbit: 'area', arc: 'haste', missile: 'accel', laser: 'multi', mine: 'magnet', nova: 'armor', drone: 'learning', chakram: 'thruster', rail: 'luck' }
  await sleep(1200) // 等数字散去
  await page.evaluate((partners) => {
    const a = window.__neon
    const w = a.game
    const p = w.player
    const wi = p.weapons[0]
    wi.level = 8
    wi.evolved = false
    p.passives[partners[wi.id]] = Math.max(1, p.passives[partners[wi.id]] ?? 0)
    w.recalc()
    w.addXp(p.xpNext)
  }, PARTNER)
  try {
    await page.waitForSelector('.overlay.levelup:not([hidden])', { timeout: 6000 })
  } catch {
    problems.push('[fx] 升级面板没有出现')
  }
  await sleep(500)
  const evoIdx = await page.evaluate(() => window.__neon.game.offers.findIndex((o) => o.kind === 'weapon' && o.evolve))
  if (evoIdx < 0) {
    problems.push('[fx] 升级卡里没有进化选项')
  } else {
    const t0 = Date.now()
    await page.keyboard.press(String(evoIdx + 1))
    const marks = [
      ['charge', 140],
      ['boom', 430],
      ['hold', 560],
      ['ramp', 820],
      ['banner', 1500],
      ['after', 3600],
    ]
    const seen = {}
    for (const [label, at] of marks) {
      await sleep(Math.max(0, at - (Date.now() - t0)))
      const st = await page.evaluate(() => {
        const a = window.__neon
        return {
          cine: a.cine ? { t: +a.cine.t.toFixed(2), boomed: a.cine.boomed } : null,
          banner: !!document.querySelector('.evo-banner.show'),
          evolved: a.game.player.weapons.filter((x) => x.evolved).length,
          frameMs: Math.round(a.renderer.frameMs * 100) / 100,
        }
      })
      seen[label] = st
      console.log(`  ${label.padEnd(7)} +${Date.now() - t0}ms`, JSON.stringify(st))
      await shot(page, `fx3-evolve-${label}`)
    }
    if (seen.charge.evolved !== 1) problems.push('[fx] 选进化卡后武器没有进化')
    if (!seen.charge.cine && !seen.boom.cine) problems.push('[fx] 进化后演出导演没有启动')
    if (!Object.values(seen).some((x) => x.cine?.boomed)) problems.push('[fx] 冲击波没有引爆（导演从未进入爆发阶段）')
    // 每个采样点都带一次截图，真实耗时会漂移，所以只要任意一次采样看到横幅就算数
    if (!Object.values(seen).some((x) => x.banner)) problems.push('[fx] 进化横幅没有显示')
    // 截图会让页面主循环停顿（App 限制了单帧时间步长，游戏时间走得比墙钟慢），高 DPR 下尤其明显，
    // 所以"演出结束、横幅退场"改成轮询等待（最多 12 秒），而不是按墙钟时间点断言
    const done = await page
      .waitForFunction(() => !window.__neon.cine && !document.querySelector('.evo-banner.show'), null, { timeout: 12000, polling: 100 })
      .then(() => true, () => false)
    if (!done) problems.push('[fx] 演出结束后，演出导演应已退出（时间流速恢复正常）且进化横幅应已消失')

    // ③ 无障碍：关掉"屏幕震动"、打开"减少闪烁"后再进化一次——不应有镜头变焦与白闪，横幅等其余演出照常
    await page.evaluate((partners) => {
      const a = window.__neon
      a.save.settings.shake = false
      a.save.settings.reduceFlash = true
      a.applySettings()
      const w = a.game
      const p = w.player
      const wi = p.weapons[0]
      wi.level = 8
      wi.evolved = false
      p.passives[partners[wi.id]] = Math.max(1, p.passives[partners[wi.id]] ?? 0)
      w.recalc()
      w.addXp(p.xpNext)
    }, PARTNER)
    try {
      await page.waitForSelector('.overlay.levelup:not([hidden])', { timeout: 6000 })
    } catch {
      problems.push('[fx/a11y] 第二次升级面板没有出现')
    }
    await sleep(500)
    const idx2 = await page.evaluate(() => window.__neon.game.offers.findIndex((o) => o.kind === 'weapon' && o.evolve))
    if (idx2 < 0) {
      problems.push('[fx/a11y] 第二次升级卡里没有进化选项')
    } else {
      await page.keyboard.press(String(idx2 + 1))
      let maxZoom = 0
      let maxFlash = 0
      let bannerSeen = false
      for (let i = 0; i < 18; i++) {
        await sleep(100)
        const st = await page.evaluate(() => {
          const r = window.__neon.renderer
          return { zoom: r.zoom, flash: r.flashA, banner: !!document.querySelector('.evo-banner.show') }
        })
        maxZoom = Math.max(maxZoom, st.zoom)
        maxFlash = Math.max(maxFlash, st.flash)
        bannerSeen = bannerSeen || st.banner
      }
      console.log(`  [a11y] 关闭震动 + 减少闪烁：最大变焦 ${maxZoom.toFixed(3)}，最大白闪 ${maxFlash.toFixed(3)}，横幅${bannerSeen ? '有' : '无'}`)
      if (maxZoom > 0) problems.push(`[fx/a11y] 关闭"屏幕震动"后镜头仍在变焦（${maxZoom.toFixed(3)}）`)
      if (maxFlash > 0) problems.push(`[fx/a11y] 开启"减少闪烁"后仍出现白闪（${maxFlash.toFixed(3)}）`)
      if (!bannerSeen) problems.push('[fx/a11y] 无障碍设置下进化横幅没有显示')
    }
  }
  console.log('  debug:', JSON.stringify(await dbg(page)))
  await browser.close()
}

/**
 * 版面审计：各种屏幕下，"满配"状态（6 武器 + 6 被动 + 教学提示 + Toast + Boss 血条 + 通用横幅 + 进化横幅）
 * 的 HUD 元素互不遮挡、不出屏。包围盒在页面里量，两两检查；截图写到 .e2e/layout-*.png。
 */
async function layout(base) {
  const profiles = [
    { name: 'phone-port', w: 390, h: 844, touch: true },
    { name: 'phone-port-s', w: 360, h: 640, touch: true },
    { name: 'phone-land', w: 844, h: 390, touch: true },
    { name: 'phone-land-s', w: 667, h: 360, touch: true },
    { name: 'tablet-port', w: 820, h: 1180, touch: true },
    { name: 'desktop', w: 1280, h: 720, touch: false },
    { name: 'desktop-s', w: 1024, h: 600, touch: false },
  ]
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
  const browser = await launch()
  for (const pf of profiles) {
    if (only && pf.name !== only) continue
    const ctx = await browser.newContext({
      viewport: { width: pf.w, height: pf.h },
      deviceScaleFactor: 2,
      isMobile: pf.touch,
      hasTouch: pf.touch,
      ...(pf.touch ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}),
    })
    const page = await ctx.newPage()
    watch(page, `layout-${pf.name}`)
    await page.goto(`${base}/?e2e=1&q=medium`, { waitUntil: 'load' })
    await waitReady(page)
    await sleep(1200)
    if (pf.touch) await page.tap('.btn.play')
    else await page.click('.btn.play')
    await page.waitForSelector('.screen.deploy')
    if (pf.touch) await page.tap('.btn.start')
    else await page.click('.btn.start')
    await page.waitForSelector('.hud:not([hidden])')
    await sleep(800)
    await page.evaluate(() => {
      const a = window.__neon
      a.godMode = true
      a.fastForward(240)
      a.paused = true // 定格：模拟停住，HUD 的计时器也不再走，元素位置稳定
      const p = a.game.player
      const W = ['pulse', 'orbit', 'arc', 'missile', 'laser', 'mine']
      p.weapons = W.map((id, i) => ({ id, slot: i, level: i < 2 ? 8 : 3 + i, evolved: i < 2, timer: 0, pending: 0, angle: 0, pts: [], s: p.weapons[0].s }))
      const P = ['power', 'area', 'haste', 'accel', 'multi', 'magnet']
      for (const k of Object.keys(p.passives)) delete p.passives[k]
      P.forEach((id, i) => (p.passives[id] = 1 + (i % 3)))
      const hud = a.hud
      hud.showHint('武器练到满级，再带上搭档装备，就能进化！', 999)
      hud.toast('获得补给：+120 晶核', 'gold', 600000)
      hud.toast('磁暴地雷 升至 Lv.4', 'good', 600000)
      hud.bossBar.hidden = false
      hud.bossName.textContent = '监察者'
      hud.bossFill.style.width = '72%'
      hud.showBanner('警告：Boss 来袭', 2, true)
      hud.showEvolve('missile')
    })
    await sleep(500)
    const measure = async (label) => {
      const boxes = await page.evaluate(() => {
        const rect = (el) => {
          const r = el.getBoundingClientRect()
          return { x: r.left, y: r.top, r: r.right, b: r.bottom }
        }
        const union = (els) => {
          const rs = els.filter((e) => e && e.getClientRects().length > 0).map(rect) // display:none 的元素不参与
          if (!rs.length) return null
          return { x: Math.min(...rs.map((r) => r.x)), y: Math.min(...rs.map((r) => r.y)), r: Math.max(...rs.map((r) => r.r)), b: Math.max(...rs.map((r) => r.b)) }
        }
        const q = (s) => [...document.querySelectorAll(s)]
        const visible = (el) => !!el && el.getClientRects().length > 0
        const touch = document.querySelector('.hud').classList.contains('touch')
        const o = {
          hp: union(q('.hud-tl .hp')),
          lv: union(q('.hud-xp .xp-lv')),
          timer: union(q('.hud-tc .timer')),
          eta: union(q('.hud-tc .boss-eta').filter((e) => e.textContent)),
          bossbar: union(q('.hud-tc .boss-bar').filter(visible)),
          kills: union(q('.hud-tr .kills')),
          pause: union(q('.hud-tr .hud-pause')),
          weapons: union(q('.hud-bl .weapons .slot')),
          passives: union(q('.hud-bl .passives .slot')),
          dash: union(touch ? q('.hud-br .dash-btn') : q('.hud-bc .dash-ring')),
          hint: union(q('.hint.show')),
          toasts: union(q('.toasts .toast')),
          banner: union(q('.banner.show')),
          evo: union(q('.evo-banner.show .evo-plate')),
        }
        return { vw: innerWidth, vh: innerHeight, touch, slots: q('.hud-bl .slot').length, boxes: o }
      })
      const { vw, vh, boxes: B } = boxes
      const names = Object.keys(B).filter((k) => B[k])
      const hits = []
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const a = B[names[i]]
          const b = B[names[j]]
          const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x)
          const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y)
          if (ox > 1 && oy > 1) hits.push(`${names[i]}×${names[j]}（重叠 ${Math.round(ox)}×${Math.round(oy)}px）`)
        }
      }
      const out = []
      for (const n of names) {
        const r = B[n]
        if (r.x < -1 || r.y < -1 || r.r > vw + 1 || r.b > vh + 1) out.push(`${n} 超出屏幕 (${Math.round(r.x)},${Math.round(r.y)})-(${Math.round(r.r)},${Math.round(r.b)}) / ${vw}×${vh}`)
      }
      console.log(`  [${pf.name}/${label}] ${vw}×${vh} touch=${boxes.touch} 槽位=${boxes.slots}  重叠=${hits.length} 出屏=${out.length}`)
      for (const s of hits) console.log('     重叠：', s)
      for (const s of out) console.log('     出屏：', s)
      for (const s of hits) problems.push(`[layout/${pf.name}/${label}] 重叠 ${s}`)
      for (const s of out) problems.push(`[layout/${pf.name}/${label}] ${s}`)
      await shot(page, `layout-${pf.name}${label === 'full' ? '' : '-' + label}`)
    }
    await measure('full')
    // 开局状态：1 把武器、没有被动、只剩教学提示——手机上教学提示紧贴冲刺键，最容易在这个状态下撞上
    await page.evaluate(() => {
      const a = window.__neon
      const p = a.game.player
      p.weapons = [p.weapons[0]]
      for (const k of Object.keys(p.passives)) delete p.passives[k]
      a.hud.toasts.replaceChildren()
      a.hud.banner.classList.remove('show')
      a.hud.evoBanner.classList.remove('show')
      a.hud.bossBar.hidden = true
      a.hud.showHint('按住屏幕左侧拖动即可移动，武器会自动开火', 999)
    })
    await sleep(500)
    await measure('early')
    await ctx.close()
  }
  await browser.close()
}

/**
 * 美术样张：把预渲染精灵放大排成一张图（.e2e/art-sheet.png），逐个检查质感、描边、渐变与光晕。
 * 精灵取自渲染器私有的 SpriteBank / BossArt（?e2e=1 时可访问），不依赖战局状态。
 */
async function art(base) {
  const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
  const scale = Number(opt('scale', '3.4'))
  const hiss = Number(opt('ss', '8'))
  const sheetH = Number(opt('sheeth', '3300'))
  // --only pickups,weapons：只排这几组（放大看细节时不必把敌人 / 飞船也排进来）
  const only = opt('only', '').split(',').filter(Boolean)
  // --items blade,mine：只排标签以这些开头的条目（配合 --scale 10 逐个放大看）
  const items = opt('items', '').split(',').filter(Boolean)
  const browser = await launch()
  const ctx = await browser.newContext({ viewport: { width: 1000, height: sheetH }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  watch(page, 'art')
  await page.goto(`${base}/?e2e=1&q=high`, { waitUntil: 'load' })
  await waitReady(page)
  await page.evaluate(() => {
    const a = window.__neon
    a.startRun({ ship: 'vanguard', sector: 'fields', threat: 0, endless: false })
    a.paused = true
  })
  await sleep(500)
  const rects = await page.evaluate(
    ({ S, SS, SH, ONLY, ITEMS }) => {
      const a = window.__neon
      const r = a.renderer
      // 用更高的超采样重新生成一套精灵，放大看细节；游戏里实际用的是 r.bank（ss≈2.5）
      const bank = new r.bank.constructor(SS)
      const boss = new r.bossArt.constructor(SS)
      const isSprite = (v) => v && v.c instanceof HTMLCanvasElement && typeof v.w === 'number'
      const groups = []
      groups.push({ id: 'enemies', name: '敌人', items: Object.entries(bank.enemy).map(([k, v]) => ({ label: k, sp: v.n, s: S })) })
      groups.push({ id: 'ships', name: '飞船', items: Object.entries(bank.ship).map(([k, v]) => ({ label: k, sp: v.n, s: S })) })
      groups.push({
        id: 'pickups',
        name: '宝石 / 拾取物',
        items: [
          ...bank.gem.map((v, i) => ({ label: `gem${i}`, sp: v, s: S + 1 })),
          ...Object.entries(bank.pickup).map(([k, v]) => ({ label: k, sp: v, s: S })),
        ],
      })
      const weaponItems = []
      for (const [m, cols] of [
        ['blade', ['#8fb8ff', '#ffd24d']],
        ['chakram', ['#ff7ae0', '#ffd2f6']],
        ['drone', ['#7dffb0', '#c8ffe0']],
        ['mine', ['#5dff9e']],
        ['missile', ['#ff9b3d']],
        ['bolt', ['#3df2ff', '#7dffb0']],
        ['plasma', ['#3df2ff']],
        ['glow', ['#3df2ff', '#ff4d8d', '#ffffff']],
        ['bead', ['#ff4d6d', '#3df2ff', '#ffd84a']],
        ['flame', ['#3df2ff']],
      ]) {
        if (typeof bank[m] !== 'function') continue
        for (const c of cols) weaponItems.push({ label: `${m} ${c}`, sp: bank[m](c), s: m === 'glow' ? 1.5 : S })
      }
      if (isSprite(bank.shadow)) weaponItems.push({ label: 'shadow', sp: bank.shadow, s: 1.5, light: true })
      groups.push({ id: 'weapons', name: '武器件 / 子弹 / 光斑', items: weaponItems })
      // 敌方子弹：[造型, 颜色]（和战斗里各 Boss / 敌人用的配色一致）
      groups.push({
        id: 'bullets',
        name: '敌方子弹',
        items: [
          ['orb', '#ff4d6d'],
          ['glob', '#ffd84a'],
          ['lens', '#ff3ea5'],
          ['shard', '#9dff4d'],
          ['fang', '#c9a0ff'],
          ['needle', '#ff6a8a'],
          ['needle', '#c8ff66'],
        ].map(([k, c]) => ({ label: `${k} ${c}`, sp: bank.ebullet(k, c), s: S * 0.9 })),
      })
      groups.push({
        id: 'bosses',
        name: 'Boss 部件',
        items: Object.entries(boss)
          .filter(([, v]) => isSprite(v))
          .map(([k, v]) => ({ label: k, sp: v, s: 1.2 })),
      })

      const W = 1000
      const H = SH
      const cv = document.createElement('canvas')
      cv.width = W
      cv.height = H
      cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#080c18'
      document.body.appendChild(cv)
      const g = cv.getContext('2d')
      // 背景接近游戏里的底色，右侧叠一块亮色，检查在亮背景上的轮廓
      g.fillStyle = '#0a0f1f'
      g.fillRect(0, 0, W, H)
      const lg = g.createLinearGradient(0, 0, W, 0)
      lg.addColorStop(0.62, 'rgba(46,60,100,0)')
      lg.addColorStop(1, 'rgba(70,86,140,0.55)')
      g.fillStyle = lg
      g.fillRect(0, 0, W, H)
      g.textBaseline = 'top'
      const out = []
      let y = 10
      for (const grp of groups.filter((g) => ONLY.length === 0 || ONLY.includes(g.id))) {
        const y0 = y
        g.fillStyle = '#7f93c4'
        g.font = '600 15px system-ui'
        g.fillText(grp.name, 14, y)
        y += 24
        let x = 14
        let rowH = 0
        for (const it of grp.items.filter((i) => ITEMS.length === 0 || ITEMS.some((p) => i.label.startsWith(p)))) {
          const w = it.sp.w * it.s
          const h = it.sp.h * it.s
          if (x + w + 14 > W) {
            x = 14
            y += rowH + 30
            rowH = 0
          }
          g.drawImage(it.sp.c, x, y, w, h)
          // 1× 实际大小各画一次：看缩小后的辨识度
          g.drawImage(it.sp.c, x + w * 0.5 - it.sp.w * 0.5, y + h + 4, it.sp.w, it.sp.h)
          g.fillStyle = '#a7b6dd'
          g.font = '11px system-ui'
          g.fillText(it.label, x, y + h + it.sp.h + 8)
          x += Math.max(w, 70) + 16
          rowH = Math.max(rowH, h + it.sp.h + 16)
        }
        y += rowH + 36
        out.push({ id: grp.id, y: Math.max(0, y0 - 6), h: Math.min(H, y - y0 + 4) })
      }
      return out
    },
    { S: scale, SS: hiss, SH: sheetH, ONLY: only, ITEMS: items },
  )
  await sleep(200)
  await shot(page, 'art-sheet')
  for (const r of rects) {
    const file = join(out, `art-${r.id}.png`)
    await page.screenshot({ path: file, clip: { x: 0, y: r.y, width: 1000, height: Math.min(r.h, sheetH - r.y) } })
    console.log('  📸', file.replace(root + '/', ''))
  }
  // 三个 Boss 的"整机"：用游戏里同一套绘制函数拼起来（含阶段色环境光 / 阴影），放大 1.5 倍看
  await page.evaluate(
    ({ S }) => {
      const a = window.__neon
      const r = a.renderer
      const bossArt = new r.bossArt.constructor(8)
      const W = 1000
      const H = 360
      document.querySelectorAll('canvas[data-bosses]').forEach((c) => c.remove())
      const cv = document.createElement('canvas')
      cv.dataset.bosses = '1'
      cv.width = W
      cv.height = H
      cv.style.cssText = 'position:fixed;left:0;top:0;z-index:100000;background:#080c18'
      document.body.appendChild(cv)
      const g = cv.getContext('2d')
      const bg = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.7)
      bg.addColorStop(0, '#16203d')
      bg.addColorStop(1, '#070a14')
      g.fillStyle = bg
      g.fillRect(0, 0, W, H)
      const defs = [
        { id: 'overseer', r: 58 },
        { id: 'fractal', r: 48 },
        { id: 'maw', r: 64 },
      ]
      defs.forEach((d, i) => {
        const fake = { id: d.id, x: 0, y: 0, r: d.r, phase: 0, age: 10, state: 0, ang: 0.7 + i, flash: 0, intro: 0, orbs: [], tx: 0, ty: 0 }
        g.save()
        g.translate(W * (0.17 + i * 0.33), H / 2)
        g.scale(S, S)
        bossArt.draw(g, fake, 160, 40, 1.3 + i, r.bank)
        g.restore()
      })
    },
    { S: Math.min(scale, 1.5) },
  )
  await sleep(150)
  await page.screenshot({ path: join(out, 'art-bosses-assembled.png'), clip: { x: 0, y: 0, width: 1000, height: 360 } })
  console.log('  📸', '.e2e/art-bosses-assembled.png')
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
  if (urlArg) {
    // 指定了 --url：直接测线上 / 预览地址，不起本地静态服务器
    base = urlArg.replace(/\/$/, '')
  } else {
    if (!existsSync(join(dist, 'index.html'))) {
      console.error('dist/ 不存在，请先运行 npm run build')
      process.exit(2)
    }
    srv = await serveDist()
    base = `http://127.0.0.1:${srv.port}`
  }
}

try {
  if (mode !== 'pwa') console.log(`e2e: ${mode}${base ? ` @ ${base}` : ''}`)
  if (mode === 'desktop') await desktop(base)
  else if (mode === 'mobile') await mobile(base)
  else if (mode === 'smoke') await smoke(base)
  else if (mode === 'play') await play(base)
  else if (mode === 'zoo') await zoo(base)
  else if (mode === 'perf') await perf(base)
  else if (mode === 'live') await live()
  else if (mode === 'pwa') await pwa()
  else if (mode === 'flows') await flows(base)
  else if (mode === 'fx') await fx(base)
  else if (mode === 'layout') await layout(base)
  else if (mode === 'art') await art(base)
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
