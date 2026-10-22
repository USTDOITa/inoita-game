import test from 'node:test';
import assert from 'node:assert/strict';
import { minimapCellSize, minimapPoint, minimapExits, minimapRuns } from '../src/domain/minimap.ts';
import type { MapExit } from '../src/domain/content.ts';

test('native cell size preserves strict width and height thresholds', () => {
  for (const [columns, rows, expected] of [[39,29,5],[40,29,4],[25,30,4],[49,37,4],
    [50,37,3],[40,38,3],[66,49,3],[67,49,2],[40,50,2]]) {
    assert.equal(minimapCellSize(columns, rows), expected);
  }
});

test('markers follow tile coordinates and change at tile boundaries', () => {
  assert.deepEqual(minimapPoint({x: 120, y: 312}, 16, 4), {x: 28, y: 76});
  assert.deepEqual(minimapPoint({x: 127.99, y: 319.99}, 16, 4), {x: 28, y: 76});
  assert.deepEqual(minimapPoint({x: 128, y: 320}, 16, 4), {x: 32, y: 80});
});

test('grid drawing preserves blocked and walkable cells across row boundaries', () => {
  assert.deepEqual(minimapRuns({columns: 4, rows: 3, blocked: [
    true, true, false, false, false, false, false, false, true, false, true, true
  ]}), [
    {x: 0, y: 0, width: 2, blocked: true}, {x: 2, y: 0, width: 2, blocked: false},
    {x: 0, y: 1, width: 4, blocked: false}, {x: 0, y: 2, width: 1, blocked: true},
    {x: 1, y: 2, width: 1, blocked: false}, {x: 2, y: 2, width: 2, blocked: true}
  ]);
});

test('doorway grouping merges connected exit cells while preserving separate doors and destinations', () => {
  const exit = (x: number, y: number, destination = 'next'): MapExit => ({
    x, y, width: 16, height: 16, destination, spawn: {x: 8, y: 8}, facing: 'south', exitFacing: 'any'
  });
  assert.deepEqual(minimapExits([]), []);
  assert.deepEqual(minimapExits([exit(0, 0), exit(0, 32), exit(0, 16)]), [{x: 8, y: 24}]);
  assert.deepEqual(minimapExits([exit(0, 0), exit(0, 32)]), [{x: 8, y: 8}, {x: 8, y: 40}]);
  assert.deepEqual(minimapExits([exit(0, 0), exit(0, 16, 'other')]), [{x: 8, y: 8}, {x: 8, y: 24}]);
});
