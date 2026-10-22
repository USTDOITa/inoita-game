/** 已在导入阶段解释的说明文字；颜色为 RGB，换行保留在 text 中。 */
export interface DescriptionTextPart { text: string; color?: string }

export function plainDescription(parts: readonly DescriptionTextPart[]): string {
  return parts.map(part => part.text).join('');
}
