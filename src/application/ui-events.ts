/**
 * 界面上流动的自定义事件的唯一名字。
 *
 * 这些名字原先在发出与监听两侧各写一遍裸字符串，改名或拼错时监听端**静默收不到**：
 * 例如 `minimap-layout` 漏改一处，小地图尺寸就不再更新，既不报错也不留痕迹。
 * 收在这里之后，改名只要编译一次。
 *
 * 只收两侧都在用的三个。`skill-effect` 一类只有发出方（消费它的是测试的替身），
 * 拼错时那条测试会直接失败，不会静默，所以不在这里。
 */
export const UI_EVENTS = {
  /** 按钮被点选或键盘激活；`main.ts` 听它播选中音。 */
  select: 'ui-select',
  /** 取消当前输入：拖拽、滚动与按下态都要复位。 */
  cancelInput: 'ui-cancel-input',
  /** 小地图重排，载荷是它占用的高度。 */
  minimapLayout: 'minimap-layout',
} as const;
