import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ACHIEVEMENTS } from '../src/data/achievements'
import { UI_ICON } from '../src/ui/icons'
import { MEDAL_EMBLEM, MEDAL_TIERS, medalSvg, medalTier } from '../src/ui/medals'

/**
 * 勋章是字符串拼出来的 SVG + CSS 变量配色，Node 里没有浏览器可以看。
 * 这里守的是"映射 + 结构 + 配色钩子"三类回归：档位怎么划、每个成就有没有徽记、SVG 有没有拼坏、
 * CSS 里每个档位 / 尺寸的规则在不在。画面好不好看，用 `node scripts/e2e.mjs ui --only ach,win` 截图看。
 */

test('档位：奖励 ≤40 铜、≤100 银、≤250 金，其余等离子（边界值落在较低一档）', () => {
  const cases: [number, string][] = [
    [0, 'bronze'],
    [20, 'bronze'],
    [40, 'bronze'],
    [41, 'silver'],
    [100, 'silver'],
    [101, 'gold'],
    [250, 'gold'],
    [251, 'plasma'],
    [1000, 'plasma'],
  ]
  for (const [reward, tier] of cases) assert.equal(medalTier(reward), tier, `reward=${reward}`)
  assert.deepEqual([...MEDAL_TIERS], ['bronze', 'silver', 'gold', 'plasma'])
})

test('徽记：每个成就指标都有徽记，徽记在 UI 图标库里，且不同指标不共用同一个徽记', () => {
  const metrics = new Set(ACHIEVEMENTS.map((a) => a.metric))
  for (const m of metrics) {
    const emblem = MEDAL_EMBLEM[m]
    assert.ok(emblem, `指标 ${m} 没有徽记`)
    assert.ok(emblem in UI_ICON, `指标 ${m} 的徽记 ${emblem} 不在 UI_ICON 里`)
  }
  const emblems = Object.values(MEDAL_EMBLEM)
  assert.equal(new Set(emblems).size, emblems.length, '有两个指标共用了同一个徽记，玩家分不出来')
  for (const e of emblems) assert.ok(e in UI_ICON, `${e} 不在 UI_ICON 里`)
})

test('档位分布：四个档位都有成就，等离子只留给最难的少数（不超过四分之一）', () => {
  const by: Record<string, number> = { bronze: 0, silver: 0, gold: 0, plasma: 0 }
  for (const a of ACHIEVEMENTS) by[medalTier(a.reward)]++
  for (const tier of MEDAL_TIERS) assert.ok(by[tier] > 0, `${tier} 档一个成就都没有`)
  assert.ok(by.plasma <= ACHIEVEMENTS.length / 4, `等离子档 ${by.plasma}/${ACHIEVEMENTS.length}，太多了就不稀罕了`)
})

test('勋章 SVG：结构完整、数字有限、徽记画两遍（投影 + 本体）、点数与档位一致', () => {
  for (const emblem of new Set(Object.values(MEDAL_EMBLEM))) {
    for (let pips = 0; pips <= 4; pips++) {
      const svg = medalSvg(emblem, pips)
      const where = `${emblem}/pips=${pips}`
      assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'), `${where}: 不是完整的 svg`)
      assert.ok(svg.includes('viewBox="0 0 64 74"'), `${where}: viewBox 不对`)
      assert.ok(!/NaN|undefined|Infinity/.test(svg), `${where}: 含非法数字`)
      assert.equal((svg.match(/<g[ >]/g) ?? []).length, (svg.match(/<\/g>/g) ?? []).length, `${where}: <g> 不配对`)
      assert.equal((svg.match(/class="mf-pip"/g) ?? []).length, pips, `${where}: 点数不对`)
      for (const cls of ['mf-ink', 'mf-metal', 'mf-lip', 'mf-face', 'mf-sh']) assert.equal((svg.match(new RegExp(`class="${cls}"`, 'g')) ?? []).length, 1, `${where}: ${cls} 应出现一次`)
      assert.equal(svg.split(UI_ICON[emblem]).length - 1, 2, `${where}: 徽记应该画两遍（一遍压暗的投影、一遍本体）`)
      // 没有发光：整个勋章不允许出现 blur / filter / 渐变
      assert.ok(!/filter|blur|gradient/i.test(svg), `${where}: 勋章不该有发光 / 渐变`)
    }
  }
})

test('勋章配色钩子：四个档位 + 战败色 + 小 / 大尺寸（md 是默认）+ 未获得态，CSS 里都有规则', () => {
  const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
  for (const tier of [...MEDAL_TIERS, 'danger']) assert.ok(css.includes(`.tier-${tier}`), `CSS 里没有 .tier-${tier}`)
  for (const size of ['sm', 'lg']) assert.ok(new RegExp(`\\.medal\\.${size}\\b`).test(css), `CSS 里没有 .medal.${size}`)
  assert.ok(/\.medal\.lock\b/.test(css), 'CSS 里没有 .medal.lock（未获得态）')
  for (const v of ['--tc', '--m', '--f', '--g']) assert.ok(css.includes(v), `CSS 里没有 ${v}`)
})
