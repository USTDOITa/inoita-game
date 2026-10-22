/**
 * 普攻连打的输入门控。
 *
 * 原版 `GAMESTATE_PressKeyPlay @0x12f6f8` 的攻击键分支只在角色站立时
 * （`CHAR_IsCurrentActionStand`）发起 `CHAR_StartActionEx(ch, CHAR_GetDefaultAttack(ch), 1)`，
 * 触摸层按住会持续重复按键事件，所以出手一结束、人还站着就接下一击。复刻版按同一门控
 * 做成「开始攻击之后站定自动连打」：摇杆一动会清当前目标（`CHAR_SetTarget(ch,0)`），
 * 连打随之停止，要再按一次攻击键才会重新开始。依据见 work/findings/attack-key-2026-10-13.md。
 */
interface BasicAttackRepeatState {
  /** 当前选中的目标；空表示连打结束。 */
  targetId: string | undefined;
  attackState: 'idle' | 'approaching' | 'attacking';
}

export class BasicAttackRepeat {
  private engaged = false;
  /** 玩家发起一次普攻时调用；按交互键不算。 */
  engage(): void { this.engaged = true; }
  /** 停手：摇杆一动（目标被清掉）时调用；目标死亡由 `next` 自己发现。 */
  release(): void { this.engaged = false; }
  get active(): boolean { return this.engaged; }
  /** 每帧问一次：这一帧要不要自动接下一击。目标没了就解除，直到下次按攻击键。 */
  next(state: BasicAttackRepeatState): boolean {
    if (!this.engaged) return false;
    if (!state.targetId) { this.release(); return false; }
    return state.attackState === 'idle';
  }
}
