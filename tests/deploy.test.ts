import assert from 'node:assert/strict';
import test from 'node:test';
import { compareBuild } from '../tools/deploy.ts';
import type { BuildMeta } from '../tools/build-version.ts';

const meta: BuildMeta = { schema: 1, builtAt: '2026-10-22T00:00:00.000Z', assetVersion: 'a1', contentVersion: 'c1' };

test('deploy comparison accepts the same build and rejects stale or partial ones', () => {
  assert.deepEqual(compareBuild(meta, { ...meta }), { ok: true });
  assert.match(compareBuild(meta, { ...meta, builtAt: '2026-10-22T00:00:01.000Z' }).reason!, /builtAt/);
  assert.match(compareBuild(meta, { ...meta, assetVersion: 'a2' }).reason!, /assetVersion/);
  assert.match(compareBuild(meta, { ...meta, contentVersion: 'c2' }).reason!, /contentVersion/);
});
