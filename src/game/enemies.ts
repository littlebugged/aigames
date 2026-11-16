import type { Enemy } from './entities'
import type { World } from './world'

/** 冲锋者的蓄力时间 / 冲刺时间 */
export const CHARGER_WINDUP = 0.7
const CHARGER_DASH = 0.55
const BOMBER_FUSE = 0.8
const BOMBER_RADIUS = 84

/**
 * 敌人 AI 与移动。每个敌人只决定"想往哪走/做什么"，最终位移 = 意图速度 + 击退速度。
 * 渲染相关的状态（蓄力光、引信闪烁）通过 e.state / e.aux 暴露给渲染层。
 */
export function updateEnemies(w: World, dt: number): void {
  const p = w.player
  const E = w.enemies
  const grid = w.grid
  const sep = w.tmp
  const recycleD2 = (w.viewR * 2.4) ** 2
  const kd = Math.exp(-7 * dt)
  const tick = w.tick

  for (let i = 0; i < E.length; i++) {
    const e = E[i]
    if (!e.alive) continue
    e.age += dt
    if (e.flash > 0) e.flash -= dt
    if (e.contactCd > 0) e.contactCd -= dt
    if (e.shielded > 0) e.shielded -= dt
    if (e.spawnT > 0) {
      e.spawnT -= dt
      continue
    }

    let dx = p.x - e.x
    let dy = p.y - e.y
    let d = Math.hypot(dx, dy)
    if (d < 0.001) d = 0.001
    const nx = dx / d
    const ny = dy / d

    let svx = 0
    let svy = 0
    const slowMul = e.slow > 0 ? 0.55 : 1
    if (e.slow > 0) e.slow -= dt
    const sp = e.speed * slowMul
    let canHurt = true

    if (e.stun > 0) {
      e.stun -= dt
    } else {
      switch (e.def.ai) {
        case 'chase':
        case 'splitter': {
          const wob = Math.sin(e.age * 2.5 + e.id) * 0.22
          svx = (nx - ny * wob) * sp
          svy = (ny + nx * wob) * sp
          break
        }
        case 'swarm': {
          const wob = Math.sin(e.age * 5 + e.id * 1.3) * 0.6
          svx = (nx - ny * wob) * sp
          svy = (ny + nx * wob) * sp
          break
        }
        case 'brute':
          svx = nx * sp
          svy = ny * sp
          break

        case 'shooter': {
          const dir = e.id % 2 === 0 ? 1 : -1
          if (d > 310) {
            svx = nx * sp
            svy = ny * sp
          } else if (d < 215) {
            svx = -nx * sp * 0.85
            svy = -ny * sp * 0.85
          } else {
            svx = -ny * dir * sp * 0.7
            svy = nx * dir * sp * 0.7
          }
          e.timer -= dt
          e.aux = e.timer < 0.45 ? 1 : 0
          if (e.timer <= 0) {
            if (d < 560) {
              const a = Math.atan2(dy, dx)
              const n = e.elite ? 3 : 1
              for (let k = 0; k < n; k++) {
                w.spawnEnemyBullet(e.x, e.y, a + (k - (n - 1) / 2) * 0.24, 205, e.dmg * 1.5, {
                  color: '#ffd84a',
                  kind: 'glob',
                })
              }
            }
            e.timer = (e.elite ? 1.9 : 2.7) + w.rng.next() * 0.9
          }
          break
        }

        case 'charger': {
          if (e.state === 0) {
            if (d > 250) {
              svx = nx * sp
              svy = ny * sp
            } else {
              svx = -ny * sp * 0.5
              svy = nx * sp * 0.5
            }
            e.timer -= dt
            if (e.timer <= 0 && d < 420) {
              e.state = 1
              e.timer = CHARGER_WINDUP
            }
          } else if (e.state === 1) {
            // 蓄力：跟踪玩家，冲刺前 0.2s 锁定方向
            if (e.timer > 0.2) {
              e.ax = nx
              e.ay = ny
            }
            e.timer -= dt
            if (e.timer <= 0) {
              e.state = 2
              e.timer = CHARGER_DASH
            }
          } else if (e.state === 2) {
            svx = e.ax * sp * 5.4
            svy = e.ay * sp * 5.4
            e.timer -= dt
            if (e.timer <= 0) {
              e.state = 3
              e.timer = 0.9
            }
          } else {
            e.timer -= dt
            if (e.timer <= 0) {
              e.state = 0
              e.timer = 1.1 + w.rng.next() * 1.2
            }
          }
          break
        }

        case 'bomber': {
          if (e.state === 0) {
            svx = nx * sp
            svy = ny * sp
            if (d < 80) {
              e.state = 1
              e.timer = BOMBER_FUSE
            }
          } else {
            e.timer -= dt
            e.aux = 1 - Math.max(0, e.timer) / BOMBER_FUSE
            svx = nx * sp * 0.15
            svy = ny * sp * 0.15
            if (e.timer <= 0) {
              detonateBomber(w, e)
              continue
            }
          }
          canHurt = e.state === 0
          break
        }

        case 'shielder': {
          if (d > 100) {
            svx = nx * sp
            svy = ny * sp
          }
          if ((tick + e.id) % 3 === 0) {
            const aura = w.tmpW
            aura.length = 0
            grid.query(e.x, e.y, 130, aura)
            for (let k = 0; k < aura.length; k++) if (aura[k] !== e) aura[k].shielded = 0.45
          }
          break
        }

        case 'wraith': {
          if (e.state === 0) {
            const wob = Math.sin(e.age * 3 + e.id) * 0.35
            svx = (nx - ny * wob) * sp
            svy = (ny + nx * wob) * sp
            e.timer -= dt
            if (e.timer <= 0 && d > 140) {
              e.state = 1
              e.timer = 0.45
            }
          } else if (e.state === 1) {
            e.timer -= dt
            e.aux = Math.max(0, e.timer) / 0.45
            canHurt = false
            if (e.timer <= 0) {
              const a = w.rng.angle()
              const r = 150 + w.rng.next() * 90
              e.x = p.x + Math.cos(a) * r
              e.y = p.y + Math.sin(a) * r
              e.state = 2
              e.timer = 0.3
              dx = p.x - e.x
              dy = p.y - e.y
            }
          } else {
            e.timer -= dt
            e.aux = 1 - Math.max(0, e.timer) / 0.3
            canHurt = false
            if (e.timer <= 0) {
              e.state = 0
              e.timer = 3 + w.rng.next() * 2
              e.aux = 0
            }
          }
          break
        }
      }
    }

    if (e.def.ai === 'charger' && (e.state === 1 || e.state === 2)) {
      e.angle = Math.atan2(e.ay, e.ax)
    } else if (svx !== 0 || svy !== 0) {
      e.angle = Math.atan2(svy, svx)
    } else if (e.def.ai === 'shooter' || e.def.ai === 'shielder') {
      e.angle = Math.atan2(ny, nx)
    }

    e.kx *= kd
    e.ky *= kd
    e.vx = svx + e.kx
    e.vy = svy + e.ky
    e.x += e.vx * dt
    e.y += e.vy * dt

    // 软碰撞：相互挤开，避免叠成一坨（每帧只处理一半）
    if (((e.id + tick) & 1) === 0 && e.state !== 2) {
      sep.length = 0
      grid.query(e.x, e.y, e.r, sep)
      for (let k = 0; k < sep.length; k++) {
        const o = sep[k]
        if (o === e || !o.alive) continue
        const ox = e.x - o.x
        const oy = e.y - o.y
        const d2 = ox * ox + oy * oy
        const rr = (e.r + o.r) * 0.85
        if (d2 < rr * rr && d2 > 0.0001) {
          const dd = Math.sqrt(d2)
          const push = (rr - dd) * 0.4
          e.x += (ox / dd) * push
          e.y += (oy / dd) * push
        }
      }
    }

    // 接触伤害
    if (canHurt && e.contactCd <= 0) {
      const rr = e.r + p.r
      const ex = p.x - e.x
      const ey = p.y - e.y
      if (ex * ex + ey * ey < rr * rr) {
        const mul = e.def.ai === 'charger' && e.state === 2 ? 1.7 : 1
        if (w.hurtPlayer(e.dmg * mul, e.x, e.y, e.def.id)) {
          e.contactCd = 0.7
          const kn = e.def.knockResist < 0.8 ? 1 : 0.3
          e.kx -= nx * 130 * kn
          e.ky -= ny * 130 * kn
        }
      }
    }

    // 掉队太远的小怪传送回屏幕边缘，保持压力又不浪费算力
    if (!e.elite) {
      const rx = p.x - e.x
      const ry = p.y - e.y
      if (rx * rx + ry * ry > recycleD2) {
        const pt = w.edgePoint()
        e.x = pt.x
        e.y = pt.y
        e.spawnT = 0.2
        e.kx = e.ky = 0
        e.state = 0
        e.timer = 1 + w.rng.next()
      }
    }
  }
}

function detonateBomber(w: World, e: Enemy): void {
  const p = w.player
  e.alive = false
  w.addBlast(e.x, e.y, BOMBER_RADIUS, '#ff2fd6', 0.38)
  w.emit({ t: 'blast', x: e.x, y: e.y, r: BOMBER_RADIUS, color: '#ff2fd6' })
  if (Math.hypot(p.x - e.x, p.y - e.y) < BOMBER_RADIUS + p.r) w.hurtPlayer(e.dmg * 2, e.x, e.y, 'bomber')
  w.addGem(e.x, e.y, e.xp)
  // 自爆的炸弹人也会把附近的敌人炸伤，鼓励玩家引导爆炸
  const out = w.tmpW
  out.length = 0
  w.grid.query(e.x, e.y, BOMBER_RADIUS, out)
  for (let i = 0; i < out.length; i++) {
    const o = out[i]
    if (o !== e && o.alive) w.damageEnemy(o, 14, 0, 0, { noCrit: true })
  }
}