import assert from 'node:assert/strict';
import test from 'node:test';
import {baseOffhandAttackChance,chooseDualWield,offhandPhysicalAttack} from '../src/domain/dual-wield.ts';

test('offhand chance uses the offhand weapon and body armor only for the eligible classes',()=>{
  for(const role of ['assassin','warrior'])for(const [kind,chance] of [['dagger',140],['longsword',100],['axe',90],['mace',90],['shield',0],['staff',0],['empty',0]] as const){
    assert.equal(baseOffhandAttackChance(role,kind,'plate'),chance);
    assert.equal(baseOffhandAttackChance(role,kind,'leather'),chance+50);
  }
  for(const role of ['priest','warlock','ranger','dark-knight'])assert.equal(baseOffhandAttackChance(role,'dagger','leather'),0);
});

test('dual wield draws once before reading chance and uses the strict native threshold',()=>{
  for(const [chance,roll,expected] of [[0,1,false],[199,199,false],[200,199,true],[1000,999,true],[-1,1,false]] as const){
    const order:string[]=[];
    assert.equal(chooseDualWield('warrior',true,{random:()=>{order.push('roll');return (roll-.5)/999;},chance:()=>{order.push('chance');return chance;}}),expected);
    assert.deepEqual(order,['roll','chance']);
  }
  const forbidden=()=>assert.fail('ineligible attacks do not roll or read the offhand chance');
  assert.equal(chooseDualWield('warrior',false,{random:forbidden,chance:forbidden}),false);
  assert.equal(chooseDualWield('priest',true,{random:forbidden,chance:forbidden}),false);
});

test('offhand power removes main weapon power before halving with negative odd values rounded down',()=>{
  assert.equal(offhandPhysicalAttack(100,60,40),60);
  assert.equal(offhandPhysicalAttack(99,60,40),59);
  assert.equal(offhandPhysicalAttack(59,60,40),39);
  assert.equal(offhandPhysicalAttack(101,0,40),90);
});
