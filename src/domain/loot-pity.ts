/**
 * 温和保底：连续没有出装备/稀有以上时，下一次的概率逐步提高，直到上限。
 * 不做「固定次数必出」，也不改变槽位的基础概率；计数按成员、按存档保存。
 */
export interface PityCounters {
  equipmentMisses: number;
  rarePlusMisses: number;
}

export interface LootPityState {
  version: 1;
  members: [string, PityCounters][];
  chests: [string, PityCounters][];
  bossDefeats: string[];
}

export interface PityConfig {
  equipment: { stepPermille: number; capPermille: number };
  rare: { stepPermille: number; capPermille: number };
  levelWindow: number;
}

const EMPTY = (): PityCounters => ({ equipmentMisses: 0, rarePlusMisses: 0 });
const clone = (value: PityCounters): PityCounters => ({ ...value });

export class LootPity {
  private readonly members = new Map<string, PityCounters>();
  private readonly chests = new Map<string, PityCounters>();
  private readonly bossDefeats = new Set<string>();

  counters(ownerId: string): PityCounters {
    let value = this.members.get(ownerId);
    if (!value) {
      value = EMPTY();
      this.members.set(ownerId, value);
    }
    return value;
  }

  chestCounters(key: string): PityCounters {
    let value = this.chests.get(key);
    if (!value) {
      value = EMPTY();
      this.chests.set(key, value);
    }
    return value;
  }

  /** 槽位的绝对加值（万分比），只加在对应槽位上。 */
  equipmentBonus(ownerId: string, config: PityConfig): number {
    return Math.min(this.counters(ownerId).equipmentMisses * config.equipment.stepPermille, config.equipment.capPermille);
  }

  rareBonus(ownerId: string, config: PityConfig): number {
    return Math.min(this.counters(ownerId).rarePlusMisses * config.rare.stepPermille, config.rare.capPermille);
  }

  chestEquipmentBonus(key: string, config: PityConfig): number {
    return Math.min(this.chestCounters(key).equipmentMisses * config.equipment.stepPermille, config.equipment.capPermille);
  }

  /** 一次怪物结算：没有装备时累计 miss，出了装备就清零；稀有以上单独计数。 */
  recordEnemy(ownerId: string, result: { equipment: boolean; bestRarity?: number }, withinWindow: boolean): void {
    if (!withinWindow) return;
    const counters = this.counters(ownerId);
    if (result.equipment) {
      counters.equipmentMisses = 0;
      if ((result.bestRarity ?? 0) >= 2) counters.rarePlusMisses = 0;
      else counters.rarePlusMisses += 1;
    } else {
      counters.equipmentMisses += 1;
      counters.rarePlusMisses += 1;
    }
  }

  recordChest(key: string, result: { equipment: boolean }): void {
    const counters = this.chestCounters(key);
    counters.equipmentMisses = result.equipment ? 0 : counters.equipmentMisses + 1;
  }

  /** 每个存档只对同一 Boss 触发一次首杀保底。 */
  takeBossFirstDefeat(enemyId: string): boolean {
    if (this.bossDefeats.has(enemyId)) return false;
    this.bossDefeats.add(enemyId);
    return true;
  }

  bossDefeated(enemyId: string): boolean {
    return this.bossDefeats.has(enemyId);
  }

  removeMember(ownerId: string): void {
    this.members.delete(ownerId);
  }

  captureState(): LootPityState {
    return {
      version: 1,
      members: [...this.members].map(([id, value]) => [id, clone(value)]),
      chests: [...this.chests].map(([id, value]) => [id, clone(value)]),
      bossDefeats: [...this.bossDefeats].sort(),
    };
  }

  restoreState(state: LootPityState): void {
    if (state?.version !== 1 || !Array.isArray(state.members) || !Array.isArray(state.chests)
      || !Array.isArray(state.bossDefeats)) throw new Error('掉落保底状态无效');
    const valid = (counter: PityCounters) => counter && Number.isSafeInteger(counter.equipmentMisses)
      && counter.equipmentMisses >= 0 && Number.isSafeInteger(counter.rarePlusMisses) && counter.rarePlusMisses >= 0;
    if (!state.members.every(([, counter]) => valid(counter)) || !state.chests.every(([, counter]) => valid(counter)))
      throw new Error('掉落保底计数无效');
    this.members.clear();
    this.chests.clear();
    this.bossDefeats.clear();
    for (const [id, value] of state.members) this.members.set(id, clone(value));
    for (const [id, value] of state.chests) this.chests.set(id, clone(value));
    for (const id of state.bossDefeats) this.bossDefeats.add(id);
  }
}
