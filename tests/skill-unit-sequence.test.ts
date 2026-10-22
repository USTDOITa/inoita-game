import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { BattleCatalog, CombatUnit } from '../src/domain/battle.ts';
import { CombatHitResolution } from '../src/domain/combat-hit-resolution.ts';
import { resolveSkillUnitSequence } from '../src/domain/skill-unit-sequence.ts';

const catalog = JSON.parse(readFileSync(new URL('../public/content/battle.json', import.meta.url), 'utf8')) as BattleCatalog;
const units = (...effects: CombatUnit['effect'][]) => effects.map(effect => ({ effect }));

test('dark strike skips the failed enemy visual but still applies its self buff', () => {
  const action = catalog.skills['dark-strike'].action;
  assert.ok(action);
  const event = action.events.find(event => event.kind === 'units');
  assert.ok(event?.kind === 'units');
  const attempts: string[] = [];
  const results = resolveSkillUnitSequence(action.combatUnits!, {
    targets: index => [event.cues[index].target === 'self' ? 'caster' : 'enemy'],
    unit(index, target) {
      attempts.push(`${action.combatUnits![index].effect}:${target}`);
      return index === 0 ? 'failure' : 'success';
    },
  });
  assert.deepEqual(attempts, ['physical:enemy', 'buff:caster']);
  assert.deepEqual(results.map(result => result.outcome), ['failure', 'skipped', 'success']);
});

test('an area failure blocks only that target and reports each result before continuing', () => {
  const action = catalog.skills['curse-of-screams'].action;
  assert.ok(action);
  const order: string[] = [];
  resolveSkillUnitSequence(action.combatUnits!, {
    targets(index) { order.push(`targets:${index}`); return ['missed', 'hit']; },
    unit(index, target) {
      order.push(`unit:${index}:${target}`);
      return index === 0 && target === 'missed' ? 'failure' : 'success';
    },
    resolved: result => order.push(`${result.outcome}:${result.cueIndex}:${result.targetId}`),
  });
  assert.deepEqual(order, [
    'targets:0', 'unit:0:missed', 'failure:0:missed', 'unit:0:hit', 'success:0:hit',
    'targets:1', 'skipped:1:missed', 'unit:1:hit', 'success:1:hit',
    'targets:2', 'skipped:2:missed', 'unit:2:hit', 'success:2:hit',
  ]);
});

test('set and clear run after failure without clearing the target failure', () => {
  const attempts: number[] = [];
  const results = resolveSkillUnitSequence(units('physical', 'set-attribute', 'clear-attribute', 'taunt'), {
    targets: () => ['enemy'],
    unit(index) { attempts.push(index); return index === 0 ? 'failure' : 'success'; },
  });
  assert.deepEqual(attempts, [0, 1, 2]);
  assert.deepEqual(results.map(result => result.outcome), ['failure', 'success', 'success', 'skipped']);
});

test('a skipped attempt does not poison later units for a returning target', () => {
  const attempts: number[] = [];
  const results = resolveSkillUnitSequence(units('physical', 'buff', 'taunt'), {
    targets: () => ['enemy'],
    unit(index) { attempts.push(index); return index === 0 ? 'skipped' : 'success'; },
  });
  assert.deepEqual(attempts, [0, 1, 2]);
  assert.deepEqual(results.map(result => result.outcome), ['skipped', 'success', 'success']);
});

test('a full failure history keeps earlier targets blocked but cannot remember a seventeenth', () => {
  const firstTargets = Array.from({ length: 16 }, (_, index) => `enemy-${index}`);
  const attempts: string[] = [];
  const results = resolveSkillUnitSequence(units('physical', 'physical', 'buff'), {
    targets: index => index === 0 ? firstTargets : ['later-enemy', 'enemy-0'],
    unit(index, target) {
      attempts.push(`${index}:${target}`);
      return index < 2 ? 'failure' : 'success';
    },
  });
  assert.equal(attempts.length, 18);
  assert.deepEqual(attempts.slice(-2), ['1:later-enemy', '2:later-enemy']);
  assert.deepEqual(results.slice(-4).map(result => result.outcome), ['failure', 'skipped', 'success', 'skipped']);
});

test('failed bypass units occupy repeated slots instead of deduplicating the failure history', () => {
  const repeated = Array.from({ length: 15 }, () => 'set-attribute' as const);
  const attempts: string[] = [];
  const results = resolveSkillUnitSequence(units('physical', ...repeated, 'physical', 'visual', 'visual'), {
    targets: index => [index === 16 || index === 17 ? 'other' : 'same'],
    unit(index, target) {
      attempts.push(`${index}:${target}`);
      return index < 17 ? 'failure' : 'success';
    },
  });
  assert.equal(attempts.length, 18);
  assert.deepEqual(results.slice(-3).map(result => result.outcome), ['failure', 'success', 'skipped']);
});

test('each cue captures at most sixteen targets and queries the next cue after side effects', () => {
  const candidates = Array.from({ length: 17 }, (_, index) => `enemy-${index}`);
  const attempts: string[] = [];
  resolveSkillUnitSequence(units('physical', 'buff'), {
    targets: () => candidates,
    unit(index, target) {
      attempts.push(`${index}:${target}`);
      if (index === 0 && target === 'enemy-0') candidates.splice(0, candidates.length, 'new-enemy');
      return 'success';
    },
  });
  assert.deepEqual(attempts, [
    ...Array.from({ length: 16 }, (_, index) => `0:enemy-${index}`), '1:new-enemy',
  ]);
});

test('nested executions and later arrivals have independent target failure histories', () => {
  const inner: string[] = [];
  const outer = resolveSkillUnitSequence(units('physical', 'buff'), {
    targets: () => ['enemy'],
    unit() {
      resolveSkillUnitSequence(units('buff'), {
        targets: () => ['enemy'], unit: () => { inner.push('nested'); return 'success'; },
      });
      return 'failure';
    },
  });
  const later = resolveSkillUnitSequence(units('physical'), { targets: () => ['enemy'], unit: () => 'success' });
  assert.deepEqual(inner, ['nested']);
  assert.deepEqual(outer.map(result => result.outcome), ['failure', 'skipped']);
  assert.equal(later[0].outcome, 'success');
});

test('a host can wrap the whole sequence so later healing runs before the final death check', () => {
  const resolution = new CombatHitResolution();
  const order: string[] = [];
  let health = 10;
  resolution.run(() => resolveSkillUnitSequence(units('physical', 'heal'), {
    targets: () => ['caster'],
    unit(index) {
      return resolution.run(() => {
        if (index === 0) {
          health = 0;
          resolution.deferDefeat('caster', () => order.push(health > 0 ? 'saved' : 'defeated'));
        } else {
          assert.equal(resolution.isAwaitingDefeat('caster'), true);
          health = 10;
        }
        return 'success';
      });
    },
    resolved: result => order.push(`feedback:${result.cueIndex}`),
  }));
  assert.deepEqual(order, ['feedback:0', 'feedback:1', 'saved']);
  assert.equal(resolution.isAwaitingDefeat('caster'), false);
});

test('each unit prepares after its target list, including empty lists and failed cached targets',()=>{
  const order:string[]=[];
  resolveSkillUnitSequence(units('physical','magic','magic'),{
    targets(index){order.push(`targets:${index}`);return index===0?[]:['enemy'];},
    prepare:index=>order.push(`prepare:${index}`),
    unit(index,target){order.push(`unit:${index}:${target}`);return 'failure';},
    resolved:result=>order.push(`${result.outcome}:${result.cueIndex}`),
  });
  assert.deepEqual(order,[
    'targets:0','prepare:0',
    'targets:1','prepare:1','unit:1:enemy','failure:1',
    'targets:2','prepare:2','skipped:2',
  ]);
});
