import test from 'node:test';
import assert from 'node:assert/strict';
import {actionDamageSource,bestNormalDamage,physicalNormalDamage,type DamageAttributes} from '../src/domain/combat-damage-source.ts';

const caster:DamageAttributes={physicalAttack:101,magicAttack:151,physicalDamageRate:200,magicDamageRate:100,stealthDamageRate:0};

test('ordinary physical damage and a skill normal-damage source follow different native branches',()=>{
  assert.equal(physicalNormalDamage(caster),121);
  assert.equal(bestNormalDamage(caster),166);
});

test('stealth adds to the physical rate before truncation and before choosing the stronger source',()=>{
  assert.equal(physicalNormalDamage({...caster,stealthDamageRate:750}),196);
  assert.equal(bestNormalDamage({...caster,stealthDamageRate:750}),196);
});

test('both candidates are truncated separately, with a stable tie',()=>{
  assert.equal(bestNormalDamage({...caster,physicalAttack:10,magicAttack:10,physicalDamageRate:99,magicDamageRate:1}),10);
});


test('complete actor sources preserve raw attacks and snapshot only their own primary attributes',()=>{
  const primaryAttributes={strength:7,dexterity:11,vitality:13,intelligence:17,mentality:19};
  const source=actionDamageSource({...caster,maxHealth:792,primaryAttributes});
  assert.deepEqual(source,{physicalAttack:101,magicAttack:151,maxHealth:792,bestNormalDamage:166,primaryAttributes});
  primaryAttributes.intelligence=999;
  assert.equal(source.primaryAttributes.intelligence,17);
});
