import assert from 'node:assert/strict';
import test from 'node:test';
import { storyReachableMaps } from '../src/domain/story-script.ts';

function campaign() {
  return {
    scripts: {
      main: { entry: 'n1', nodes: [
        { id: 'n1', presentation: [{ type: 'stage', map: 'b' }], commands: [
          { type: 'travel', destination: { map: 'c', x: 0, y: 0, facing: 'south' } },
        ], exit: { type: 'branch', condition: {}, then: { script: 'main', node: 'n2' }, otherwise: { script: 'main', node: 'n3' } } },
        { id: 'n2', presentation: [], commands: [], exit: { type: 'end' } },
        { id: 'n3', presentation: [{ type: 'stage', map: 'd' }], commands: [], exit: { type: 'end' } },
      ] },
      'enter-b': { entry: 'n1', nodes: [
        { id: 'n1', presentation: [], commands: [
          { type: 'world', command: { kind: 'travel', destination: { map: 'e', x: 0, y: 0, facing: 'south' } } },
        ], exit: { type: 'end' } },
      ] },
      'enter-any': { entry: 'n1', nodes: [
        { id: 'n1', presentation: [{ type: 'stage', map: 'f' }], commands: [], exit: { type: 'end' } },
      ] },
    },
    events: [
      { id: 'enter-b', source: 'map-entry', key: 'b', script: 'enter-b' },
      { id: 'enter-any', source: 'map-entry', script: 'enter-any' },
    ],
  } as unknown as Parameters<typeof storyReachableMaps>[0];
}

test('reachable maps follow every branch and continue through map entry events', () => {
  assert.deepEqual(storyReachableMaps(campaign(), ['main']).sort(), ['b', 'c', 'd', 'e', 'f']);
});

test('reachable maps keep the first maps when the budget is reached', () => {
  assert.deepEqual(storyReachableMaps(campaign(), ['main'], 2).sort(), ['b', 'c']);
});
