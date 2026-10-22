import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseBattle} from '../src/application/content-validation.ts';
import {actionDamage,prepareActionDamage,resolvePreparedActionDamage} from '../src/domain/action-damage.ts';
import {actionDamageSource,type ActionDamageSource} from '../src/domain/combat-damage-source.ts';
import type {NumericCombatUnit} from '../src/domain/battle.ts';

const catalog=parseBattle(JSON.parse(fs.readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')));
const caster:ActionDamageSource={physicalAttack:100,magicAttack:50,maxHealth:792,bestNormalDamage:100,
  primaryAttributes:{strength:10,dexterity:0,vitality:0,intelligence:20,mentality:0}};

test('ranked dark strike uses its native action unit formula and five primary attributes',()=>{
  const units=catalog.skills['dark-strike'].action!.combatUnits!;
  assert.equal(units.length,3);
  assert.ok('source' in units[0]);
  assert.equal(actionDamage(units[0],1,caster),Math.trunc((100+12+20)*2105/1000));
  assert.equal(actionDamage(units[0],2,caster),Math.trunc((100+12+20)*2305/1000));
  assert.equal(units[2].effect,'buff');
});

test('primary attributes combine before truncation and rank selection clamps to available data',()=>{
  const unit={effect:'physical' as const,source:'none' as const,
    attributeWeights:{strength:3,dexterity:3,vitality:3,intelligence:0,mentality:0},
    ranks:[{fixedAddition:1,operation:{kind:'multiply' as const,factor:2}},
           {fixedAddition:2,operation:{kind:'divide' as const,divisor:2}}]};
  const source={...caster,primaryAttributes:{strength:2,dexterity:2,vitality:2,intelligence:0,mentality:0}};
  assert.equal(actionDamage(unit,0,source),4);
  assert.equal(actionDamage(unit,100,source),1);
});


test('each formula source reads its named actor value without reusing boosted physical attack',()=>{
  const source=actionDamageSource({physicalAttack:101,magicAttack:151,maxHealth:792,
    physicalDamageRate:200,magicDamageRate:100,stealthDamageRate:0,
    primaryAttributes:{strength:0,dexterity:0,vitality:0,intelligence:0,mentality:0}});
  const unit:NumericCombatUnit={effect:'physical',source:'none',attributeWeights:{strength:0,dexterity:0,vitality:0,intelligence:0,mentality:0},
    ranks:[{fixedAddition:0,operation:{kind:'keep'}}]};
  for(const [kind,expected] of [['physicalAttack',101],['magicAttack',151],['bestNormalDamage',166],['maxHealth',792],['none',0]] as const)
    assert.equal(actionDamage({...unit,source:kind},1,source),expected,kind);
});

test('monster and summon formulas use their own zero primary attributes and attack sources',()=>{
  const unit:NumericCombatUnit={effect:'magic',source:'bestNormalDamage',
    attributeWeights:{strength:5,dexterity:5,vitality:5,intelligence:10,mentality:12},
    ranks:[{fixedAddition:7,operation:{kind:'multiply-thousandth',ratePerThousand:1500}}]};
  const primaryAttributes={strength:0,dexterity:0,vitality:0,intelligence:0,mentality:0};
  const monster=actionDamageSource({physicalAttack:81,magicAttack:121,maxHealth:550,
    physicalDamageRate:100,magicDamageRate:200,stealthDamageRate:0,primaryAttributes});
  const summon=actionDamageSource({physicalAttack:61,magicAttack:41,maxHealth:350,
    physicalDamageRate:200,magicDamageRate:0,stealthDamageRate:0,primaryAttributes});
  assert.equal(actionDamage(unit,1,monster),228);
  assert.equal(actionDamage(unit,1,summon),120);
});

test('unit preparation copies its formula and primary contribution while source values stay current',()=>{
  const primaryAttributes={strength:3,dexterity:0,vitality:0,intelligence:2,mentality:0};
  const operation={kind:'multiply-thousandth' as const,ratePerThousand:1500};
  const unit:NumericCombatUnit={effect:'magic',source:'bestNormalDamage',
    attributeWeights:{strength:3,dexterity:0,vitality:0,intelligence:4,mentality:0},
    ranks:[{fixedAddition:7,operation}]};
  const prepared=prepareActionDamage(unit,1,primaryAttributes)!;
  primaryAttributes.strength=100;
  unit.ranks[0].fixedAddition=300;
  operation.ratePerThousand=3000;
  assert.deepEqual(prepared,{source:'bestNormalDamage',weightedAddition:1,fixedAddition:7,
    operation:{kind:'multiply-thousandth',ratePerThousand:1500}});
  assert.equal(resolvePreparedActionDamage(prepared,100),162);
  assert.equal(resolvePreparedActionDamage(prepared,200),312);
  assert.equal(prepareActionDamage(unit,1,primaryAttributes)!.weightedAddition,30);
});

test('prepared healing omits fixed addition and a none source ignores caller values',()=>{
  const unit:NumericCombatUnit={effect:'heal',source:'none',
    attributeWeights:{strength:10,dexterity:0,vitality:0,intelligence:0,mentality:0},
    ranks:[{fixedAddition:999,operation:{kind:'keep'}}]};
  const prepared=prepareActionDamage(unit,1,caster.primaryAttributes)!;
  assert.equal(resolvePreparedActionDamage(prepared,500),10);
  assert.equal(prepareActionDamage({...unit,ranks:[]},1,caster.primaryAttributes),undefined);
});
