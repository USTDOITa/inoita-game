import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleBuffEffect,BattleCatalog} from '../src/domain/battle.ts';
import {resolveCueTargets,type Combatant} from '../src/domain/combat.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import type {PartyBuffSlot} from '../src/domain/party-buff-targets.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const skill=catalog.skills['spirit-of-nature'];
const heal=skill.action!.combatUnits![0] as {effect:'heal';attributeWeights:Record<string,number>;
  ranks:{operation:{kind:'multiply-thousandth';ratePerThousand:number}}[]};
const buff=skill.action!.combatUnits![1] as {effect:'buff';buff:'spirit-of-nature';ranks:{strength:number;effect:BattleBuffEffect}[]};
const cues=skill.action!.events!.find(event=>event.kind==='units')!.cues!;
const healRates=[4600,5000,5400,6000,6200,6400,6600,6800];
const recoveryRates=[300,380,460,580,620,660,700,740];

test('eight ranks heal the whole party and then buff them from an unlimited distance',()=>{
  assert.equal(heal.attributeWeights.mentality,12);
  heal.ranks.forEach((rank,index)=>assert.deepEqual(rank.operation,{kind:'multiply-thousandth',ratePerThousand:healRates[index]},`heal ${index+1}`));
  assert.deepEqual(cues.map(cue=>[cue.target,cue.targetRangePx]),[['party',0],['party',0]]);
  assert.deepEqual(cues.map(cue=>cue.targetSelection),['search','reuse-previous']);
  buff.ranks.forEach((rank,index)=>{
    const effect=rank.effect;
    assert.deepEqual(effect.modifiers,[
      {attribute:'healthRecoveryPerPulse',operation:{kind:'increase-thousandth',ratePerThousand:recoveryRates[index]}},
      {attribute:'manaRecoveryPerPulse',operation:{kind:'increase-thousandth',ratePerThousand:recoveryRates[index]}}],`buff ${index+1}`);
    assert.equal(effect.simulationFrames?.lastActiveFrame,90);
    assert.equal(effect.durationMs,91*60);assert.equal(effect.maxStacks,1);
  });
});

test('the recovery bonus scales both per-pulse amounts and ends after the inclusive ninetieth frame',()=>{
  const conditions=new CombatConditions(),base=100;
  assert.equal(conditions.attribute('hero','healthRecoveryPerPulse',base),base);
  conditions.applyBuff('hero','spirit-of-nature',2002,buff.ranks[0]!.effect,'caster');
  assert.equal(conditions.attribute('hero','healthRecoveryPerPulse',base),130);
  assert.equal(conditions.attribute('hero','manaRecoveryPerPulse',8),10);
  conditions.update(90*60);
  assert.equal(conditions.hasBuff('hero','spirit-of-nature'),true);
  conditions.update(60);assert.equal(conditions.hasBuff('hero','spirit-of-nature'),true);
  conditions.update(60);
  assert.equal(conditions.hasBuff('hero','spirit-of-nature'),false);
  assert.equal(conditions.attribute('hero','healthRecoveryPerPulse',base),base);
  assert.equal(conditions.attribute('hero','manaRecoveryPerPulse',8),8);
});

test('the target list is the three party slots including the caster at any distance',()=>{
  const actor=(id:string,team:string,x:number):Combatant=>({id,team,position:{x,y:0},bounds:{x:-4,y:-4,width:8,height:8}});
  const caster=actor('player','party',0),near=actor('ally','party',5000),far=actor('third','party',9600);
  const slots:readonly (PartyBuffSlot<Combatant>|undefined)[]=[
    {actor:caster,active:true,hasDisplay:true},{actor:near,active:true,hasDisplay:true},{actor:far,active:true,hasDisplay:true}];
  // 范围 0 表示不限距离：再远的队员也进目标表，列表顺序就是队伍槽顺序。
  assert.deepEqual(resolveCueTargets(cues[0]!,caster,undefined,[caster,near,far],slots).map(target=>target.id),
    ['player','ally','third']);
  const inactive:readonly (PartyBuffSlot<Combatant>|undefined)[]=[
    {actor:caster,active:true,hasDisplay:true},{actor:near,active:false,hasDisplay:true},{actor:far,active:true,hasDisplay:false}];
  assert.deepEqual(resolveCueTargets(cues[0]!,caster,undefined,[caster,near,far],inactive).map(target=>target.id),['player']);
  // 第二个单元沿用同一批目标，不再重新搜索。
  assert.equal(cues[1]!.targetSelection,'reuse-previous');
});
