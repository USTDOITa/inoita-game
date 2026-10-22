import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBattle } from '../src/application/content-validation.ts';
import { skillEffectNames } from '../src/domain/skill-action.ts';

const catalog = parseBattle(JSON.parse(fs.readFileSync(new URL('../public/content/battle.json', import.meta.url), 'utf8')));

test('地狱之兵召唤成功后按原版顺序在召唤物身上播放两层出现特效', () => {
  const action = catalog.skills['hell-s-pawn'].action!;
  const summon = action.combatUnits!.find(unit => unit.effect === 'summon')!;
  assert.equal(summon.creature, 'enemy-hell-s-pawn-1');
  assert.deepEqual(summon.appearanceEffects, [
    { effect: 'smoke-puff', recipient: 'target', placement: 'attached' },
    { effect: 'slash-arc', recipient: 'target', placement: 'attached' },
  ]);
  for (const effect of summon.appearanceEffects!) {
    assert.ok(catalog.attackEffects[effect.effect].clips.default);
    assert.ok(skillEffectNames(action).includes(effect.effect));
  }
  assert.equal(action.events.find(event => event.kind === 'units')?.kind, 'units');
});
