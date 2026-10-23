import assert from 'node:assert/strict';
import test from 'node:test';
import { continueProgress, loadEntryPlan, type EntryLoadingPorts } from '../src/application/entry-loading.ts';
import type { EntryPlan } from '../src/application/entry-plan.ts';

function plan(overrides: Partial<EntryPlan> = {}): EntryPlan {
  const map = { id: 'current', name: 'current' } as EntryPlan['current']['map'];
  const assets = Array.from({ length: 2 }, (_, index) => ({
    kind: 'image' as const, key: `current-${index}`, file: `current-${index}.png`
  }));
  return {
    current: { map, visuals: { assets, actorIds: new Set() }, assets },
    shared: [{ kind: 'image', key: 'shared', file: 'shared.png' }],
    portraits: ['portrait.png'],
    sounds: ['sound-1'],
    scripts: ['demo'],
    ...overrides
  };
}

interface PortOptions { failPortraits?: boolean }

function ports(log: string[], options: PortOptions = {}): EntryLoadingPorts {
  return {
    load: async (assets, progress) => {
      log.push(`load:${assets.map(asset => asset.key).join(',')}`);
      progress(1);
      return { release: () => log.push(`release:${assets[0]?.key ?? 'empty'}`) };
    },
    report: (label, value) => log.push(`report:${label}:${value.toFixed(3)}`),
    preloadPortraits: async files => {
      log.push(`portraits:${files.join(',')}`);
      if (options.failPortraits) throw new Error('portrait failed');
    },
    prepareSounds: async names => { log.push(`sounds:${names.join(',')}`); }
  };
}

function reports(log: string[]): number[] {
  return log.filter(entry => entry.startsWith('report:')).map(entry => Number(entry.split(':')[2]));
}

test('entry loading covers only the current map and finishes monotonically', async () => {
  const log: string[] = [];
  const result = await loadEntryPlan(plan(), ports(log), { signal: new AbortController().signal });
  assert.ok(result.currentLease);
  assert.deepEqual(log.filter(entry => entry.startsWith('load:')), ['load:shared,current-0,current-1']);
  const values = reports(log);
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
  assert.ok(values.includes(0.88));
  assert.ok(Math.abs(values.at(-1)! - 0.94) < 0.001);
  assert.ok(log.indexOf('portraits:portrait.png') > log.findIndex(entry => entry.startsWith('load:')));
  assert.ok(log.indexOf('sounds:sound-1') > log.indexOf('portraits:portrait.png'));
});

test('first-entry mercenary assets join the current-map load without restarting progress', async () => {
  const log: string[] = [];
  const mercenaries = [{ kind: 'image' as const, key: 'merc-0', file: 'merc-0.png' }];
  await loadEntryPlan(plan({ mercenaries }), ports(log), { signal: new AbortController().signal });
  assert.deepEqual(log.filter(entry => entry.startsWith('load:')), ['load:shared,current-0,current-1,merc-0']);
  const values = reports(log);
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
  assert.ok(values.includes(0.88));
  assert.ok(values.every(value => value <= 0.94 + 1e-9));
});

test('a failure after the current map lease is acquired releases it', async () => {
  const log: string[] = [];
  const mercenaries = [{ kind: 'image' as const, key: 'merc-0', file: 'merc-0.png' }];
  await assert.rejects(loadEntryPlan(plan({ mercenaries }), ports(log, { failPortraits: true }), {
    signal: new AbortController().signal
  }));
  assert.ok(log.some(entry => entry.startsWith('release:shared')));
  assert.ok(!log.includes('sounds:sound-1'));
});

test('the caller can map the whole load into a progress window', async () => {
  const log: string[] = [];
  await loadEntryPlan(plan({ portraits: [], sounds: [] }), ports(log), {
    signal: new AbortController().signal, start: 0.5, end: 1
  });
  const values = reports(log);
  assert.ok(values.every(value => value >= 0.5 && value <= 1));
  assert.ok(Math.abs(values.at(-1)! - 0.97) < 0.001);
});

test('story preparation continues the entry bar instead of restarting it', () => {
  // 地图加载停在 0.9，剧情预取在同一条进度条上从 0.9 走到 1，看不出第二根进度条。
  assert.equal(continueProgress(0.9, 0), 0.9);
  assert.equal(continueProgress(0.9, 1), 1);
  let previous = -1;
  for (const value of [0, 0.25, 0.5, 0.75, 1]) {
    const result = continueProgress(0.9, value);
    assert.ok(result >= 0.9 && result <= 1);
    assert.ok(result > previous);
    previous = result;
  }
  assert.equal(continueProgress(0.5, 0.5), 0.75);
  assert.equal(continueProgress(0, 0.5), 0.5);
});
