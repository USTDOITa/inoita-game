export type GameMode = 'menu' | 'class-select' | 'game';
/** 每个流程只释放自己持有的操作锁。 */
export class ControlState {
  mode: GameMode = 'menu';
  ready = false;
  failed = false;
  suspended = false;
  private locks = new Set<string>();
  get locked(): boolean { return this.locks.size > 0; }
  /** 当前按住操作锁的流程，按加入顺序。诊断卡住时先看这里。 */
  get lockOwners(): readonly string[] { return [...this.locks]; }
  lock(owner: string, active: boolean): void { if(active)this.locks.add(owner);else this.locks.delete(owner); }
}
