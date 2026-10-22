import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parseBattle} from '../src/application/content-validation.ts';
import {CombatConditions,type PeriodicTick} from '../src/domain/combat-conditions.ts';
import {resolvePeriodicEffect,type PeriodicSource} from '../src/domain/combat-periodic.ts';

const catalog=parseBattle(JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')));
const buffs=catalog.statusAttackBuffs!;

test('shared on-hit children retain source lifetimes, colors, operations and independent stun profiles',()=>{
  assert.deepEqual(buffs['attack-stun']!.simulationFrames,{lastActiveFrame:30});
  assert.equal(buffs['attack-stun']!.stateDurationProfiles!.stun!.normal.lastActiveFrame,45);
  const slow=buffs['attack-slow']!,divine=buffs['divine-defense-break']!,darkness=buffs['darkness-strike-impact']!;
  assert.deepEqual([slow.simulationFrames,divine.simulationFrames,darkness.simulationFrames],
    [{lastActiveFrame:75},{lastActiveFrame:75},{lastActiveFrame:7}]);
  assert.deepEqual([slow.durationMs,divine.durationMs,darkness.durationMs],[4560,4560,480]);
  assert.deepEqual(slow.modifiers,[{attribute:'moveSpeed',operation:{kind:'decrease-thousandth',ratePerThousand:500}},
    {attribute:'attackSpeedRate',operation:{kind:'multiply-thousandth',ratePerThousand:500}}]);
  assert.deepEqual(divine.modifiers,[{attribute:'physicalResistanceBonus',operation:{kind:'set',amount:0}},
    {attribute:'magicResistance',operation:{kind:'set',amount:0}}]);
  assert.deepEqual(slow.appearanceColors,[{red:0,green:100,blue:200}]);
  assert.deepEqual(divine.appearanceColors!.map(color=>[color.red,color.green,color.blue]),
    [140,160,180,200,180,160,140].map(value=>[value,value,value]));
  assert.deepEqual(darkness.appearanceColors!.map(color=>[color.red,color.green,color.blue]),
    [[176,136,216],[136,56,176],[96,6,136],[96,6,136],[96,6,136],[96,6,136],[96,6,136],[136,56,176],[176,136,216]]);
  for(const effect of [slow,divine,darkness,buffs.poisoned!]){
    assert.deepEqual(effect.states,[]);assert.equal(effect.applicationEffect,undefined);assert.equal(effect.loopEffects,undefined);
  }
  assert.deepEqual(darkness.modifiers,[]);assert.deepEqual(darkness.periodic,[]);
});

test('exported poison pulses at six native frame ages and uses dynamic normal damage with stacked rounding',()=>{
  const poison=buffs.poisoned!;
  assert.deepEqual(poison.simulationFrames,{lastActiveFrame:150,pulseIntervalFrames:30});
  assert.deepEqual([poison.durationMs,poison.tickMs,poison.maxStacks],[9060,1800,10]);
  assert.deepEqual(poison.periodic,[{kind:'normal-damage',operation:{kind:'multiply-thousandth',ratePerThousand:140}}]);
  assert.deepEqual(poison.appearanceColors!.map(color=>[color.red,color.green,color.blue]),
    [140,160,180,200,180,160,140].map(green=>[130,green,0]));
  const conditions=new CombatConditions(),ages:number[]=[];let frame=0;
  conditions.applyBuff('target','poisoned',0,poison,'source');
  for(frame=0;frame<=151;frame++)conditions.update(60,()=>ages.push(frame));
  assert.deepEqual(ages,[0,30,60,90,120,150]);assert.equal(conditions.hasBuff('target','poisoned'),false);
  const source:PeriodicSource={classId:'warrior',lifeFeastRate:0,attributeValue:()=>0,
    attributes:{physicalAttack:101,magicAttack:200,physicalDamageRate:0,magicDamageRate:0,stealthDamageRate:0,
      maxHealth:1000,primaryAttributes:{strength:0,dexterity:0,vitality:0,intelligence:0,mentality:0}}};
  const amount=(stackCount:number)=>resolvePeriodicEffect(poison.periodic[0],{buffId:'poisoned',stackCount,source,targetHealingRate:1000});
  assert.deepEqual(amount(3),[{kind:'damage-target',amount:42}]);
  assert.deepEqual(amount(10),[{kind:'damage-target',amount:141}]);
  source.attributes.physicalAttack=201;
  assert.deepEqual(amount(10),[{kind:'damage-target',amount:281}]);
  source.classId='warlock';assert.deepEqual(amount(10),[{kind:'damage-target',amount:280}]);
});

test('poison caps ten shared stacks and equal-priority refresh changes source and resets age',()=>{
  const conditions=new CombatConditions(),poison=buffs.poisoned!,ticks:PeriodicTick[]=[];
  for(let count=0;count<10;count++)conditions.applyBuff('target','poisoned',0,poison,'first');
  conditions.update(600);
  assert.equal(conditions.snapshot('target')[0].stackCount,10);
  conditions.applyBuff('target','poisoned',0,poison,'second');conditions.update(60,tick=>ticks.push(tick));
  assert.equal(ticks.length,1);assert.equal(ticks[0].sourceId,'second');assert.equal(ticks[0].stackCount,10);
  assert.deepEqual(conditions.appearanceColors('target'),poison.appearanceColors);
});
