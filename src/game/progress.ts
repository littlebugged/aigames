import { ACHIEVEMENTS, type AchDef, type AchMetric } from '../data/achievements'
import { META_IDS, SECTOR_IDS, SHIP_IDS, type MetaId, type SectorId, type ShipId } from '../data/ids'
import { METAS, metaCost } from '../data/meta'
import { SECTORS, THREAT_LEVELS } from '../data/sectors'
import { SHIPS } from '../data/ships'
import type { MetaRanks } from './stats'
import type { RunStats } from './world'

/**
 * 进度与存档（纯逻辑，不碰 DOM / localStorage）。
 * 读写存储交给 app/storage.ts；这里只负责"数据长什么样、怎么结算、怎么消毒"，
 * 这样所有规则都能在 Node 里直接测试。
 */

export type Lang = 'zh' | 'en'
export type QualityPref = 'auto' | 'high' | 'medium' | 'low'

export interface Settings {
  lang: Lang
  master: number
  music: number
  sfx: number
  quality: QualityPref
  shake: boolean
  dmgNumbers: boolean
  reduceFlash: boolean
  leftHanded: boolean
  vibration: boolean
}

export interface BestRun {
  time: number
  kills: number
  level: number
  evolves: number
  weapons: number
  noHit: number
  dashes: number
}

export interface Totals {
  runs: number
  wins: number
  deaths: number
  kills: number
  time: number
  evolves: number
  dashes: number
}

export interface SaveData {
  v: 1
  cores: number
  /** 历史累计获得的晶核（成就"财富"用） */
  lifetimeCores: number
  meta: MetaRanks
  ships: ShipId[]
  /** 各星区最佳生存时间（秒） */
  bestTime: Record<SectorId, number>
  /** 各星区无尽模式最佳生存时间（秒） */
  bestEndless: Record<SectorId, number>
  /** 各星区通关次数 */
  clears: Record<SectorId, number>
  /** 各星区已通关的最高威胁等级（-1 = 未通关） */
  maxThreat: Record<SectorId, number>
  best: BestRun
  totals: Totals
  /** 成就 id → 解锁时间戳 */
  ach: Record<string, number>
  last: { ship: ShipId; sector: SectorId; threat: number; endless: boolean }
  tutorialDone: boolean
  settings: Settings
}

const rec = <T>(fill: T): Record<SectorId, T> => ({ fields: fill, wasteland: fill, void: fill })

export function defaultSettings(lang: Lang = 'zh'): Settings {
  return {
    lang,
    master: 0.8,
    music: 0.7,
    sfx: 0.9,
    quality: 'auto',
    shake: true,
    dmgNumbers: true,
    reduceFlash: false,
    leftHanded: false,
    vibration: true,
  }
}

export function defaultSave(lang: Lang = 'zh'): SaveData {
  return {
    v: 1,
    cores: 0,
    lifetimeCores: 0,
    meta: {},
    ships: ['vanguard'],
    bestTime: rec(0),
    bestEndless: rec(0),
    clears: rec(0),
    maxThreat: rec(-1),
    best: { time: 0, kills: 0, level: 0, evolves: 0, weapons: 0, noHit: 0, dashes: 0 },
    totals: { runs: 0, wins: 0, deaths: 0, kills: 0, time: 0, evolves: 0, dashes: 0 },
    ach: {},
    last: { ship: 'vanguard', sector: 'fields', threat: 0, endless: false },
    tutorialDone: false,
    settings: defaultSettings(lang),
  }
}

// ───────────────────────── 消毒：永远不要相信 localStorage ─────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const pickOf = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d

const BIG = 1e9

/** 把任意输入整理成合法的存档；缺失/损坏的字段回退到默认值。 */
export function sanitize(raw: unknown, lang: Lang = 'zh'): SaveData {
  const d = defaultSave(lang)
  if (!isObj(raw)) return d
  const out = defaultSave(lang)

  out.cores = Math.floor(num(raw.cores, 0, BIG, 0))
  out.lifetimeCores = Math.floor(num(raw.lifetimeCores, 0, BIG, out.cores))

  if (isObj(raw.meta)) {
    for (const id of META_IDS) {
      const r = Math.floor(num(raw.meta[id], 0, METAS[id].max, 0))
      if (r > 0) out.meta[id] = r
    }
  }

  const ships = new Set<ShipId>(['vanguard'])
  if (Array.isArray(raw.ships)) for (const s of raw.ships) if ((SHIP_IDS as readonly unknown[]).includes(s)) ships.add(s as ShipId)
  out.ships = SHIP_IDS.filter((s) => ships.has(s))

  for (const sid of SECTOR_IDS) {
    const at = (o: unknown, lo: number, hi: number, def: number): number =>
      isObj(o) ? num(o[sid], lo, hi, def) : def
    out.bestTime[sid] = at(raw.bestTime, 0, 86400, 0)
    out.bestEndless[sid] = at(raw.bestEndless, 0, 86400, 0)
    out.clears[sid] = Math.floor(at(raw.clears, 0, BIG, 0))
    out.maxThreat[sid] = Math.floor(at(raw.maxThreat, -1, THREAT_LEVELS.length - 1, -1))
    // 通关次数与最高威胁自洽
    if (out.clears[sid] > 0 && out.maxThreat[sid] < 0) out.maxThreat[sid] = 0
    if (out.clears[sid] === 0) out.maxThreat[sid] = -1
  }

  if (isObj(raw.best)) {
    const b = raw.best
    out.best = {
      time: num(b.time, 0, 86400, 0),
      kills: Math.floor(num(b.kills, 0, BIG, 0)),
      level: Math.floor(num(b.level, 0, 999, 0)),
      evolves: Math.floor(num(b.evolves, 0, 99, 0)),
      weapons: Math.floor(num(b.weapons, 0, 99, 0)),
      noHit: num(b.noHit, 0, 86400, 0),
      dashes: Math.floor(num(b.dashes, 0, BIG, 0)),
    }
  }
  if (isObj(raw.totals)) {
    const t = raw.totals
    out.totals = {
      runs: Math.floor(num(t.runs, 0, BIG, 0)),
      wins: Math.floor(num(t.wins, 0, BIG, 0)),
      deaths: Math.floor(num(t.deaths, 0, BIG, 0)),
      kills: Math.floor(num(t.kills, 0, BIG, 0)),
      time: num(t.time, 0, BIG, 0),
      evolves: Math.floor(num(t.evolves, 0, BIG, 0)),
      dashes: Math.floor(num(t.dashes, 0, BIG, 0)),
    }
  }

  if (isObj(raw.ach)) {
    const known = new Set(ACHIEVEMENTS.map((a) => a.id))
    for (const [k, v] of Object.entries(raw.ach)) {
      if (known.has(k) && typeof v === 'number' && Number.isFinite(v)) out.ach[k] = v
    }
  }
  // 成就解锁的飞船必须是已拥有
  for (const sid of SHIP_IDS) {
    const a = SHIPS[sid].unlockAch
    if (a && out.ach[a] && !out.ships.includes(sid)) out.ships.push(sid)
  }
  out.ships = SHIP_IDS.filter((s) => out.ships.includes(s))

  if (isObj(raw.last)) {
    const l = raw.last
    out.last = {
      ship: pickOf(l.ship, SHIP_IDS, 'vanguard'),
      sector: pickOf(l.sector, SECTOR_IDS, 'fields'),
      threat: Math.floor(num(l.threat, 0, THREAT_LEVELS.length - 1, 0)),
      endless: bool(l.endless, false),
    }
  }
  if (!out.ships.includes(out.last.ship)) out.last.ship = 'vanguard'
  if (!isSectorUnlocked(out, out.last.sector)) out.last.sector = 'fields'
  out.last.threat = Math.min(out.last.threat, maxSelectableThreat(out, out.last.sector))
  if (out.last.endless && out.clears[out.last.sector] === 0) out.last.endless = false

  out.tutorialDone = bool(raw.tutorialDone, false)

  if (isObj(raw.settings)) {
    const s = raw.settings
    const ds = defaultSettings(lang)
    out.settings = {
      lang: pickOf(s.lang, ['zh', 'en'] as const, ds.lang),
      master: num(s.master, 0, 1, ds.master),
      music: num(s.music, 0, 1, ds.music),
      sfx: num(s.sfx, 0, 1, ds.sfx),
      quality: pickOf(s.quality, ['auto', 'high', 'medium', 'low'] as const, ds.quality),
      shake: bool(s.shake, ds.shake),
      dmgNumbers: bool(s.dmgNumbers, ds.dmgNumbers),
      reduceFlash: bool(s.reduceFlash, ds.reduceFlash),
      leftHanded: bool(s.leftHanded, ds.leftHanded),
      vibration: bool(s.vibration, ds.vibration),
    }
  }
  return out
}

export function parseSave(json: string | null, lang: Lang = 'zh'): SaveData {
  if (!json) return defaultSave(lang)
  try {
    return sanitize(JSON.parse(json), lang)
  } catch {
    return defaultSave(lang)
  }
}

export const serializeSave = (s: SaveData): string => JSON.stringify(s)

// ───────────────────────── 解锁规则 ─────────────────────────

export function isSectorUnlocked(s: SaveData, id: SectorId): boolean {
  const req = SECTORS[id].requires
  return req === null || s.clears[req] > 0
}

export const isShipOwned = (s: SaveData, id: ShipId): boolean => s.ships.includes(id)

/** 该星区当前可选的最高威胁等级：通关了 N 级就能开 N+1 级 */
export function maxSelectableThreat(s: SaveData, id: SectorId): number {
  return Math.min(THREAT_LEVELS.length - 1, s.maxThreat[id] + 1)
}

export const metaRank = (s: SaveData, id: MetaId): number => s.meta[id] ?? 0

export function nextMetaCost(s: SaveData, id: MetaId): number | null {
  const r = metaRank(s, id)
  return r >= METAS[id].max ? null : metaCost(METAS[id], r)
}

export function buyMeta(s: SaveData, id: MetaId): boolean {
  const cost = nextMetaCost(s, id)
  if (cost === null || s.cores < cost) return false
  s.cores -= cost
  s.meta[id] = metaRank(s, id) + 1
  return true
}

/** 全额退还机库升级（让玩家可以随便试配置）。返回退还的晶核数。 */
export function refundMeta(s: SaveData): number {
  let total = 0
  for (const id of META_IDS) {
    for (let r = 0; r < metaRank(s, id); r++) total += metaCost(METAS[id], r)
  }
  s.cores += total
  s.meta = {}
  return total
}

export function buyShip(s: SaveData, id: ShipId): boolean {
  if (isShipOwned(s, id)) return false
  const cost = SHIPS[id].cost
  if (s.cores < cost) return false
  s.cores -= cost
  s.ships.push(id)
  s.ships = SHIP_IDS.filter((x) => s.ships.includes(x))
  return true
}

// ───────────────────────── 结算 ─────────────────────────

export interface RunSummary {
  ship: ShipId
  sector: SectorId
  threat: number
  endless: boolean
  stats: RunStats
  /** 本局拾取的额外晶核（晶核箱、卡片奖励） */
  bonusCores: number
}

export interface CoreBreakdown {
  kills: number
  time: number
  level: number
  evolves: number
  boss: number
  /** 乘区：星区 × 威胁 × 贪婪 */
  mult: number
  bonus: number
  total: number
}

/** 一局的晶核收益。时间 ≥ 45 秒保底 25。 */
export function runCores(
  stats: RunStats,
  sector: SectorId,
  threat: number,
  greedMul: number,
  bonus: number,
): CoreBreakdown {
  const part = {
    kills: stats.kills / 45,
    time: (stats.time / 60) * 5,
    level: stats.level * 1.2,
    evolves: stats.evolves * 12,
    boss: stats.bossKilled ? 120 : 0,
  }
  const mult = SECTORS[sector].reward * THREAT_LEVELS[Math.min(THREAT_LEVELS.length - 1, Math.max(0, threat))].reward * greedMul
  const base = part.kills + part.time + part.level + part.evolves + part.boss
  const raw = Math.round(base * mult)
  const floor = stats.time >= 45 ? 25 : 0
  const b = Math.max(0, Math.round(bonus * greedMul))
  return {
    kills: Math.round(part.kills * mult),
    time: Math.round(part.time * mult),
    level: Math.round(part.level * mult),
    evolves: Math.round(part.evolves * mult),
    boss: Math.round(part.boss * mult),
    mult,
    bonus: b,
    total: Math.max(floor, raw) + b,
  }
}

export interface Settlement {
  cores: CoreBreakdown
  /** 本次新解锁的成就 */
  newAch: AchDef[]
  /** 成就奖励的晶核合计 */
  achCores: number
  unlockedShips: ShipId[]
  /** 因本局通关而新开放的星区 */
  unlockedSector: SectorId | null
  /** 新解锁的威胁等级（该星区） */
  unlockedThreat: number | null
  records: { time: boolean; kills: boolean; endless: boolean }
  cleared: boolean
}

export function greedMultiplier(meta: MetaRanks): number {
  return 1 + (meta.m_greed ?? 0) * METAS.m_greed.per
}

/** 当前的成就指标值（用于判定与进度条）。 */
export function metricValue(s: SaveData, metric: AchMetric, run?: RunSummary): number {
  const rs = run?.stats
  switch (metric) {
    case 'runTime':
      return Math.max(s.best.time, rs?.time ?? 0)
    case 'runKills':
      return Math.max(s.best.kills, rs?.kills ?? 0)
    case 'runLevel':
      return Math.max(s.best.level, rs?.level ?? 0)
    case 'runEvolves':
      return Math.max(s.best.evolves, rs?.evolves ?? 0)
    case 'runWeapons':
      return Math.max(s.best.weapons, rs?.maxWeapons ?? 0)
    case 'runNoHit':
      return Math.max(s.best.noHit, rs?.noHitBest ?? 0)
    case 'runDashes':
      return Math.max(s.best.dashes, rs?.dashes ?? 0)
    case 'totalKills':
      return s.totals.kills
    case 'totalRuns':
      return s.totals.runs
    case 'totalCores':
      return s.lifetimeCores
    case 'bossFields':
      return s.clears.fields > 0 ? 1 : 0
    case 'bossWasteland':
      return s.clears.wasteland > 0 ? 1 : 0
    case 'bossVoid':
      return s.clears.void > 0 ? 1 : 0
    case 'clearThreat':
      return Math.max(0, ...SECTOR_IDS.map((id) => s.maxThreat[id]))
  }
}

/** 逐条检查成就；奖励的晶核可能触发新的成就（如"财富"），所以循环到稳定。 */
function checkAchievements(s: SaveData, run: RunSummary | undefined, now: number, out: Settlement): void {
  let again = true
  while (again) {
    again = false
    for (const a of ACHIEVEMENTS) {
      if (s.ach[a.id]) continue
      if (metricValue(s, a.metric, run) < a.target) continue
      s.ach[a.id] = now
      s.cores += a.reward
      s.lifetimeCores += a.reward
      out.achCores += a.reward
      out.newAch.push(a)
      for (const sid of SHIP_IDS) {
        if (SHIPS[sid].unlockAch === a.id && !s.ships.includes(sid)) {
          s.ships.push(sid)
          out.unlockedShips.push(sid)
        }
      }
      again = true
    }
  }
  s.ships = SHIP_IDS.filter((x) => s.ships.includes(x))
}

/**
 * 结算一局：发放晶核、更新记录与累计、判定成就与解锁。
 * 会直接修改传入的存档对象。
 */
export function settleRun(s: SaveData, run: RunSummary, now = Date.now()): Settlement {
  const st = run.stats
  const cleared = st.bossKilled
  const cores = runCores(st, run.sector, run.threat, greedMultiplier(s.meta), run.bonusCores)
  const out: Settlement = {
    cores,
    newAch: [],
    achCores: 0,
    unlockedShips: [],
    unlockedSector: null,
    unlockedThreat: null,
    records: { time: false, kills: false, endless: false },
    cleared,
  }

  s.cores += cores.total
  s.lifetimeCores += cores.total

  // 记录
  if (!run.endless && st.time > s.bestTime[run.sector]) {
    s.bestTime[run.sector] = st.time
    out.records.time = true
  }
  if (run.endless && st.time > s.bestEndless[run.sector]) {
    s.bestEndless[run.sector] = st.time
    out.records.endless = true
  }
  if (st.kills > s.best.kills) out.records.kills = true

  // 最好成绩（成就进度）
  const b = s.best
  b.time = Math.max(b.time, st.time)
  b.kills = Math.max(b.kills, st.kills)
  b.level = Math.max(b.level, st.level)
  b.evolves = Math.max(b.evolves, st.evolves)
  b.weapons = Math.max(b.weapons, st.maxWeapons)
  b.noHit = Math.max(b.noHit, st.noHitBest)
  b.dashes = Math.max(b.dashes, st.dashes)

  // 累计
  const t = s.totals
  t.runs++
  t.kills += st.kills
  t.time += st.time
  t.evolves += st.evolves
  t.dashes += st.dashes
  if (cleared) t.wins++
  else t.deaths++

  // 通关：星区、威胁等级
  if (cleared && !run.endless) {
    const before = s.maxThreat[run.sector]
    const wasFirst = s.clears[run.sector] === 0
    s.clears[run.sector]++
    if (run.threat > before) {
      s.maxThreat[run.sector] = run.threat
      if (run.threat + 1 <= THREAT_LEVELS.length - 1) out.unlockedThreat = run.threat + 1
    }
    if (wasFirst) {
      const next = SECTOR_IDS.find((id) => SECTORS[id].requires === run.sector)
      if (next) out.unlockedSector = next
    }
  }

  s.last = { ship: run.ship, sector: run.sector, threat: run.threat, endless: run.endless }
  checkAchievements(s, run, now, out)
  return out
}

/** 成就当前进度（0~1），已解锁恒为 1。 */
export function achProgress(s: SaveData, a: AchDef): number {
  if (s.ach[a.id]) return 1
  return Math.min(1, metricValue(s, a.metric) / a.target)
}

export function achCurrent(s: SaveData, a: AchDef): number {
  return Math.min(a.target, metricValue(s, a.metric))
}
