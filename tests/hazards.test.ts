import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HAZARD_COLOR } from '../src/data/hazards'
import { BEAM_STYLES, BOSS_IDS, EBULLET_KINDS, HAZARD_IDS, WEAPON_MAX_LEVEL, type BossId, type EBulletKind, type WeaponId } from '../src/data/ids'
import { tIn } from '../src/i18n'
import { spawnBoss } from '../src/game/bosses'
import { WeaponInst, type Enemy, type InputState } from '../src/game/entities'
import { World } from '../src/game/world'
import { paintBeam, paintBolt, paintRing } from '../src/render/beams'
import { EBULLET_BOX, EBULLET_PAINT } from '../src/render/bullets'

const input: InputState = { mx: 0, my: 0, dash: false }
const DT = 1 / 60

// ───────────────────────── 假 2D 上下文 ─────────────────────────

interface Rec {
  ctx: CanvasRenderingContext2D
  state: Record<string, unknown>
  calls: string[]
  /** 路径 / 矩形 / 圆弧 / 椭圆用到的所有坐标点（含贝塞尔控制点），带上线宽余量 */
  pts: { x: number; y: number; pad: number }[]
  /** 非有限数（NaN / ±Infinity）进入了哪个调用 */
  bad: string[]
  saves: number
  restores: number
  blurs: number[]
  dashes: number[][]
}

/** 记录所有调用的假 ctx：只关心"画了什么、有没有传坏数、状态有没有配平" */
function recorder(): Rec {
  const state: Record<string, unknown> = {}
  const rec: Rec = { ctx: null as unknown as CanvasRenderingContext2D, state, calls: [], pts: [], bad: [], saves: 0, restores: 0, blurs: [], dashes: [] }
  const grad = { addColorStop: (o: number) => void (Number.isFinite(o) || rec.bad.push(`addColorStop:${o}`)) }
  const num = (k: string, a: unknown[]): void => {
    for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) rec.bad.push(`${k}:${v}`)
  }
  const pad = (): number => Number(state.lineWidth ?? 1) / 2
  const pt = (x: number, y: number): void => void rec.pts.push({ x, y, pad: pad() })
  rec.ctx = new Proxy(state, {
    get(o, k: string) {
      if (k in o) return o[k]
      switch (k) {
        case 'createLinearGradient':
        case 'createRadialGradient':
          return (...a: number[]) => {
            num(k, a)
            return grad
          }
        case 'save':
          return () => void rec.saves++
        case 'restore':
          return () => void rec.restores++
        case 'setLineDash':
          return (d: number[]) => void rec.dashes.push([...d])
        case 'moveTo':
        case 'lineTo':
          return (x: number, y: number) => {
            num(k, [x, y])
            pt(x, y)
          }
        case 'quadraticCurveTo':
          return (...a: number[]) => {
            num(k, a)
            pt(a[0], a[1])
            pt(a[2], a[3])
          }
        case 'bezierCurveTo':
          return (...a: number[]) => {
            num(k, a)
            pt(a[0], a[1])
            pt(a[2], a[3])
            pt(a[4], a[5])
          }
        case 'arc':
          return (x: number, y: number, r: number, ...rest: number[]) => {
            num(k, [x, y, r, ...rest])
            pt(x - r, y - r)
            pt(x + r, y + r)
          }
        case 'ellipse':
          return (x: number, y: number, rx: number, ry: number, ...rest: number[]) => {
            num(k, [x, y, rx, ry, ...rest])
            pt(x - rx, y - ry)
            pt(x + rx, y + ry)
          }
        case 'rect':
        case 'fillRect':
        case 'strokeRect':
        case 'roundRect':
          return (x: number, y: number, w: number, h: number, ...rest: unknown[]) => {
            num(k, [x, y, w, h])
            if (k === 'rect' || k === 'roundRect') rec.calls.push(k)
            pt(x, y)
            pt(x + w, y + h)
            void rest
          }
        default:
          return (...a: unknown[]) => {
            rec.calls.push(k)
            num(k, a)
          }
      }
    },
    set(o, k: string, v) {
      o[k] = v
      if (k === 'shadowBlur') rec.blurs.push(Number(v))
      if (typeof v === 'number' && !Number.isFinite(v)) rec.bad.push(`set ${k}:${v}`)
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return rec
}

/** 画完之后的通用卫生检查：不传坏数、save/restore 配平、没有 shadowBlur、虚线复位 */
function assertClean(r: Rec, tag: string): void {
  assert.deepEqual(r.bad, [], `${tag}：有非有限数进入了 canvas 调用`)
  assert.equal(r.saves, r.restores, `${tag}：save / restore 不配平（${r.saves} vs ${r.restores}），会把状态漏给后面的绘制`)
  assert.ok(
    r.blurs.every((b) => b === 0),
    `${tag}：运行时绘制不允许用 shadowBlur（手机上极慢）`,
  )
  if (r.dashes.length > 0) assert.deepEqual(r.dashes[r.dashes.length - 1], [], `${tag}：虚线没有复位`)
}

// ───────────────────────── 敌方子弹造型 ─────────────────────────

test('敌方子弹：除了通用光球 orb，每种造型都有专属画法，且没有闲置的画法', () => {
  for (const k of EBULLET_KINDS) {
    if (k === 'orb') assert.equal(EBULLET_PAINT[k], undefined, 'orb 走通用光球，不该再有专属画法')
    else assert.equal(typeof EBULLET_PAINT[k], 'function', `子弹造型 ${k} 缺少画法`)
  }
  for (const k of Object.keys(EBULLET_PAINT)) assert.ok((EBULLET_KINDS as readonly string[]).includes(k), `画法 ${k} 不在 EBULLET_KINDS 里`)
})

test('敌方子弹画法：干净（无 NaN / 无 shadowBlur / 状态配平）、画得出东西、且不超出精灵画布', () => {
  const colors = ['#ff3ea5', '#ffd84a', '#9dff4d', '#c9a0ff', '#ff6a8a', '#ffffff', '#101010']
  const hw = EBULLET_BOX.w / 2
  const hh = EBULLET_BOX.h / 2
  for (const k of EBULLET_KINDS) {
    const paint = EBULLET_PAINT[k]
    if (!paint) continue
    for (const c of colors) {
      const r = recorder()
      paint(r.ctx, c)
      assertClean(r, `${k}@${c}`)
      assert.ok(r.pts.length >= 6, `${k}@${c}：几乎什么都没画`)
      for (const p of r.pts) {
        assert.ok(Math.abs(p.x) <= hw + 0.5 && Math.abs(p.y) <= hh + 0.5, `${k}@${c}：(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) 超出精灵画布 ±${hw}×±${hh}，会被裁掉`)
      }
    }
  }
})

test('敌方子弹画法：碰撞点（原点）落在造型里——画出来的东西盖得住判定圆心', () => {
  for (const k of EBULLET_KINDS) {
    const paint = EBULLET_PAINT[k]
    if (!paint) continue
    const r = recorder()
    paint(r.ctx, '#ff3ea5')
    const xs = r.pts.map((p) => p.x)
    const ys = r.pts.map((p) => p.y)
    assert.ok(Math.min(...xs) < -2 && Math.max(...xs) > 2, `${k}：横向没有围住原点`)
    assert.ok(Math.min(...ys) < -1 && Math.max(...ys) > 1, `${k}：纵向没有围住原点`)
  }
})

// ───────────────────────── 光束 / 电弧 / 冲击环 ─────────────────────────

test('光束画法：每种样式在各种长度 / 宽度 / 强度 / 寿命 / 时钟下都干净，且确实画了东西', () => {
  const colors = ['#c9a0ff', '#ffe8a8', '#ff4d6d', '#9dff4d', '#ffffff']
  for (const style of BEAM_STYLES) {
    for (const color of colors) {
      for (const len of [40, 300, 1900]) {
        for (const width of [0, 5, 17, 60]) {
          for (const env of [0, 0.4, 1]) {
            for (const life of [0, 0.5, 1]) {
              const r = recorder()
              paintBeam(r.ctx, style, len, color, { env, width, life, vt: len * 0.013 + width })
              assertClean(r, `${style} ${color} len=${len} w=${width} env=${env} life=${life}`)
            }
          }
        }
      }
    }
    const r = recorder()
    paintBeam(r.ctx, style, 300, '#c9a0ff', { env: 1, width: 20, life: 0.7, vt: 1.3 })
    assert.ok(r.pts.length > 8, `${style}：满强度时应该画出有层次的结构`)
  }
})

test('光束画法：满强度下 4 种样式的画法互不相同（不会又退回成同一根光柱）', () => {
  const sig = new Set<string>()
  for (const style of BEAM_STYLES) {
    const r = recorder()
    paintBeam(r.ctx, style, 300, '#c9a0ff', { env: 1, width: 20, life: 0.7, vt: 1.3 })
    sig.add(`${r.pts.length}|${r.calls.join(',')}`)
  }
  assert.equal(sig.size, BEAM_STYLES.length)
})

test('电弧画法：任意折线都干净；折线只有一个点或为空时不画也不抛错', () => {
  const r = recorder()
  paintBolt(r.ctx, [0, 0, 80, -20, 150, 30, 240, 5, 300, 60], '#ffe66b', 0.9)
  assertClean(r, 'bolt')
  assert.ok(r.pts.length > 10)
  for (const pts of [[], [10, 10], [10, 10, 10, 10]]) {
    for (const f of [0, 0.5, 1]) {
      const q = recorder()
      assert.doesNotThrow(() => paintBolt(q.ctx, pts, '#ffffff', f))
      assertClean(q, `bolt ${pts.length} f=${f}`)
    }
  }
})

test('冲击环画法：友方 / 敌方、小环到大环、寿命首尾都干净，敌方多出一圈尖齿', () => {
  for (const hostile of [false, true]) {
    for (const [rad, maxR] of [
      [0, 300],
      [8, 300],
      [105, 290],
      [290, 290],
      [640, 640],
      [30, 0],
    ]) {
      const r = recorder()
      paintRing(r.ctx, 12, -7, rad, maxR, '#c9a0ff', hostile, rad * 0.7)
      assertClean(r, `ring r=${rad}/${maxR} hostile=${hostile}`)
    }
  }
  const friendly = recorder()
  const enemy = recorder()
  paintRing(friendly.ctx, 0, 0, 200, 600, '#e8fbff', false, 1)
  paintRing(enemy.ctx, 0, 0, 200, 600, '#e8fbff', true, 1)
  assert.ok(enemy.pts.length > friendly.pts.length + 40, '敌方的环应当比友方多一圈朝外的尖齿')
})

// ───────────────────────── 玩法侧：每种造型确实被用上了 ─────────────────────────

/** 一座只有 Boss 的竞技场：玩家锁血、不自然刷怪，把 Boss 摆到指定阶段，然后观察它放出了什么 */
function arena(boss: BossId, phase: 0 | 1 | 2, seconds: number) {
  const w = new World({ seed: 5, ship: 'vanguard', sector: 'fields', threat: 0, meta: {} })
  ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
  const p = w.player
  p.xpNext = 1e12
  p.weapons.length = 0
  w.recalc()
  spawnBoss(w, boss)
  const b = w.boss!
  b.phase = phase
  b.hp = b.maxHp * [1, 0.5, 0.2][phase]
  b.intro = 0
  const kinds = new Set<EBulletKind>()
  const styles = new Set<string>()
  let rings = 0
  for (let t = 0; t < seconds; t += DT) {
    p.hp = p.maxHp
    w.update(DT, input)
    for (const e of w.ebullets) if (e.alive) kinds.add(e.kind)
    for (const bm of w.beams) if (bm.alive) styles.add(`${bm.hostile ? 'hostile' : 'friendly'}:${bm.style}`)
    for (const rg of w.rings) if (rg.alive && rg.hostile) rings++
  }
  return { kinds, styles, rings }
}

test('监察者：圆睛弹（lens）放环形弹幕，二阶段起再加瞄准的飞镖（needle）', () => {
  const a = arena('overseer', 0, 12)
  assert.ok(a.kinds.has('lens'), '一阶段应放出圆睛弹')
  assert.ok(!a.kinds.has('needle'), '一阶段没有瞄准弹')
  for (const ph of [1, 2] as const) {
    const b = arena('overseer', ph, 12)
    assert.ok(b.kinds.has('lens') && b.kinds.has('needle'), `阶段 ${ph + 1}：应有圆睛弹和飞镖，实际 ${[...b.kinds]}`)
  }
})

test('分形核心：晶刺（shard）放射、飞镖（needle）瞄准；二阶段起落下带警示纹的射线（boss 样式）', () => {
  const a = arena('fractal', 0, 12)
  assert.ok(a.kinds.has('shard') && a.kinds.has('needle'), `一阶段应有晶刺和飞镖，实际 ${[...a.kinds]}`)
  assert.ok(![...a.styles].some((s) => s.startsWith('hostile')), '一阶段没有射线')
  const b = arena('fractal', 1, 16)
  assert.ok(b.styles.has('hostile:boss'), `二阶段应落下 boss 样式的射线，实际 ${[...b.styles]}`)
})

test('虚空之喉：獠牙（fang）螺旋弹幕 + 敌方冲击环', () => {
  const a = arena('maw', 0, 8)
  assert.ok(a.kinds.has('fang'), `应有獠牙，实际 ${[...a.kinds]}`)
  assert.ok(a.rings > 0, '应放出敌方冲击环')
})

test('熔炉巨像：熔渣块（ember）放射弹幕、震地冲击环；二阶段起熔切射线是 boss 样式', () => {
  const a = arena('forge', 0, 14)
  assert.ok(a.kinds.has('ember'), `应有熔渣块，实际 ${[...a.kinds]}`)
  assert.ok(a.rings > 0, '震地应放出敌方冲击环')
  assert.ok(![...a.styles].some((s) => s.startsWith('hostile')), '一阶段没有射线')
  const b = arena('forge', 1, 22)
  assert.ok(b.styles.has('hostile:boss'), `二阶段应有 boss 样式的熔切射线，实际 ${[...b.styles]}`)
})

test('所有 Boss 放出的子弹造型都登记在 EBULLET_KINDS 里；敌方光束一律是 boss 样式', () => {
  for (const id of BOSS_IDS) {
    for (const ph of [0, 1, 2] as const) {
      const a = arena(id, ph, 10)
      for (const k of a.kinds) assert.ok((EBULLET_KINDS as readonly string[]).includes(k), `${id}/${ph}：未登记的造型 ${k}`)
      for (const s of a.styles) if (s.startsWith('hostile')) assert.equal(s, 'hostile:boss')
    }
  }
})

test('炮手：吐出的是黄色酸液弹（glob）；精英一口三颗', () => {
  for (const elite of [false, true]) {
    const w = new World({ seed: 9, ship: 'vanguard', sector: 'fields', threat: 0, meta: {} })
    ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
    const p = w.player
    p.xpNext = 1e12
    p.invuln = 1e9
    p.weapons.length = 0
    w.recalc()
    const e: Enemy = w.spawnEnemy('shooter', p.x + 300, p.y, { spawnT: 0, hpMul: 1000, elite })
    e.timer = 0.05
    let most = 0
    const kinds = new Set<string>()
    for (let i = 0; i < 90; i++) {
      w.update(DT, input)
      const live = w.ebullets.filter((b) => b.alive)
      most = Math.max(most, live.length)
      for (const b of live) kinds.add(`${b.kind}${b.color}`)
    }
    assert.deepEqual([...kinds], ['glob#ffd84a'], `${elite ? '精英' : '普通'}炮手的子弹造型 / 颜色不对`)
    assert.equal(most, elite ? 3 : 1, `${elite ? '精英' : '普通'}炮手一口应吐出 ${elite ? 3 : 1} 颗`)
  }
})

test('武器光束的样式：棱镜激光 = laser，磁轨炮 = rail，进化磁轨的灼痕 = scar（只影响外观，不影响判定）', () => {
  const styleOf = (id: WeaponId, evolved: boolean): Set<string> => {
    const w = new World({ seed: 3, ship: 'vanguard', sector: 'fields', threat: 0, meta: {} })
    ;(w as unknown as { director: { update: () => void } }).director.update = () => {}
    const p = w.player
    p.xpNext = 1e12
    p.invuln = 1e9
    p.weapons.length = 0
    const wi = new WeaponInst(id, 0)
    wi.level = WEAPON_MAX_LEVEL
    wi.evolved = evolved
    p.weapons.push(wi)
    w.recalc()
    const e = w.spawnEnemy('brute', p.x + 250, p.y, { spawnT: 0, hpMul: 1000 })
    e.speed = 0
    const seen = new Set<string>()
    for (let i = 0; i < 60 * 3; i++) {
      e.x = p.x + 250
      e.y = p.y
      e.kx = e.ky = 0
      w.update(DT, input)
      for (const b of w.beams) if (b.alive) seen.add(b.style)
    }
    return seen
  }
  assert.deepEqual([...styleOf('laser', false)], ['laser'])
  assert.deepEqual([...styleOf('rail', false)], ['rail'])
  const evolved = styleOf('rail', true)
  assert.ok(evolved.has('rail') && evolved.has('scar'), `进化磁轨应同时有光轨和灼痕，实际 ${[...evolved]}`)
})

// ───────────────────────── 指南页数据 ─────────────────────────

test('指南「弹幕与危险」：每个条目都有识别色（互不相同）和中英文名称', () => {
  const hex = /^#[0-9a-f]{6}$/i
  for (const id of HAZARD_IDS) {
    assert.match(HAZARD_COLOR[id], hex, `${id} 缺少合法的识别色`)
    for (const lang of ['zh', 'en'] as const) assert.ok(tIn(lang, `hazard.${id}`) && tIn(lang, `hazard.${id}`) !== `hazard.${id}`, `${lang} 缺少 hazard.${id} 的名称`)
  }
  // 五种子弹造型都要在指南里出现（orb 是后备造型，游戏里没有人发射它）
  for (const k of EBULLET_KINDS) if (k !== 'orb') assert.ok((HAZARD_IDS as readonly string[]).includes(k), `子弹造型 ${k} 没有收录进指南`)
})
