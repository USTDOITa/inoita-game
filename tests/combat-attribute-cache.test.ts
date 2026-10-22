import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {applyCombatOperation} from '../src/domain/combat-operation.ts';
import type {BattleBuffEffect,CombatOperation} from '../src/domain/battle.ts';
import type {BattleStatKey} from '../src/domain/battle-semantics.ts';

const effect=(attribute:BattleStatKey='physicalAttack',operation:CombatOperation={kind:'add',amount:10}):BattleBuffEffect=>
  ({durationMs:120,tickMs:0,states:[],periodic:[],modifiers:[{attribute,operation}]});

test('temporary writes freeze the complete attribute and successive writes read the previous value',()=>{
  const conditions=new CombatConditions(),passives=[{attribute:'physicalAttack' as const,operation:{kind:'add' as const,amount:20}}];
  conditions.applyBuff('actor','dark-strike',1,effect());
  const first=conditions.attribute('actor','physicalAttack',100,passives);
  assert.equal(first,130);
  conditions.setTemporaryAttribute('actor','physicalAttack',applyCombatOperation(first,{kind:'multiply',factor:2}));
  assert.equal(conditions.attribute('actor','physicalAttack',500,[]),260);
  conditions.setTemporaryAttribute('actor','physicalAttack',applyCombatOperation(conditions.attribute('actor','physicalAttack',500),{kind:'add',amount:5}));
  assert.equal(conditions.attribute('actor','physicalAttack',100,passives),265);
  conditions.clearTemporaryAttribute('actor','physicalAttack');
  assert.equal(conditions.attribute('actor','physicalAttack',500,passives),530);
});

test('zero and negative cached values are exact and remain isolated by actor and attribute',()=>{
  const conditions=new CombatConditions();
  conditions.setTemporaryAttribute('actor','physicalAttack',0);
  conditions.setTemporaryAttribute('actor','magicAttack',-20);
  conditions.setTemporaryAttribute('other','physicalAttack',9);
  assert.equal(conditions.cachedAttribute('actor','physicalAttack'),0);
  assert.equal(conditions.cachedAttribute('actor','magicAttack'),-20);
  assert.equal(conditions.cachedAttribute('missing','physicalAttack'),undefined);
  assert.equal(conditions.attribute('actor','physicalAttack',100),0);
  assert.equal(conditions.attribute('actor','magicAttack',100),-20);
  conditions.clearTemporary('actor');
  assert.equal(conditions.attribute('actor','physicalAttack',100),100);
  assert.equal(conditions.attribute('actor','magicAttack',100),100);
  assert.equal(conditions.attribute('other','physicalAttack',100),9);
});

test('accepted buffs invalidate only their declared modifier keys before state initialization',()=>{
  const conditions=new CombatConditions();
  conditions.setTemporaryAttribute('actor','physicalAttack',999);
  conditions.setTemporaryAttribute('actor','magicAttack',888);
  const buff={...effect(),states:['stun' as const]};
  let read=0;
  conditions.applyBuff('actor','dark-strike',1,buff,'source',()=>{read=conditions.attribute('actor','physicalAttack',100);return false;});
  assert.equal(read,110);
  assert.equal(conditions.attribute('actor','magicAttack',100),888);
});

test('weaker rejection preserves caches and equal-rank refresh invalidates the accepted modifiers',()=>{
  const conditions=new CombatConditions();
  conditions.applyBuff('actor','dark-strike',2,effect());
  conditions.setTemporaryAttribute('actor','physicalAttack',999);
  assert.equal(conditions.applyBuff('actor','dark-strike',1,effect()),false);
  assert.equal(conditions.attribute('actor','physicalAttack',100),999);
  assert.equal(conditions.applyBuff('actor','dark-strike',2,effect()),true);
  assert.equal(conditions.attribute('actor','physicalAttack',100),110);
});

test('replacement invalidates both removed and incoming keys while preserving unrelated caches',()=>{
  const conditions=new CombatConditions();
  conditions.applyBuff('actor','dark-strike',1,effect());
  for(const key of ['physicalAttack','magicAttack','criticalRate'] as const)conditions.setTemporaryAttribute('actor',key,999);
  conditions.applyBuff('actor','dark-strike',2,effect('magicAttack'));
  assert.equal(conditions.attribute('actor','physicalAttack',100),100);
  assert.equal(conditions.attribute('actor','magicAttack',100),110);
  assert.equal(conditions.attribute('actor','criticalRate',100),999);
});

test('buff removal and natural expiry invalidate matching caches; absent removal is inert',()=>{
  for(const remove of [(conditions:CombatConditions)=>conditions.removeBuff('actor','dark-strike'),(conditions:CombatConditions)=>conditions.update(120)]){
    const conditions=new CombatConditions();
    conditions.applyBuff('actor','dark-strike',1,effect());
    conditions.setTemporaryAttribute('actor','physicalAttack',999);
    conditions.setTemporaryAttribute('actor','magicAttack',888);
    conditions.removeBuff('actor','phantom-clash');
    assert.equal(conditions.attribute('actor','physicalAttack',100),999);
    remove(conditions);
    assert.equal(conditions.attribute('actor','physicalAttack',100),100);
    assert.equal(conditions.attribute('actor','magicAttack',100),888);
  }
});

test('state-only buffs do not invalidate attributes and actor removal clears all its cached values',()=>{
  const conditions=new CombatConditions();
  conditions.setTemporaryAttribute('actor','physicalAttack',999);
  conditions.applyBuff('actor','dark-strike',1,{...effect(),modifiers:[],states:['stun']});
  conditions.removeState('actor','stun');
  assert.equal(conditions.attribute('actor','physicalAttack',100),999);
  conditions.remove('actor');assert.equal(conditions.attribute('actor','physicalAttack',100),100);
});

test('numeric attribute snapshots restore a fixed value without replaying the original operation',()=>{
  const conditions=new CombatConditions();
  conditions.setTemporaryAttribute('actor','physicalAttack',240);
  const saved=conditions.captureState();conditions.clear();conditions.restoreState(saved);
  assert.equal(conditions.attribute('actor','physicalAttack',500),240);
  conditions.setTemporaryAttribute('actor','physicalAttack',241);
  assert.equal(saved.temporary[0][1][0][1],240);
});

test('attack component buffs invalidate best normal damage on accept and remove, while weak rejection preserves it',()=>{
  for(const key of ['physicalAttack','physicalDamageRate','magicAttack','magicDamageRate'] as const){
    const conditions=new CombatConditions();
    conditions.setTemporaryAttribute('actor','bestNormalDamage',999);
    conditions.applyBuff('actor','dark-strike',2,effect(key));
    assert.equal(conditions.attribute('actor','bestNormalDamage',120),120,key);
    conditions.setTemporaryAttribute('actor','bestNormalDamage',777);
    assert.equal(conditions.applyBuff('actor','dark-strike',1,effect(key)),false);
    assert.equal(conditions.attribute('actor','bestNormalDamage',130),777,key);
    conditions.removeBuff('actor','dark-strike');
    assert.equal(conditions.attribute('actor','bestNormalDamage',100),100,key);
    conditions.setTemporaryAttribute('actor','bestNormalDamage',555);
    conditions.applyBuff('actor','dark-strike',2,effect('criticalRate'));
    conditions.removeBuff('actor','dark-strike');
    assert.equal(conditions.attribute('actor','bestNormalDamage',200),555,key);
  }
});
