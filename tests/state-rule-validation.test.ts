import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {parseBattle} from '../src/application/content-validation.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
test('state lifetime profiles require real states, a normal lifetime and a frame-timed parent',()=>{
  const data=structuredClone(catalog),effect=data.statusAttackBuffs!['attack-stun']!;
  assert.doesNotThrow(()=>parseBattle(data));
  delete effect.stateDurationProfiles!.stun;
  assert.throws(()=>parseBattle(data),/stateDurationProfiles.stun/);
  effect.stateDurationProfiles=structuredClone(catalog.statusAttackBuffs!['attack-stun']!.stateDurationProfiles);
  effect.stateDurationProfiles!.stun!.normal.lastActiveFrame=-1;
  assert.throws(()=>parseBattle(data),/lastActiveFrame/);
  effect.stateDurationProfiles!.stun!.normal.lastActiveFrame=45;
  effect.stateDurationProfiles!.sleep={normal:{lastActiveFrame:45}};
  assert.throws(()=>parseBattle(data),/stateDurationProfiles.sleep/);
  delete effect.stateDurationProfiles!.sleep;delete effect.simulationFrames;
  assert.throws(()=>parseBattle(data),/simulationFrames/);
});
test('target duration rules use named states and only researched duration factors',()=>{
  const data=structuredClone(catalog),target=data.enemies[0];
  target.stateRules={durationScale:0.5,buffDurationScaleByState:{stun:0.5}};
  assert.doesNotThrow(()=>parseBattle(data));
  (target.stateRules as unknown as {durationScale:number}).durationScale=0.25;
  assert.throws(()=>parseBattle(data),/durationScale/);
  target.stateRules={immuneStates:['stun']};
  (target.stateRules.immuneStates as unknown as string[]).push('raw-state-3');
  assert.throws(()=>parseBattle(data),/immuneStates/);
});
