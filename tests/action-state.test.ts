import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBattle } from '../src/application/content-validation.ts';
import { resolveActionState } from '../src/domain/action-state.ts';

const catalog=parseBattle(JSON.parse(fs.readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')));

test('native state unit uses its first formula as chance and second as duration',()=>{
  const stun=catalog.skills['shield-bash'].action!.combatUnits!.find(unit=>unit.effect==='state')!;
  assert.deepEqual(stun.ranks[0],{chanceThreshold:1000,durationMs:1200,
    stateDurationProfile:{normal:{lastActiveFrame:19},targetShortened:{lastActiveFrame:9}}});
  assert.deepEqual(resolveActionState(stun,1,()=>.999),{applies:true,durationMs:1200});
  const uncertain={...stun,ranks:[{chanceThreshold:200,durationMs:2000}]};
  assert.equal(resolveActionState(uncertain,1,()=>0).applies,true);
  assert.equal(resolveActionState(uncertain,1,()=>.999).applies,false);
});

test('state chance preserves the strict threshold and guaranteed-success boundary',()=>{
  const stun=catalog.skills['shield-bash'].action!.combatUnits!.find(unit=>unit.effect==='state')!;
  const state=(chanceThreshold:number)=>({...stun,ranks:[{chanceThreshold,durationMs:1200}]});
  assert.equal(resolveActionState(state(0),1,()=>0).applies,false);
  assert.equal(resolveActionState(state(1),1,()=>0).applies,false);
  assert.equal(resolveActionState(state(2),1,()=>0).applies,true);
  assert.equal(resolveActionState(state(999),1,()=>998/999).applies,false);
  assert.equal(resolveActionState(state(1000),1,()=>{throw new Error('guaranteed effects do not roll');}).applies,true);
});
