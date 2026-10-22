/** 右侧操作区的回调。六格快捷位里的技能与物品各走一条分支。 */
export interface ActionControlsHandlers {
  attack(): void;
  skill(key: string): void;
  item?(itemId: string): void;
  swap(): void;
}
