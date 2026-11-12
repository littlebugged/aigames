/** 极简对象池：高频创建/销毁的实体（弹体、粒子、敌人）复用，避免 GC 抖动。 */
export class Pool<T> {
  private free: T[] = []

  constructor(private readonly make: () => T) {}

  get(): T {
    return this.free.pop() ?? this.make()
  }

  put(o: T): void {
    this.free.push(o)
  }
}

/** 原地压缩数组：保留 alive 的，死掉的归还对象池。 */
export function compact<T extends { alive: boolean }>(arr: T[], pool?: Pool<T>): void {
  let j = 0
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i]
    if (o.alive) arr[j++] = o
    else if (pool) pool.put(o)
  }
  arr.length = j
}
