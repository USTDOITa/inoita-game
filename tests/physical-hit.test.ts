import test from 'node:test';
import assert from 'node:assert/strict';
import {rollMagicHit,rollPhysicalHit,type PhysicalFighter} from '../src/domain/physical-hit.ts';

const fighter:PhysicalFighter={level:1,physicalAttack:100,hitBase:100,hitBonus:0,evasionBase:10,evasionBonus:0,
  criticalRate:100,criticalResistance:0,criticalDamage:1000,criticalDamageResistance:0,
  weaponBlock:0,shieldBlock:0,physicalResistance:200};
const fixed=(roll:number)=>()=>roll/1000;

test('one native roll partitions cumulative miss, shield, weapon and critical ranges',()=>{
  const target={...fighter,shieldBlock:100,weaponBlock:150};
  for(const [roll,kind] of [[11,'miss'],[12,'shield-block'],[111,'shield-block'],[112,'weapon-block'],
    [261,'weapon-block'],[262,'critical'],[361,'critical'],[362,'hit'],[999,'hit']] as const){
    let calls=0;
    assert.equal(rollPhysicalHit(fighter,target,()=>{calls++;return roll/1000;}).kind,kind,`roll ${roll}`);
    assert.equal(calls,1);
  }
  assert.equal(rollMagicHit(fighter,target,100,fixed(112)).kind,'critical');
  assert.equal(rollMagicHit(fighter,target,100,fixed(212)).kind,'hit');
});

test('a higher-level defender with zero block attributes cannot block',()=>{
  assert.equal(rollPhysicalHit({...fighter,criticalRate:0},{...fighter,level:50},fixed(50)).kind,'hit');
});

test('native critical damage applies bonus and resistance in separate integer steps',()=>{
  const attacker={...fighter,criticalRate:1000,criticalDamage:350};
  const target={...fighter,physicalResistance:0,criticalDamageResistance:200};
  assert.equal(rollPhysicalHit(attacker,target,fixed(50),17).damage,17);
  assert.equal(rollMagicHit(attacker,target,17,fixed(50)).damage,17);
  assert.equal(rollPhysicalHit(attacker,{...target,criticalDamageResistance:1000},fixed(50)).damage,0);
});

test('shield reduction converts block to defense for both physical and magical damage',()=>{
  const target={...fighter,shieldBlock:150,defenseRate:500,magicResistance:200};
  assert.equal(rollPhysicalHit(fighter,target,fixed(50)).damage,12);
  assert.equal(rollMagicHit(fighter,target,100,fixed(50)).damage,12);
  assert.equal(rollMagicHit(fighter,target,0,fixed(50)).damage,0);
});

test('magic level difference divides before multiplying and introduces no block or critical bonus',()=>{
  const attacker={...fighter,level:100};
  assert.equal(rollMagicHit(attacker,fighter,100,fixed(112)).kind,'hit');
  assert.equal(rollMagicHit({...attacker,level:1},{...fighter,level:100},100,fixed(111)).kind,'critical');
});

test('native physical roll applies miss, critical, block and defense at contact',()=>{
  assert.deepEqual(rollPhysicalHit(fighter,fighter,fixed(0)),{kind:'miss',damage:0});
  assert.deepEqual(rollPhysicalHit(fighter,fighter,fixed(50)),{kind:'critical',damage:160});
  assert.deepEqual(rollPhysicalHit(fighter,{...fighter,criticalRate:0,weaponBlock:150},fixed(120)),{kind:'weapon-block',damage:56});
  assert.deepEqual(rollPhysicalHit(fighter,{...fighter,criticalRate:0,shieldBlock:150},fixed(120)),{kind:'shield-block',damage:16});
  assert.deepEqual(rollPhysicalHit(fighter,{...fighter,criticalRate:0},fixed(900)),{kind:'hit',damage:80});
});
