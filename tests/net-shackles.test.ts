import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleBuffEffect,BattleCatalog} from '../src/domain/battle.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {selectStateDurationProfile} from '../src/domain/state-application.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const skill=catalog.skills['net-shackles'];
const damage=skill.action!.combatUnits![0] as {effect:'physical';attributeWeights:Record<string,number>;ranks:{operation:{kind:'multiply-thousandth';ratePerThousand:number}}[]};
const buff=skill.action!.combatUnits![1] as {effect:'buff';buff:'net-shackles';ranks:{strength:number;effect:BattleBuffEffect}[]};
const cues=skill.action!.events!.find(event=>event.kind==='units')!.cues!;
const rates=[1960,2120,2280,2440,2520,2600,2680,2760];
const caps=[30,30,45,60,60,60,75,75];

test('eight ranks keep the dexterity weighting, the octagonal area and their reused targets',()=>{
  assert.equal(damage.attributeWeights.dexterity,12);
  assert.deepEqual(cues.map(cue=>[cue.target,cue.targetRangePx,cue.targetRangeMetric]),
    [['area',72,'octagonal-grid'],['area',72,'octagonal-grid']]);
  assert.deepEqual(cues.map(cue=>cue.targetSelection),['search','reuse-previous']);
  damage.ranks.forEach((rank,index)=>assert.deepEqual(rank.operation,{kind:'multiply-thousandth',ratePerThousand:rates[index]}));
});

test('the root is a named state under the inclusive frame cap with its own loop visual',()=>{
  buff.ranks.forEach((rank,index)=>{
    const effect=rank.effect;
    assert.deepEqual(effect.states,['immobilized'],`rank ${index+1}`);
    assert.equal(effect.simulationFrames?.lastActiveFrame,caps[index]);
    assert.equal(effect.durationMs,(caps[index]+1)*60);assert.equal(effect.maxStacks,1);
    assert.deepEqual(effect.loopEffects,[{effect:'binding-chains-fade',firstFrameAge:1}]);
    assert.deepEqual(effect.stateDurationProfiles!.immobilized!.normal,{lastActiveFrame:Math.trunc(caps[index]*15/10)});
  });
});

test('the root stops movement but not attacks, and expires with its buff',()=>{
  const conditions=new CombatConditions();
  assert.equal(conditions.canMove('target'),true);
  conditions.applyBuff('target','net-shackles',3003,buff.ranks[0]!.effect,'caster');
  assert.equal(conditions.canMove('target'),false);
  assert.equal(conditions.canAct('target'),true);
  assert.equal(conditions.canTarget('target'),true);
  // 上限是含端点的第 30 帧：第 31 步仍有效，第 32 步处理时才移除。
  conditions.update(30*60);
  assert.equal(conditions.hasState('target','immobilized'),true);
  conditions.update(60);
  assert.equal(conditions.hasBuff('target','net-shackles'),true);
  assert.equal(conditions.canMove('target'),false);
  conditions.update(60);
  assert.equal(conditions.hasBuff('target','net-shackles'),false);
  assert.equal(conditions.hasState('target','immobilized'),false);
  assert.equal(conditions.canMove('target'),true);
});

test('a shortened or rejecting target changes only the root, not the buff',()=>{
  const effect=buff.ranks[0]!.effect;
  assert.deepEqual(selectStateDurationProfile(effect.stateDurationProfiles!.immobilized!,{allowed:true,durationScale:0.5,buffDurationScale:1,frameDurationScale:1}),
    {lastActiveFrame:22});
  const conditions=new CombatConditions();
  // 状态被拒不会退回整个增益：原版返回的成功只取决于增益本身。
  const accepted=conditions.applyBuff('target','net-shackles',3003,effect,'caster',()=>false);
  assert.equal(accepted,true);
  assert.equal(conditions.hasState('target','immobilized'),false);
  assert.equal(conditions.hasBuff('target','net-shackles'),true);
});
