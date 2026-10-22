import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import type {BattleBuffEffect} from '../src/domain/battle.ts';
import {rollMagicHit,rollPhysicalHit,type PhysicalFighter} from '../src/domain/physical-hit.ts';

const fighter:PhysicalFighter={level:10,physicalAttack:100,magicAttack:160,hitBase:100,hitBonus:0,
  evasionBase:0,evasionBonus:0,criticalRate:0,criticalResistance:0,criticalDamage:1000,
  criticalDamageResistance:0,weaponBlock:0,shieldBlock:0,physicalResistance:0,magicResistance:0};
const hit=()=>0.9;

test('stealth enablement is independent from the damage rate and a visible state',()=>{
  const conditions=new CombatConditions();
  conditions.applyState('actor','stealthed',10000);
  conditions.setTemporaryAttribute('actor','stealthDamageRate',736);
  let source=conditions.fighter('actor',fighter);
  assert.equal(source.physicalAttack,100);
  assert.equal(rollPhysicalHit(source,fighter,hit,100,0,0,()=>100).damage,100);
  conditions.removeState('actor','stealthed');
  conditions.setTemporaryAttribute('actor','stealthAttackEnabled',1);
  source=conditions.fighter('actor',fighter);
  assert.equal(source.physicalAttack,173);
  assert.equal(rollPhysicalHit(source,fighter,hit,100,0,0,()=>100).damage,346);
  conditions.setTemporaryAttribute('actor','stealthDamageRate',0);
  source=conditions.fighter('actor',fighter);
  assert.equal(rollPhysicalHit(source,fighter,hit,100,0,0,()=>100).damage,200);
});

test('normal physical damage applies stealth in its source and hit stages without a skill-only term',()=>{
  const conditions=new CombatConditions();
  conditions.setTemporaryAttribute('actor','stealthAttackEnabled',1);
  conditions.setTemporaryAttribute('actor','stealthDamageRate',736);
  const source=conditions.fighter('actor',fighter);
  assert.equal(source.physicalAttack,173);
  assert.equal(rollPhysicalHit(source,fighter,hit).damage,300);
});

test('ordinary stealth modifier totals clamp at zero while explicit cached values retain their sign',()=>{
  const conditions=new CombatConditions();
  const probe:BattleBuffEffect={durationMs:10000,tickMs:0,states:[],periodic:[],modifiers:[
    {attribute:'stealthDamageRate',operation:{kind:'add',amount:-736}},
  ]};
  conditions.applyBuff('actor','whist',1,probe,'probe');
  conditions.setTemporaryAttribute('actor','stealthAttackEnabled',1);
  let source=conditions.fighter('actor',fighter);
  assert.equal(source.stealthDamageRate,0);
  assert.equal(rollPhysicalHit(source,fighter,hit,100,0,0,()=>100).damage,200);
  conditions.setTemporaryAttribute('actor','stealthDamageRate',-736);
  source=conditions.fighter('actor',fighter);
  assert.equal(source.stealthDamageRate,-736);
  assert.equal(rollPhysicalHit(source,fighter,hit,100,0,0,()=>100).damage,52);
});

test('physical skill damage truncates its main and raw-attack additions independently',()=>{
  const source={...fighter,physicalDamageRate:137,stealthAttackEnabled:true,stealthDamageRate:736};
  assert.equal(rollPhysicalHit(source,fighter,hit,104,0,0,()=>101).damage,369);
  assert.equal(rollPhysicalHit(source,fighter,hit,104,200,0,()=>101).damage,390);
  assert.equal(rollPhysicalHit(source,fighter,hit,104,0,0,()=>0).damage,194);
});

test('both stealth terms are included before weapon block, shield block, resistance and critical damage',()=>{
  const source={...fighter,physicalDamageRate:137,stealthAttackEnabled:true,stealthDamageRate:736};
  assert.deepEqual(rollPhysicalHit(source,{...fighter,weaponBlock:500},()=>0.2,104,0,0,()=>101),{kind:'weapon-block',damage:258});
  assert.deepEqual(rollPhysicalHit(source,{...fighter,shieldBlock:500},()=>0.2,104,0,0,()=>101),{kind:'shield-block',damage:76});
  assert.equal(rollPhysicalHit(source,{...fighter,physicalResistance:200},hit,104,0,0,()=>101).damage,295);
  assert.deepEqual(rollPhysicalHit({...source,criticalRate:500},fighter,()=>0.2,104,0,0,()=>101),{kind:'critical',damage:738});
});

test('raw skill attack is read lazily only for an enabled non-miss and preserves a zero attack value',()=>{
  const source={...fighter,stealthAttackEnabled:true,stealthDamageRate:736};
  const target={...fighter,evasionBonus:750};
  let reads=0;
  const attack=()=>{reads++;return 0;};
  assert.deepEqual(rollPhysicalHit(source,target,()=>0,100,0,0,attack),{kind:'miss',damage:0});
  assert.equal(reads,0);
  assert.equal(rollPhysicalHit({...source,stealthAttackEnabled:false},fighter,hit,100,0,0,attack).damage,100);
  assert.equal(reads,0);
  assert.equal(rollPhysicalHit(source,fighter,hit,100,0,0,attack).damage,173);
  assert.equal(reads,1);
});

test('magic hit calculation does not apply physical stealth modifiers to its prepared source',()=>{
  const source={...fighter,stealthAttackEnabled:true,stealthDamageRate:736};
  assert.equal(rollMagicHit(source,fighter,173,hit).damage,173);
  assert.equal(rollMagicHit(source,fighter,160,hit).damage,160);
});
