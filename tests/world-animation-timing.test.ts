import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { WorldIndex } from '../src/domain/content.ts';

const world: WorldIndex = JSON.parse(readFileSync(new URL('../public/content/world.json', import.meta.url), 'utf8'));

test('animated map actors use the native 60ms entry clock including ordinary NPCs', () => {
  let animated = 0;
  for (const actor of Object.values(world.actors)) for (const [name, clip] of Object.entries(actor.clips)) {
    if (clip!.frames <= 1) continue;
    assert.ok(Math.abs(1000 / clip!.frameRate - 60) < 1e-8, `${actor.id}/${name} must follow the native actor clock`);
    animated++;
  }
  assert.ok(animated > 100, 'exercise the published map actor catalog');
});

test('native four-entry torch and campfire cycles last 240ms', () => {
  for (const id of ['torch-45eb4a23', 'torch-bb8efaac', 'campfire-1881bee0']) {
    const clip = world.actors[id].clips['idle-south']!;
    assert.equal(clip.frames, 4, id);
    assert.ok(Math.abs(clip.frames * 1000 / clip.frameRate - 240) < 1e-8, id);
  }
  const merchant = world.actors['weapons-dealer-f31d78ce'].clips['idle-south']!;
  assert.equal(merchant.frames, 10);
  assert.ok(Math.abs(merchant.frames * 1000 / merchant.frameRate - 600) < 1e-8);
});
