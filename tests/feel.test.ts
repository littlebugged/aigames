import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DMG_TIERS,
  EVOLVE_CHARGE,
  EVOLVE_FLOOR,
  EVOLVE_HOLD,
  EVOLVE_TOTAL,
  TOP_TIER,
  budgetClass,
  dmgTier,
  evolveTimeScale,
  fmtDmg,
} from '../src/engine/feel'

test('伤害分级表：阈值严格递增，字号/停留/弹出倍率逐档变大', () => {
  assert.equal(DMG_TIERS[0].min, 0)
  assert.ok(DMG_TIERS.length >= 8, '用户要求更多档位，至少 8 档')
  for (let i = 1; i < DMG_TIERS.length; i++) {
    const a = DMG_TIERS[i - 1]
    const b = DMG_TIERS[i]
    assert.ok(b.min > a.min, `T${i} 阈值必须大于 T${i - 1}`)
    assert.ok(b.size > a.size, `T${i} 字号必须大于 T${i - 1}`)
    assert.ok(b.life >= a.life, `T${i} 停留时间不能比 T${i - 1} 短`)
    assert.ok(b.pop >= a.pop, `T${i} 弹出倍率不能比 T${i - 1} 小`)
  }
  const colors = new Set(DMG_TIERS.map((t) => t.color))
  assert.equal(colors.size, DMG_TIERS.length, '每一档的颜色都必须不同，否则看不出梯度')
})

test('dmgTier：随伤害单调不降，落在每档边界上', () => {
  let prev = 0
  for (let d = 0; d <= 3000; d += 0.5) {
    const t = dmgTier(d, false)
    assert.ok(t >= prev, `伤害 ${d} 的档位不能比更小的伤害低`)
    prev = t
  }
  for (let i = 0; i < DMG_TIERS.length; i++) {
    assert.equal(dmgTier(DMG_TIERS[i].min, false), i, `刚好等于 T${i} 下限应归入 T${i}`)
    if (i > 0) assert.equal(dmgTier(DMG_TIERS[i].min - 0.01, false), i - 1, `略小于 T${i} 下限应归入 T${i - 1}`)
  }
  assert.equal(dmgTier(1e9, false), TOP_TIER)
  assert.equal(dmgTier(0, false), 0)
})

test('dmgTier：暴击上浮一档（至少第 2 档），封顶不越界', () => {
  assert.equal(dmgTier(5, true), 2, '极小暴击也要有醒目的样式')
  for (let i = 0; i < TOP_TIER; i++) {
    const d = DMG_TIERS[i].min
    assert.ok(dmgTier(d, true) >= dmgTier(d, false), '暴击不会比普通命中更低')
    assert.equal(dmgTier(d, true), Math.max(2, i + 1))
  }
  assert.equal(dmgTier(1e9, true), TOP_TIER)
})

test('fmtDmg：取整与千位缩写，边界不出现 4 位数', () => {
  assert.equal(fmtDmg(0.4), '0')
  assert.equal(fmtDmg(13.6), '14')
  assert.equal(fmtDmg(999.4), '999')
  assert.equal(fmtDmg(999.6), '1.0k')
  assert.equal(fmtDmg(1234), '1.2k')
  assert.equal(fmtDmg(9949), '9.9k')
  assert.equal(fmtDmg(9999), '10k')
  assert.equal(fmtDmg(24600), '25k')
})

test('budgetClass：小数字 / 中等 / 重击 三个限流桶', () => {
  const seen = DMG_TIERS.map((_, i) => budgetClass(i))
  assert.deepEqual([...new Set(seen)].sort(), [0, 1, 2])
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], '桶编号随档位单调不降')
  assert.equal(budgetClass(0), 0)
  assert.equal(budgetClass(TOP_TIER), 2)
})

test('进化时间流速：蓄力渐慢 → 爆发定格 → 渐渐恢复，始终在 (0,1]', () => {
  assert.equal(evolveTimeScale(-1), 1)
  assert.equal(evolveTimeScale(0), 1)
  assert.equal(evolveTimeScale(EVOLVE_TOTAL), 1)
  assert.equal(evolveTimeScale(99), 1)
  let min = 1
  for (let t = 0; t <= EVOLVE_TOTAL + 0.5; t += 0.005) {
    const s = evolveTimeScale(t)
    assert.ok(s > 0 && s <= 1, `t=${t.toFixed(3)} 流速 ${s} 越界`)
    min = Math.min(min, s)
  }
  assert.equal(min, EVOLVE_FLOOR, '定格时的最低流速')
  // 蓄力段单调不升
  let prev = 1
  for (let t = 0; t < EVOLVE_CHARGE; t += 0.004) {
    const s = evolveTimeScale(t)
    assert.ok(s <= prev + 1e-9, '蓄力阶段流速只降不升')
    prev = s
  }
  assert.ok(prev < 0.6, '蓄力结束时应已明显变慢')
  // 爆发：瞬间砸到定格并保持
  assert.equal(evolveTimeScale(EVOLVE_CHARGE + 0.001), EVOLVE_FLOOR)
  assert.equal(evolveTimeScale(EVOLVE_CHARGE + EVOLVE_HOLD - 0.001), EVOLVE_FLOOR)
  // 恢复段单调不降，最终回到 1
  let up = EVOLVE_FLOOR
  for (let t = EVOLVE_CHARGE + EVOLVE_HOLD; t < EVOLVE_TOTAL; t += 0.004) {
    const s = evolveTimeScale(t)
    assert.ok(s >= up - 1e-9, '恢复阶段流速只升不降')
    up = s
  }
  assert.ok(up > 0.97, '演出结束前应几乎恢复正常')
})

test('进化演出的总时长克制：真实时间不超过 2 秒', () => {
  assert.ok(EVOLVE_TOTAL <= 2)
  // 演出期间"游戏内流逝的时间"要明显少于真实时间（有慢动作的感觉），但不能卡死
  let game = 0
  for (let t = 0; t < EVOLVE_TOTAL; t += 0.001) game += evolveTimeScale(t) * 0.001
  assert.ok(game < EVOLVE_TOTAL * 0.65, `慢动作不够明显：游戏内 ${game.toFixed(2)}s / 真实 ${EVOLVE_TOTAL.toFixed(2)}s`)
  assert.ok(game > EVOLVE_TOTAL * 0.25, '也不能慢到近乎暂停')
})
