import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { loadSceneAssets } from '../src/rendering/scene-assets.ts';
import type { PendingAsset } from '../src/rendering/scene-assets.ts';

const asset: PendingAsset = { kind: 'spritesheet', key: 'skill-effect', file: 'assets/effect.png', config: { frameWidth: 8, frameHeight: 8, endFrame: 2 } };
const diagnostic = (pattern: RegExp) => (error: unknown) => error instanceof Error && pattern.test(String(error.cause));

function setup() {
  const events = new EventEmitter();
  const frames = new Map<string, Set<number>>();
  const removed: string[] = [];
  const queued: string[] = [];
  let starts = 0;
  let outcome: 'success' | 'decode-error' | 'network-error' | 'missing-frame' | 'pending' = 'success';
  const load = Object.assign(new EventEmitter(), {
    spritesheet: (key: string) => queued.push(key), image: (key: string) => queued.push(key),
    start: () => { starts++; queueMicrotask(() => {
      if (outcome === 'pending') return;
      for (const key of queued.splice(0)) {
        if (outcome === 'network-error') load.emit('loaderror', { key });
        if (outcome === 'success') frames.set(key, new Set([0, 1, 2]));
        if (outcome === 'missing-frame') frames.set(key, new Set([0, 2]));
      }
      // Phaser's decode failure reaches complete without loaderror or a failed count.
      load.emit('complete', load, 0, 0);
    }); }
  });
  const scene = {
    events, load,
    textures: {
      exists: (key: string) => frames.has(key),
      get: (key: string) => ({ has: (frame: string) => frames.get(key)!.has(Number(frame)) }),
      remove: (key: string) => { removed.push(key); frames.delete(key); }
    },
    anims: { exists: () => false, remove: () => {} }
  } as unknown as Phaser.Scene;
  return { scene, events, load, frames, removed, queued, starts: () => starts, outcome: (next: typeof outcome) => { outcome = next; } };
}

test('decode failure rejects with the asset key and path, then retry can acquire and release it', async () => {
  const run = setup(); run.outcome('decode-error');
  await assert.rejects(loadSceneAssets(run.scene, [asset], () => {}), diagnostic(/skill-effect.*assets\/effect\.png/));
  assert.equal(run.events.listenerCount('shutdown'), 0);
  assert.deepEqual(run.load.eventNames(), []);
  run.outcome('success');
  const lease = await loadSceneAssets(run.scene, [asset], () => {});
  lease.release(); lease.release();
  assert.deepEqual(run.removed, [asset.key]);
});

test('missing middle frames reject both fresh and cached sprite sheets', async () => {
  for (const cached of [false, true]) {
    const run = setup(); run.outcome('missing-frame');
    if (cached) run.frames.set(asset.key, new Set([0, 2]));
    await assert.rejects(loadSceneAssets(run.scene, [asset], () => {}), diagnostic(/skill-effect.*帧 1/));
    assert.equal(run.frames.size, 0);
    assert.equal(run.events.listenerCount('shutdown'), 0);
  }
});

test('valid cached assets stay alive until the last lease is released', async () => {
  const run = setup();
  const first = await loadSceneAssets(run.scene, [asset, asset], () => {});
  const second = await loadSceneAssets(run.scene, [asset], () => {}, true);
  assert.equal(run.queued.length, 0);
  run.events.emit('shutdown');
  assert.equal(run.frames.size, 1);
  first.release(); second.release(); second.release();
  assert.deepEqual(run.removed, [asset.key]);
});

test('simultaneous requests on one scene share a loader batch and retain independent leases', async () => {
  const run = setup();
  const [first, second] = await Promise.all([
    loadSceneAssets(run.scene, [asset], () => {}),
    loadSceneAssets(run.scene, [asset], () => {}, true)
  ]);
  assert.equal(run.starts(), 1);
  first.release();
  assert.equal(run.frames.size, 1);
  second.release();
  assert.deepEqual(run.removed, [asset.key]);
});

test('network failure and shutdown clean up loading listeners and ownership', async () => {
  const network = setup(); network.outcome('network-error');
  await assert.rejects(loadSceneAssets(network.scene, [asset], () => {}), diagnostic(/skill-effect/));
  assert.deepEqual(network.load.eventNames(), []);
  const cancelled = setup(); cancelled.outcome('pending');
  const pending = loadSceneAssets(cancelled.scene, [asset], () => {});
  cancelled.events.emit('shutdown');
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(cancelled.load.eventNames(), []);
  assert.equal(cancelled.events.listenerCount('shutdown'), 0);
});
