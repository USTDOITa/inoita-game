/** 原版装备加工的提示类别。界面用内容目录中的本地化文本显示。 */
export const ITEM_NOTICES = ['enchant-double','enchant-rule','enchant-durability','enchant-level','enchant-first',
  'enchant-chaos-durability','enchant-max','socket-incompatible','socket-full'] as const;
export type ItemNotice = typeof ITEM_NOTICES[number];
export const ITEM_NOTICE_TEXT: Record<ItemNotice,string> = {
  'enchant-double':'强化+2成功！', 'enchant-rule':'与一般的强化卷轴不同。',
  'enchant-durability':'耐久度不足。', 'enchant-level':'等级不符。',
  'enchant-first':'至少需要强化+1以上。',
  'enchant-chaos-durability':'混沌强化卷轴只有在耐久度为0的状态下才可以使用。',
  'enchant-max':'强化已达到上限。', 'socket-incompatible':'该道具不适合。', 'socket-full':'宝石孔不足。'
};
export class ItemApplicationError extends Error {
  readonly notice: ItemNotice;
  constructor(notice:ItemNotice) { super(ITEM_NOTICE_TEXT[notice]); this.notice=notice; }
}
