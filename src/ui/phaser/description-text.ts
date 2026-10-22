import type Phaser from 'phaser';
import type { DescriptionTextPart } from '../../domain/description-text.ts';
import { layoutDescriptionText } from '../description-text-layout.ts';
import { DESCRIPTION_TEXT } from '../bag-layout.ts';
import type { UiSurface } from './widgets.ts';

/** 原生 Text 负责测量和绘字，返回排版后的实际高度供滚动区使用。 */
export function drawDescriptionText(view: UiSurface, parts: readonly DescriptionTextPart[], x: number, y: number,
  width: number, size: number, parent?: Phaser.GameObjects.Container): number {
  if (!parts.length) return 0;
  const probe = view.text('测', 0, 0, 0, size, DESCRIPTION_TEXT, parent);
  const lines = layoutDescriptionText(parts, width, text => probe.context.measureText(text).width);
  const lineHeight = probe.height + 5;
  probe.destroy();
  lines.forEach((line, index) => {
    for (const run of line.runs) view.text(run.text, x + run.x, y + index * lineHeight, 0, size,
      run.color ?? DESCRIPTION_TEXT, parent);
  });
  return Math.max(0, lines.length * lineHeight - 5);
}
