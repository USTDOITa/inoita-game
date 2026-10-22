import type { BattleCatalog } from '../domain/battle.ts';
import type { ItemCatalog } from '../domain/items.ts';
import type { MenuPanels } from '../domain/menu-panels.ts';
import type { StoryInterface } from '../domain/story-interface.ts';
import type { ShopCatalog } from '../domain/shop.ts';
import { COMMON_BUTTON_IMAGES } from '../ui/common-button.ts';

const titleRoot = '/assets/ui/title-menu/';
/**
 * 标题页的存档页也能删档与改名，删除前要用原版 `UIPopupMsg` 问一次。
 * 键名与 `drawNativeMessage` 取的一致，路径与 `menu-panels.json` 里同名的条目相同。
 */
export const TITLE_MESSAGE_ASSETS: Record<string, string> = Object.fromEntries(
  ['message-edge', 'message-ok', 'message-ok-pressed', 'message-yes', 'message-yes-pressed', 'message-no', 'message-no-pressed']
    .map(name => [name, `/assets/ui/menus/${name}.png`]));
export const titleMenuImages = [...COMMON_BUTTON_IMAGES, ...Object.values(TITLE_MESSAGE_ASSETS), ...[
  'background.png', 'logo.png', 'subtitle-left.png', 'subtitle-right.png',
  'back.png', 'slot.png', 'slot-empty.png'
].map(name => titleRoot + name)];

/** 根据实际内容目录生成菜单图片清单，避免页面首次打开时才发现图片。 */
export function gameMenuImages(panels: MenuPanels, items: ItemCatalog, battle: BattleCatalog, story: StoryInterface, shops:ShopCatalog): string[] {
  const files = [
    ...COMMON_BUTTON_IMAGES,
    ...Object.values(panels.assets),
    ...panels.equipmentSlots.map(slot => slot.emptyIcon),
    ...panels.skillColumns.map(column => column.image),
    ...Object.values(panels.classes).map(character => character.preview),
    ...Object.values(panels.character.portraits).flatMap(character => [character.image, character.partyIcon]),
    ...Object.values(items.items).map(item => item.icon),
    ...Object.values(battle.skills).map(skill => skill.icon)
  ];
  files.push(...Object.values(story.assets), ...Object.values(shops.assets));
  return [...new Set(files)];
}
