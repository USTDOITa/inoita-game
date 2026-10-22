import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {parseBattle} from '../src/application/content-validation.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;

test('frame-timed buffs require consistent display durations and a positive periodic interval',()=>{
  const candidate=structuredClone(catalog);
  const unit=candidate.skills['dark-strike'].action!.combatUnits!.find(unit=>unit.effect==='buff')!;
  assert.equal(unit.effect,'buff');if(unit.effect!=='buff')return;
  const effect=unit.ranks[0].effect;
  effect.durationMs=4560;effect.tickMs=0;effect.simulationFrames={lastActiveFrame:75};
  assert.doesNotThrow(()=>parseBattle(candidate));
  effect.durationMs=5000;
  assert.throws(()=>parseBattle(candidate),/durationMs/);
  effect.durationMs=4560;effect.simulationFrames.lastActiveFrame=-1;
  assert.throws(()=>parseBattle(candidate),/lastActiveFrame/);
  effect.simulationFrames.lastActiveFrame=75;effect.simulationFrames.pulseIntervalFrames=0;
  assert.throws(()=>parseBattle(candidate),/pulseIntervalFrames/);
  effect.simulationFrames.pulseIntervalFrames=15;effect.tickMs=1000;
  assert.throws(()=>parseBattle(candidate),/tickMs/);
  effect.tickMs=900;effect.periodic=[{kind:'fixed-damage',amount:1}];
  assert.doesNotThrow(()=>parseBattle(candidate));
  delete effect.simulationFrames.pulseIntervalFrames;effect.tickMs=0;
  assert.throws(()=>parseBattle(candidate),/pulseIntervalFrames/);
});
