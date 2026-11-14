/**
 * 图标样张：把武器 / 被动 / UI 图标按"设计稿大图 + 真实使用尺寸"排在一张图上，逐个检查辨识度。
 *
 *   npm run icons                          # 全部 → .e2e/icons-all.png
 *   npm run icons -- --only weapons,ui     # 只看指定分组（weapons / passives / ui）
 *   npm run icons -- --big 160 --name big  # 设计稿大图尺寸（px）与输出文件名
 *   npm run icons -- --w 760 --dpr 2       # 视口宽度 / 像素比（图片会被查看器缩小时，用窄视口看细节）
 *   npm run icons -- --check               # 只做越界体检：逐个图标量出实际绘制范围，超出画布（被裁掉）就报错退出
 *   npm run icons -- --ids chakram,rail    # 只看指定条目（武器 / 被动 id 或 UI 名）
 *
 * 直接 import 源码里的 icons.ts（tsx 加载器），不需要先 build。全程无头浏览器，不会弹出窗口。
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, root } from './lib/headless.mjs'
import { PASSIVE_ICON, UI_ICON, WEAPON_ICON, passiveIcon, uiIcon, weaponIcon } from '../src/ui/icons.ts'
import { WEAPONS } from '../src/data/weapons.ts'
import { PASSIVES } from '../src/data/passives.ts'

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
const only = new Set(opt('only', 'weapons,passives,ui').split(','))
const ids = opt('ids', '') ? new Set(opt('ids', '').split(',')) : null
const big = Number(opt('big', 112))
const name = opt('name', 'icons-all')
const checkOnly = args.includes('--check')
const vw = Number(opt('w', 1180))
const dpr = Number(opt('dpr', 2))

const wanted = (id) => !ids || ids.has(id)

const plate = (svg, color, px, box, cls = '') =>
  `<div class="plate ${cls}" style="--c:${color};width:${box}px;height:${box}px"><div class="in" style="width:${px}px;height:${px}px">${svg}</div></div>`

const objCell = (id, svgBig, svgSm, color) => `
  <div class="cell">
    ${plate(svgBig, color, big * 0.62, big, 'card')}
    <div class="row">
      ${plate(svgSm, color, 35, 46, 'slot')}
      ${plate(svgSm, color, 27, 36, 'slot')}
      ${plate(svgSm, color, 46, 62, 'card')}
      ${plate(svgSm, color, 20, 20, 'bare')}
    </div>
    <div class="lab">${id}</div>
  </div>`

const uiCell = (id, svg) => `
  <div class="cell ui">
    <div class="uibig" style="width:${big * 0.6}px;height:${big * 0.6}px">${svg}</div>
    <div class="row">
      <div class="btn"><span class="s18">${svg}</span><b>文字</b></div>
      <div class="s24">${svg}</div>
      <div class="s32">${svg}</div>
    </div>
    <div class="lab">${id}</div>
  </div>`

const sections = []
if (only.has('weapons')) {
  sections.push(
    `<h2>武器（设计稿 ${big}px ｜ 槽位 46 / 36（图标占 76%）｜ 升级卡 62（图标 46）｜ 裸图标 20）</h2><div class="grid">${Object.keys(WEAPON_ICON)
      .filter(wanted)
      .map((id) => objCell(id, weaponIcon(id), weaponIcon(id), WEAPONS[id].color))
      .join('')}</div>`,
  )
}
if (only.has('passives')) {
  sections.push(
    `<h2>被动</h2><div class="grid">${Object.keys(PASSIVE_ICON)
      .filter(wanted)
      .map((id) => objCell(id, passiveIcon(id), passiveIcon(id), PASSIVES[id].color))
      .join('')}</div>`,
  )
}
if (only.has('ui')) {
  sections.push(
    `<h2>通用 UI（跟随文字色）</h2><div class="grid">${Object.keys(UI_ICON)
      .filter(wanted)
      .map((id) => uiCell(id, uiIcon(id)))
      .join('')}</div>`,
  )
}

const cw = big + 24
const html = `<!doctype html><meta charset="utf-8"><title>icons</title>
<style>
:root{--cyan:#3df2ff;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#080c1a;color:#cfe;font:12px/1.3 system-ui;padding:18px 18px 24px}
h2{margin:14px 0 10px;font:600 13px system-ui;opacity:.8}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(${cw}px,1fr));gap:14px 12px}
.cell{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.row{display:flex;align-items:center;gap:8px}
.lab{opacity:.6;font-size:11px}
.plate{display:grid;place-items:center;color:var(--c);border-radius:12px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--c) 11%,#151b2e),#0b101f);
  border:1px solid color-mix(in srgb,var(--c) 42%,transparent);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 2px 6px rgba(0,0,0,.35)}
.plate.slot{border:0;border-radius:0;clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);background:linear-gradient(180deg,color-mix(in srgb,var(--c) 14%,#0c1224),#04070f);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 70%,transparent),inset 0 1px 0 color-mix(in srgb,var(--c) 34%,transparent)}
.plate.bare{background:none;border:0;box-shadow:none}
.plate .in{display:block}
.plate .ico,.uibig .ico,.s18 .ico,.s24 .ico,.s32 .ico{width:100%;height:100%;display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.55))}
.uibig{display:grid;place-items:center;color:#dff6ff;background:linear-gradient(180deg,#151b2e,#0b101f);border:1px solid rgba(143,176,255,.25);border-radius:14px;padding:${Math.round(big * 0.12)}px;width:${Math.round(big * 0.6)}px}
.btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:99px;border:1px solid rgba(143,176,255,.3);background:rgba(10,16,36,.78);color:#e6f6ff}
.s18{width:18px;height:18px;display:block}.s24{width:24px;height:24px;color:#9ee8ff}.s32{width:32px;height:32px;color:#ffd84a}
</style>
${sections.join('')}`


// 越界体检：把每个图标画在比画布大一圈的视图里，量实际有像素的范围；超出 [0, size] 说明会被裁掉
const measure = async (page) =>
  page.evaluate(async (items) => {
    const out = []
    for (const it of items) {
      const pad = 8
      const total = it.size + pad * 2
      const px = 12
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${total} ${total}" width="${total * px}" height="${total * px}" style="color:#fff" fill="currentColor" stroke="none" stroke-linecap="round" stroke-linejoin="round">${it.inner}</svg>`
      const img = new Image()
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = cv.height = total * px
      const ctx = cv.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      const u = (v) => Math.round((v / px - pad) * 10) / 10
      out.push({ id: it.id, size: it.size, x0: u(x0), y0: u(y0), x1: u(x1 + 1), y1: u(y1 + 1) })
    }
    return out
  }, [
    ...Object.entries(WEAPON_ICON).map(([id, inner]) => ({ id: `weapon:${id}`, size: 32, inner })),
    ...Object.entries(PASSIVE_ICON).map(([id, inner]) => ({ id: `passive:${id}`, size: 32, inner })),
    ...Object.entries(UI_ICON).map(([id, inner]) => ({ id: `ui:${id}`, size: 24, inner })),
  ])

mkdirSync(join(root, '.e2e'), { recursive: true })
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: vw, height: 600 }, deviceScaleFactor: dpr })).newPage()
await page.setContent(html, { waitUntil: 'load' })
{
  const rows = await measure(page)
  const bad = rows.filter((r) => r.x0 < -0.2 || r.y0 < -0.2 || r.x1 > r.size + 0.2 || r.y1 > r.size + 0.2)
  const dims = (r) => ({ w: r.x1 - r.x0, h: r.y1 - r.y0, cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 })
  const small = rows.filter((r) => !bad.includes(r) && Math.max(dims(r).w, dims(r).h) < r.size * (r.size === 32 ? 0.78 : 0.7))
  const off = rows.filter((r) => !bad.includes(r) && (Math.abs(dims(r).cx - r.size / 2) > 1.6 || Math.abs(dims(r).cy - r.size / 2) > 1.6))
  const fmt = (r) => `${r.id.padEnd(18)} x ${r.x0}..${r.x1}  y ${r.y0}..${r.y1}  (画布 0..${r.size})`
  if (args.includes('--verbose')) for (const r of rows) console.log(`  ${fmt(r)}  中心 ${dims(r).cx.toFixed(1)},${dims(r).cy.toFixed(1)}`)
  for (const r of bad) console.log(`✗ 越界  ${fmt(r)}`)
  for (const r of small) console.log(`· 偏小  ${fmt(r)}`)
  for (const r of off) console.log(`· 偏心  ${fmt(r)}`)
  const loose = [...small, ...off]
  console.log(`体检：${rows.length} 个图标，越界 ${bad.length}，偏小 ${small.length}，偏心 ${off.length}`)
  if (checkOnly) {
    await browser.close()
    process.exit(bad.length ? 1 : 0)
  }
}
// 校验：paint-order 属性确实生效（描边先画、填充后画）
const ok = await page.evaluate(() => {
  const p = document.querySelector('path[paint-order]')
  return p ? getComputedStyle(p).paintOrder : 'none-found'
})
console.log('paint-order computed:', ok)
await page.screenshot({ path: join(root, `.e2e/${name}.png`), fullPage: true })
await browser.close()
console.log(`📸 .e2e/${name}.png`)
