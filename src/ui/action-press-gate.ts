/**
 * 原版 `UIPlay_bPressedAction`：一个动作按钮按住期间，其它动作按钮的按下被忽略，
 * 该 pointer 释放后解除。方向摇杆不经过这里，可与技能按钮同时按住。
 */
export class ActionPressGate {
  private pointer: number | null = null;
  press(pointer: number): boolean {
    if (this.pointer !== null) return false;
    this.pointer = pointer;
    return true;
  }
  release(pointer: number): void {
    if (this.pointer === pointer) this.pointer = null;
  }
  reset(): void {
    this.pointer = null;
  }
}
