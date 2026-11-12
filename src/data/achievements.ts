/**
 * 成就。每条成就绑定一个"指标 + 目标值"，由 game/achievements.ts 统一判定。
 * 'run' 范围的指标看单局表现，'total' 范围的指标看累计数据。
 */
export type AchMetric =
  | 'runTime'
  | 'runKills'
  | 'runLevel'
  | 'runEvolves'
  | 'runWeapons'
  | 'runNoHit'
  | 'runDashes'
  | 'totalKills'
  | 'totalRuns'
  | 'totalCores'
  | 'bossFields'
  | 'bossWasteland'
  | 'bossVoid'
  | 'clearThreat'

export interface AchDef {
  id: string
  metric: AchMetric
  target: number
  /** 奖励晶核 */
  reward: number
}

export const ACHIEVEMENTS: AchDef[] = [
  { id: 'kills_100', metric: 'runKills', target: 100, reward: 20 },
  { id: 'kills_500', metric: 'runKills', target: 500, reward: 40 },
  { id: 'kills_1500', metric: 'runKills', target: 1500, reward: 90 },
  { id: 'survive_3', metric: 'runTime', target: 180, reward: 20 },
  { id: 'survive_5', metric: 'runTime', target: 300, reward: 40 },
  { id: 'survive_8', metric: 'runTime', target: 480, reward: 90 },
  { id: 'level_10', metric: 'runLevel', target: 10, reward: 20 },
  { id: 'level_25', metric: 'runLevel', target: 25, reward: 60 },
  { id: 'level_40', metric: 'runLevel', target: 40, reward: 140 },
  { id: 'evolve_1', metric: 'runEvolves', target: 1, reward: 60 },
  { id: 'evolve_3', metric: 'runEvolves', target: 3, reward: 160 },
  { id: 'arsenal', metric: 'runWeapons', target: 6, reward: 50 },
  { id: 'no_hit_2', metric: 'runNoHit', target: 120, reward: 60 },
  { id: 'dash_50', metric: 'runDashes', target: 50, reward: 30 },
  { id: 'boss_fields', metric: 'bossFields', target: 1, reward: 150 },
  { id: 'boss_wasteland', metric: 'bossWasteland', target: 1, reward: 250 },
  { id: 'boss_void', metric: 'bossVoid', target: 1, reward: 400 },
  { id: 'total_kills_2k', metric: 'totalKills', target: 2000, reward: 50 },
  { id: 'total_kills_20k', metric: 'totalKills', target: 20000, reward: 200 },
  { id: 'runs_10', metric: 'totalRuns', target: 10, reward: 40 },
  { id: 'runs_50', metric: 'totalRuns', target: 50, reward: 150 },
  { id: 'rich', metric: 'totalCores', target: 2000, reward: 100 },
  { id: 'threat_1', metric: 'clearThreat', target: 1, reward: 200 },
  { id: 'threat_3', metric: 'clearThreat', target: 3, reward: 500 },
]
