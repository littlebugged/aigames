/**
 * 把游戏里的真实精灵导出成静态页面（玩法指南）用的小图：public/img/sprites/*.webp
 * 图片已提交到仓库，只有改了敌人 / 飞船 / Boss 的美术或新增了条目才需要重跑：
 *
 *   npm run build && node scripts/gen-sprites.mjs
 *
 * 敌人和飞船统一旋转成机头朝上，裁掉透明边距后居中，保证图鉴里每一行的视觉大小一致；
 * Boss 保持原朝向（它们本来就在旋转），用游戏里同一套绘制函数拼成整机。
 * 全程无头浏览器，不会弹出窗口。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dist, launch, root, serveDist } from './lib/headless.mjs'

const outDir = join(root, 'public/img/sprites')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ 不存在，请先运行 npm run build')

const srv = await serveDist()
const browser = await launch()
const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
await page.goto(`http://127.0.0.1:${srv.port}/?e2e=1&q=high`, { waitUntil: 'load' })
await page.waitForSelector('body.ready')
await sleep(500)

const files = await page.evaluate(() => {
  const app = window.__neon
  const r = app.renderer
  const out = {}

  /** 裁掉透明边距、居中并等比缩放到 n×n；rot 为顺时针弧度 */
  const bake = (src, rot, n, pad) => {
    // 先旋转到一张足够大的临时画布
    const side = Math.ceil(Math.hypot(src.width, src.height))
    const a = document.createElement('canvas')
    a.width = a.height = side
    const g = a.getContext('2d')
    g.translate(side / 2, side / 2)
    g.rotate(rot)
    g.drawImage(src, -src.width / 2, -src.height / 2)
    // 求不透明像素的包围盒
    const d = g.getImageData(0, 0, side, side).data
    let x0 = side
    let y0 = side
    let x1 = 0
    let y1 = 0
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        if (d[(y * side + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    const k = (n - pad * 2) / Math.max(w, h)
    const c = document.createElement('canvas')
    c.width = c.height = n
    const o = c.getContext('2d')
    o.imageSmoothingQuality = 'high'
    o.drawImage(a, x0, y0, w, h, (n - w * k) / 2, (n - h * k) / 2, w * k, h * k)
    return c.toDataURL('image/webp', 0.92)
  }

  for (const id of Object.keys(r.bank.enemy)) out[`enemy-${id}`] = bake(r.bank.enemy[id].n.c, -Math.PI / 2, 96, 5)
  for (const id of Object.keys(r.bank.ship)) out[`ship-${id}`] = bake(r.bank.ship[id].n.c, -Math.PI / 2, 96, 5)

  // Boss：整机（8× 超采样的部件 → 缩到 320 像素画布）
  const bossArt = new r.bossArt.constructor(4)
  const radii = { overseer: 58, fractal: 48, maw: 64 }
  for (const id of Object.keys(radii)) {
    const c = document.createElement('canvas')
    c.width = c.height = 360
    const g = c.getContext('2d')
    g.translate(180, 180)
    const fake = { id, x: 0, y: 0, r: radii[id], phase: 0, age: 10, state: 0, ang: 0.7, flash: 0, intro: 0, orbs: [], tx: 0, ty: 0 }
    bossArt.draw(g, fake, 160, 40, 1.3, r.bank)
    out[`boss-${id}`] = bake(c, 0, 160, 5)
  }
  return out
})

for (const [name, url] of Object.entries(files)) {
  const buf = Buffer.from(url.split(',')[1], 'base64')
  writeFileSync(join(outDir, `${name}.webp`), buf)
  console.log(`  ✓ ${name}.webp  ${(buf.length / 1024).toFixed(1)} KB`)
}

await browser.close()
srv.server.close()
