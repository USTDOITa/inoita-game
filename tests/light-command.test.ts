import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleBuffEffect,BattleCatalog} from '../src/domain/battle.ts';
import {resolveCueTargets,type Combatant} from '../src/domain/combat.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {resolvePeriodicEffect} from '../src/domain/combat-periodic.ts';
import type {PartyBuffSlot} from '../src/domain/party-buff-targets.ts';

const cat=(name:string)=>JSON.parse(readFileSync(new URL(`../public/content/${name}.json`,import.meta.url),'utf8'));
const catalog=cat('battle') as BattleCatalog,skill=catalog.skills['light-command'];
const unit=skill.action!.combatUnits![0] as {effect:'buff';buff:'light-command';ranks:{strength:number;chanceThreshold:number;effect:BattleBuffEffect}[]};
const cue=skill.action!.events!.find(event=>event.kind==='units')!.cues![0];
const rates=[920,1000,1080,1200,1240,1280,1320,1360];

test('eight ranks keep the original tick interval, cap and both buff visuals',()=>{
  assert.deepEqual(cue.target,'party');
  assert.equal(cue.targetRangePx,88);
  assert.equal(cue.targetRangeMetric,'octagonal-grid');
  assert.deepEqual(cue.effects,[{effect:'energy-column',recipient:'target',placement:'attached'}]);
  unit.ranks.forEach((rank,index)=>{
    const effect=rank.effect;
    assert.equal(effect.simulationFrames?.lastActiveFrame,300,`rank ${index+1}`);
    assert.equal(effect.simulationFrames?.pulseIntervalFrames,30);
    assert.equal(effect.durationMs,301*60);assert.equal(effect.tickMs,1800);assert.equal(effect.maxStacks,1);
    assert.equal(effect.applicationEffect,'energy-column');
    assert.deepEqual(effect.loopEffects,[{effect:'sparks-red','firstFrameAge':11}]);
    assert.deepEqual(effect.periodic,[{kind:'healing',attribute:'bestNormalDamage',
      operation:{kind:'multiply-thousandth',ratePerThousand:rates[index]}}]);
  });
});

test('the tick reads the source normal damage and the target healing rate, then adds one tenth of the source mentality',()=>{
  const ranks=unit.ranks.map(rank=>rank.effect.periodic[0]);
  assert.deepEqual(resolvePeriodicEffect(ranks[0],{buffId:'light-command',stackCount:1,targetHealingRate:500,
    source:{classId:'priest',lifeFeastRate:0,
      attributes:{physicalAttack:0,magicAttack:0,maxHealth:0,physicalDamageRate:0,magicDamageRate:0,stealthDamageRate:0,
        primaryAttributes:{strength:0,dexterity:0,vitality:0,intelligence:0,mentality:40}},
      attributeValue:()=>1000}}),[{kind:'heal-target',amount:463}]);
  assert.deepEqual(resolvePeriodicEffect(ranks[7],{buffId:'light-command',stackCount:1,targetHealingRate:1000,
    source:{classId:'priest',lifeFeastRate:0,
      attributes:{physicalAttack:0,magicAttack:0,maxHealth:0,physicalDamageRate:0,magicDamageRate:0,stealthDamageRate:0,
        primaryAttributes:{strength:0,dexterity:0,vitality:0,intelligence:0,mentality:40}},
      attributeValue:()=>1000}}),[{kind:'heal-target',amount:1365}]);
});

test('the first pulse runs at age zero and the buff ends after the inclusive three hundredth frame',()=>{
  const conditions=new CombatConditions(),ages:number[]=[];let at=0;
  conditions.applyBuff('ally','light-command',1002,unit.ranks[0]!.effect,'priest');
  conditions.update(0,()=>ages.push(at));
  for(let step=1;step<=302;step++){at=step*60;conditions.update(60,()=>ages.push(at));}
  // 第一拍落在首个处理步（年龄0），此后每30帧一拍，最后一拍在年龄300。
  assert.deepEqual(ages,[60,1860,3660,5460,7260,9060,10860,12660,14460,16260,18060]);
  assert.equal(conditions.hasBuff('ally','light-command'),false);
});

test('the party query keeps all three slots including the caster and drops the far or inactive ones',()=>{
  const actor=(id:string,team:string,x:number,y:number):Combatant=>({id,team,position:{x,y},bounds:{x:-4,y:-4,width:8,height:8}});
  const caster=actor('player','party',0,0),near=actor('ally','party',48,0),far=actor('away','party',96,0);
  const slots:readonly (PartyBuffSlot<Combatant>|undefined)[]=[
    {actor:caster,active:true,hasDisplay:true},
    {actor:near,active:true,hasDisplay:true},
    {actor:far,active:true,hasDisplay:true}];
  assert.deepEqual(resolveCueTargets(cue,caster,undefined,[caster,near,far],slots).map(target=>target.id),['player','ally']);
  const inactive:readonly (PartyBuffSlot<Combatant>|undefined)[]=[
    {actor:caster,active:true,hasDisplay:true},
    {actor:near,active:false,hasDisplay:true},
    {actor:far,active:true,hasDisplay:false}];
  assert.deepEqual(resolveCueTargets(cue,caster,undefined,[caster,near,far],inactive).map(target=>target.id),['player']);
});

test('the buff keeps its own self visual unit after the party cue',()=>{
  const cues=skill.action!.events!.find(event=>event.kind==='units')!.cues!;
  assert.deepEqual(skill.action!.combatUnits!.map(entry=>entry.effect),['buff','visual']);
  assert.equal(cues.length,2);
  assert.deepEqual(cues[1],{target:'self',targetRangePx:88,targetSelection:'search',
    effects:[{effect:'ring-amber',recipient:'target',placement:'attached'}]});
});
