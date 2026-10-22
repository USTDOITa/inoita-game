/** 按字形测量中文，保留显式换行；同一结果用于显示与分页。 */
export function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = []; let line = '';
  for (const character of Array.from(text)) {
    if (character === '\n') { lines.push(line); line = ''; continue; }
    if (line && measure(line + character) > width) { lines.push(line); line = character; }
    else line += character;
  }
  lines.push(line); return lines;
}

