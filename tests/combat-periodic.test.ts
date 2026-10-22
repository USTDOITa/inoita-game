import test from 'node:test';
import assert from 'node:assert/strict';
import type { BattleBuffEffect, CombatOperation } from '../src/domain/battle.ts';
import { resolvePeriodicEffect, type PeriodicContext, type PeriodicSource } from '../src/domain/combat-periodic.ts';

const source:PeriodicSource={classId:'warrior',lifeFeastRate:0,
  attributes:{physicalAttack:101,magicAttack:151,physicalDamageRate:200,magicDamageRate:300,stealthDamageRate:100,
    maxHealth:900,primaryAttributes:{strength:0,dexterity:0,vitality:0,intelligence:23,mentality:19}},
  attributeValue:attribute=>{assert.equal(attribute,'bestNormalDamage');return 196;}};
const context:PeriodicContext={source,buffId:'light-command',stackCount:1,targetHealingRate:1000};
const operation:CombatOperation={kind:'keep'};
const resolve=(effect:BattleBuffEffect['periodic'][number],changes:Partial<PeriodicContext>={})=>resolvePeriodicEffect(effect,{...context,...changes});

test('periodic normal damage follows source class and its own physical or magic bonuses',()=>{
  for(const [classId,amount] of [['warlock',196],['priest',196],['warrior',131],['assassin',131],[null,131]] as const)
    assert.deepEqual(resolve({kind:'normal-damage',operation},{source:{...source,classId}}),[{kind:'damage-target',amount}]);
});

test('periodic explicit attack source differs from raw attack and from best normal damage',()=>{
  assert.deepEqual(resolve({kind:'attack-damage',source:'physical',operation}),[{kind:'damage-target',amount:131}]);
  assert.deepEqual(resolve({kind:'attack-damage',source:'magic',operation}),[{kind:'damage-target',amount:196}]);
  assert.deepEqual(resolve({kind:'attribute-damage',attribute:'bestNormalDamage',operation}),[{kind:'damage-target',amount:196}]);
});

test('light command scales by target healing rate, truncates MEN separately, then applies stacked operand',()=>{
  assert.deepEqual(resolve({kind:'healing',attribute:'bestNormalDamage',operation:{kind:'multiply-thousandth',ratePerThousand:333}},
    {targetHealingRate:1234,stackCount:3}),[{kind:'heal-target',amount:241}]);
  assert.deepEqual(resolve({kind:'healing',attribute:'bestNormalDamage',operation},{targetHealingRate:0}),[{kind:'heal-target',amount:1}]);
  assert.deepEqual(resolve({kind:'healing',attribute:'bestNormalDamage',operation},{buffId:'fire-offering',targetHealingRate:0}),[{kind:'heal-target',amount:0}]);
});

test('all periodic operations multiply their operand by stacks before one calculation',()=>{
  const cases:[CombatOperation,number][]=[
    [{kind:'keep'},196],[{kind:'set',amount:7},21],[{kind:'add',amount:7},217],
    [{kind:'subtract',amount:7},175],[{kind:'multiply',factor:2},1176],[{kind:'divide',divisor:2},32],
    [{kind:'multiply-thousandth',ratePerThousand:100},58],
    [{kind:'increase-thousandth',ratePerThousand:100},254],[{kind:'decrease-thousandth',ratePerThousand:100},137],
    [{kind:'divide',divisor:0},0],
  ];
  for(const [operation,amount] of cases)
    assert.deepEqual(resolve({kind:'attribute-damage',attribute:'bestNormalDamage',operation},{stackCount:3}),[{kind:'damage-target',amount}],operation.kind);
});

test('blood curse uses raw magic attack and separately truncated mentality without magic damage bonuses',()=>{
  assert.deepEqual(resolve({kind:'magic-curse',ratePerThousand:333},{stackCount:2}),
    [{kind:'heal-source',amount:130},{kind:'damage-target',amount:130}]);
  assert.deepEqual(resolve({kind:'magic-curse',ratePerThousand:333},{stackCount:2,source:{...source,lifeFeastRate:255}}),
    [{kind:'heal-party',amount:163},{kind:'damage-target',amount:163}]);
  assert.deepEqual(resolve({kind:'magic-curse',ratePerThousand:333},{source:{...source,lifeFeastRate:-10}}),
    [{kind:'heal-source',amount:65},{kind:'damage-target',amount:65}]);
  // 血咒自带的吸血表现随命令一起给出，由施放者给每名实际恢复到的角色各播一次。
  assert.deepEqual(resolve({kind:'magic-curse',ratePerThousand:333,healEffect:'life-drain'},
    {stackCount:2,source:{...source,lifeFeastRate:255}}),
    [{kind:'heal-party',amount:163,effect:'life-drain'},{kind:'damage-target',amount:163}]);
});

test('fixed damage stacks and visual commands preserve the original effect',()=>{
  assert.deepEqual(resolve({kind:'fixed-damage',amount:17},{stackCount:3,source:null}),[{kind:'damage-target',amount:51}]);
  assert.deepEqual(resolve({kind:'visual',effect:'holy-glow'},{source:null}),[{kind:'visual',effect:'holy-glow'}]);
});

test('missing source only has an explicit zero base for class-based normal damage',()=>{
  assert.deepEqual(resolve({kind:'normal-damage',operation:{kind:'add',amount:7}},{source:null,stackCount:2}),[{kind:'damage-target',amount:14}]);
  for(const effect of [
    {kind:'attack-damage',source:'magic',operation},{kind:'attribute-damage',attribute:'bestNormalDamage',operation},
    {kind:'healing',attribute:'bestNormalDamage',operation},{kind:'magic-curse',ratePerThousand:100},
  ] as const)assert.throws(()=>resolve(effect,{source:null}),/requires its source actor/);
});

test('content requires an explicit physical or magic source for attack-based periodic damage',async()=>{
  const {readFileSync}=await import('node:fs');
  const {parseBattle}=await import('../src/application/content-validation.ts');
  const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8'));
  const unit=catalog.skills['fire-offering'].action.combatUnits.find((unit:{effect:string})=>unit.effect==='buff');
  const periodic=unit.ranks[0].effect.periodic[0];
  assert.equal(periodic.kind,'attack-damage');
  assert.equal(periodic.source,'magic');
  parseBattle(catalog);
  delete periodic.source;
  assert.throws(()=>parseBattle(catalog),/source/);
});
