import type { DescriptionTextPart } from '../domain/description-text.ts';
import { plainDescription } from '../domain/description-text.ts';
import { wrapText } from './text-layout.ts';

interface DescriptionTextLine { runs: (DescriptionTextPart & { x: number })[] }

/** 整行测量后恢复颜色片段，换颜色不改变断行或字间距。 */
export function layoutDescriptionText(parts: readonly DescriptionTextPart[], width: number,
  measure: (text: string) => number): DescriptionTextLine[] {
  const characters = parts.flatMap(part => Array.from(part.text, text => ({ text, color: part.color })));
  let cursor = 0;
  return wrapText(plainDescription(parts), width, measure).map(text => {
    const runs: DescriptionTextLine['runs'] = [];
    let prefix = '';
    for (const character of Array.from(text)) {
      const color = characters[cursor++].color, previous = runs.at(-1);
      if (previous && previous.color === color) previous.text += character;
      else runs.push({ text: character, color, x: measure(prefix) });
      prefix += character;
    }
    if (characters[cursor]?.text === '\n') cursor++;
    return { runs };
  });
}
