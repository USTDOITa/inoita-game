import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog,BattleBuffEffect} from '../src/domain/battle.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const unit=catalog.skills.whist.action!.combatUnits![0];
assert.ok(unit.effect==='buff');
const effect=unit.ranks[0].effect;
const stateDependencies=['physicalDamageRate','criticalRate','stunImmunity','manaRecoveryPerPulse','bestNormalDamage'] as const;
const seed=(conditions:CombatConditions)=>{
  for(const key of [...stateDependencies,'assassinSwordHitAdjustment','attackSpeedRate'] as const)
    conditions.setTemporaryAttribute('actor',key,999);
};
const stateRefreshed=(conditions:CombatConditions)=>{
  for(const key of stateDependencies)assert.equal(conditions.attribute('actor',key,0),0,key);
  assert.equal(conditions.attribute('actor','attackSpeedRate',0),999,'unrelated cached values retain their own lifetime');
};

test('Whist state dependencies and explicit buff invalidations refresh their distinct cached attributes',()=>{
  const conditions=new CombatConditions();seed(conditions);
  conditions.applyBuff('actor','whist',2,effect);
  stateRefreshed(conditions);
  assert.equal(conditions.attribute('actor','assassinSwordHitAdjustment',230),230);
  seed(conditions);conditions.removeState('actor','stealthed');
  assert.equal(conditions.hasBuff('actor','whist'),false);
  stateRefreshed(conditions);
  assert.equal(conditions.attribute('actor','assassinSwordHitAdjustment',230),230);
});

test('natural state expiry refreshes its dependencies while retaining the buff and its independent cache until removal',()=>{
  const conditions=new CombatConditions(),shortState=structuredClone(effect);
  shortState.stateDurationProfiles={stealthed:{normal:{lastActiveFrame:0}}};
  conditions.applyBuff('actor','whist',2,shortState);seed(conditions);
  conditions.update(120);
  assert.equal(conditions.hasState('actor','stealthed'),false);
  assert.equal(conditions.hasBuff('actor','whist'),true);
  stateRefreshed(conditions);
  assert.equal(conditions.attribute('actor','assassinSwordHitAdjustment',230),999);
  seed(conditions);conditions.removeBuff('actor','whist');
  stateRefreshed(conditions);
  assert.equal(conditions.attribute('actor','assassinSwordHitAdjustment',230),230,'buff removal also resets dependencies when its state already expired');
});

test('bare stealth attack modifiers and a refused state allocation do not invent state cache invalidations',()=>{
  const conditions=new CombatConditions();seed(conditions);
  const attributesOnly:BattleBuffEffect={durationMs:10000,tickMs:0,states:[],periodic:[],modifiers:effect.modifiers};
  conditions.applyBuff('actor','whist',2,attributesOnly);
  assert.equal(conditions.attribute('actor','bestNormalDamage',100),999);
  conditions.removeBuff('actor','whist');
  assert.equal(conditions.attribute('actor','bestNormalDamage',100),999);
  for(let index=0;index<128;index++)assert.equal(conditions.applyStateFrames(`occupied-${index}`,'stun',100),true);
  assert.equal(conditions.applyStateFrames('actor','stealthed',100),false);
  assert.equal(conditions.attribute('actor','bestNormalDamage',100),999);
  assert.equal(conditions.attribute('actor','criticalRate',0),999);
});
