import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import test from 'node:test';
import type {BattleCatalog,SummonOwnerDerivation} from '../src/domain/battle.ts';
import {summonLifetimeFrames,summonOwnerStats} from '../src/domain/summon-stats.ts';

const phaser=registerHooks({resolve(specifier,context,next){
  return specifier==='phaser'?{url:'data:text/javascript,export default {BlendModes:{},Scene:class{},Physics:{Arcade:{Body:class{}}}}',shortCircuit:true}:next(specifier,context);
}});
const {WorldCombat}=await import('../src/scenes/world-combat.ts');
phaser.deregister();
const method=(name:string)=>Reflect.get(WorldCombat.prototype,name);

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const unit=catalog.skills['beast-companion'].action!.combatUnits![0] as {
  effect:'summon';creature:string;ownerDerived:SummonOwnerDerivation;
  lifetimeFromOwner:{attribute:string;perPoint:number;base:number};
  ranks:{durationMs:number;simulationFrames?:{lastActiveFrame:number};healthRatePerThousand?:number;tauntChanceThreshold?:number}[]};
const healthRates=[600,800,1100,1500,1600,1700,1800,1900];
const taunts=[40,60,90,130,140,150,160,170];

test('eight ranks keep the health bonus, the taunt chance and the owner-driven lifetime rule',()=>{
  assert.equal(unit.creature,'enemy-beast-companion-1');
  assert.deepEqual(unit.ownerDerived,{attack:{attribute:'physicalAttack',perLevel:3,flat:9},
    health:{perLevel:120,flat:1000},physicalResistanceBonus:250,magicResistance:120});
  assert.deepEqual(unit.lifetimeFromOwner,{attribute:'summonDurationBonus',perPoint:150,base:150000});
  unit.ranks.forEach((rank,index)=>{
    assert.equal(rank.healthRatePerThousand,healthRates[index],`rank ${index+1}`);
    assert.equal(rank.tauntChanceThreshold,taunts[index]);
    assert.equal(rank.simulationFrames?.lastActiveFrame,225);assert.equal(rank.durationMs,226*60);
  });
});

test('the beast derives 3L+9 attack and a bonus-scaled health pool',()=>{
  assert.deepEqual(summonOwnerStats(unit.ownerDerived,unit.ranks[0]!,10),
    {physicalAttack:39,maxHealth:3520,physicalResistanceBonus:250,magicResistance:120});
  assert.equal(summonOwnerStats(unit.ownerDerived,unit.ranks[7]!,10).maxHealth,6380);
  assert.equal(summonOwnerStats(unit.ownerDerived,unit.ranks[0]!,1).physicalAttack,12);
  assert.equal(summonOwnerStats(unit.ownerDerived,unit.ranks[0]!,1).maxHealth,1792);
});

test('the beast lifetime converts the owner bonus before the frame conversion',()=>{
  assert.equal(summonLifetimeFrames(unit.lifetimeFromOwner,0),225);
  assert.equal(summonLifetimeFrames(unit.lifetimeFromOwner,300),292);
  assert.equal(summonLifetimeFrames(unit.lifetimeFromOwner,1300),517);
  assert.equal(summonLifetimeFrames(unit.lifetimeFromOwner,1000),450);
});

test('a beast that hits a target which is not attacking it rolls its owner taunt chance',t=>{
  t.mock.method(Math,'random',()=>0.01);
  const calls:string[]=[];
  let targetOfEnemy='player';
  const host=Object.setPrototypeOf({arena:[{key:'beast',summonedBy:'player',summonTauntChance:40}],
    threat:{taunt:(source:string,target:string)=>calls.push(`${source}->${target}`)},
    enemyTarget:()=>targetOfEnemy},WorldCombat.prototype);
  const event={casterId:'beast',targetId:'enemy'};
  method('summonOwnerReactions').call(host,event,{kind:'hit',damage:5},'physical');
  assert.deepEqual(calls,['beast->enemy']);
  calls.length=0;
  targetOfEnemy='beast';
  method('summonOwnerReactions').call(host,event,{kind:'hit',damage:5},'physical');
  assert.deepEqual(calls,[],'目标已经在打它就不抽');
  targetOfEnemy='player';
  method('summonOwnerReactions').call(host,event,{kind:'miss',damage:0},'physical');
  assert.deepEqual(calls,[],'落空不抽');
  host.arena[0]!.summonTauntChance=0;
  method('summonOwnerReactions').call(host,event,{kind:'hit',damage:5},'physical');
  assert.deepEqual(calls,[],'机会为 0 不抽');
});
