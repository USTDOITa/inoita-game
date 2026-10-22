/** Original presentation names; source record numbers stay in the importer. */
export const COMBAT_OUTCOME_EFFECTS = ['energy-column', 'enemy-vanish', 'level-up-aura', 'level-up-light', 'level-up-burst'] as const;
export const ENEMY_DEFEAT_HOLD_MS = 60;
export const ENEMY_DEFEAT_FADE_MS = 600;

/** A defeated enemy remains registered until its one settlement has completed. */
export class PendingEnemyDefeats {
  private readonly pending = new Map<string, (render: boolean) => void>();
  has(key: string): boolean { return this.pending.has(key); }
  add(key: string, settle: (render: boolean) => void): boolean {
    if (this.pending.has(key)) return false;
    this.pending.set(key, settle);
    return true;
  }
  complete(key: string, render = true): void {
    const settle = this.pending.get(key);
    if (!settle) return;
    this.pending.delete(key);
    settle(render);
  }
  clear():void {this.pending.clear();}
  flush(): void {
    for (const key of [...this.pending.keys()]) this.complete(key, false);
  }
}
