import type { ChaosTier } from '../domain/chaos-equipment.ts';
/** 原版像素颜色按低字节 R、G、B 存储；稀有度 0 使用控件基础色。 */
const RARITY_COLORS = ['#4eff00', '#00b4ff', '#ffe600', '#9c00ff'];

export function itemNameColor(rarity: number | undefined, chaosTier?: ChaosTier): string | undefined {
  if (chaosTier === 'chaos') return '#0000ff';
  if (chaosTier === 'epic-chaos') return '#ff6c00';
  return rarity === undefined ? undefined : RARITY_COLORS[rarity - 1];
}
