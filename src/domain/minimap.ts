import type { MapExit, WorldMap } from './content.ts';
import type { Point } from './navigation.ts';

/** Reference pixels per terrain cell, using the original map-size thresholds. */
export function minimapCellSize(columns: number, rows: number): number {
  if (columns * 5 < 200 && rows * 5 < 150) return 5;
  if (columns < 50 && rows < 38) return 4;
  if (columns * 3 < 200 && rows * 3 < 150) return 3;
  return 2;
}
/** Original markers follow the occupied tile, rather than sub-tile movement. */
export function minimapPoint(point: Point, tileSize: number, cellSize: number): Point {
  return {x: Math.floor(point.x / tileSize) * cellSize, y: Math.floor(point.y / tileSize) * cellSize};
}

/** Adjacent cells with the same shading can share one draw call, within each row. */
export function minimapRuns(map: Pick<WorldMap, 'columns' | 'rows' | 'blocked'>) {
  const runs: {x: number; y: number; width: number; blocked: boolean}[] = [];
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.columns;) {
      const start = x, blocked = map.blocked[y * map.columns + x];
      while (++x < map.columns && map.blocked[y * map.columns + x] === blocked) {}
      runs.push({x: start, y, width: x - start, blocked});
    }
  }
  return runs;
}

/** One marker per connected doorway, preserving distinct destinations. */
export function minimapExits(exits: readonly MapExit[]): Point[] {
  const remaining = [...exits], points: Point[] = [];
  while (remaining.length) {
    const group = [remaining.shift()!];
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      for (let j = remaining.length - 1; j >= 0; j--) {
        const b = remaining[j];
        if (a.destination === b.destination && a.x <= b.x + b.width && b.x <= a.x + a.width &&
            a.y <= b.y + b.height && b.y <= a.y + a.height) group.push(...remaining.splice(j, 1));
      }
    }
    const left = Math.min(...group.map(e => e.x)), right = Math.max(...group.map(e => e.x + e.width));
    const top = Math.min(...group.map(e => e.y)), bottom = Math.max(...group.map(e => e.y + e.height));
    points.push({x: (left + right) / 2, y: (top + bottom) / 2});
  }
  return points;
}
