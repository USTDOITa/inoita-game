import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {buffEffectNames} from '../src/domain/buff-effects.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {rollMagicHit,rollPhysicalHit,type PhysicalFighter} from '../src/domain/physical-hit.ts';
import type {SkillReactionBuff} from '../src/domain/skill-reactions.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const skill=catalog.skills['dark-sense'];
const ages=[45,60,75,90,105,105,120,120];
const durations=[2760,3660,4560,5460,6360,6360,7260,7260];
const owner='assassin';
function rankBuff(rank:number):SkillReactionBuff {
  const reactions=skill.reactionsByRank?.[rank-1];
  assert.ok(reactions,`missing Dark Sense rank ${rank}`);
  assert.equal(reactions.length,1);
  const reaction=reactions[0];
  assert.ok(reaction.kind==='dark-sense');
  return reaction.buff;
}
function apply(conditions:CombatConditions,rank:number):boolean {
  const buff=rankBuff(rank);
  return conditions.applyBuff(owner,buff.key,buff.rankPriority,buff.effect,owner);
}
const base:PhysicalFighter={level:1,physicalAttack:100,magicAttack:100,hitBase:100,hitBonus:0,
  evasionBase:10,evasionBonus:0,criticalRate:0,criticalResistance:0,criticalDamage:0,criticalDamageResistance:0,
  weaponBlock:0,shieldBlock:0,physicalResistance:0,magicResistance:0};

test('all eight Dark Sense ranks export one self reaction with fixed evasion and native frame lifetimes',()=>{
  assert.deepEqual(skill.passiveUnits,[]);
  assert.equal(skill.reactionsByRank?.length,8);
  for(let rank=1;rank<=8;rank++){
    const {key,rankPriority,effect}=rankBuff(rank);
    assert.equal(key,'dark-sense');assert.equal(rankPriority,[1002,1004,1006,1009,1010,1011,1012,1013][rank-1]);
    assert.deepEqual(effect.modifiers,[{attribute:'evasionBonus',operation:{kind:'add',amount:150}}]);
    assert.deepEqual(effect.simulationFrames,{lastActiveFrame:ages[rank-1]});
    assert.equal(effect.durationMs,durations[rank-1]);assert.equal(effect.tickMs,0);
    assert.equal(effect.maxStacks,1);
    assert.deepEqual(effect.states,[]);assert.deepEqual(effect.periodic,[]);
    assert.deepEqual(buffEffectNames(effect),[]);
  }
});

test('Dark Sense weak recasts preserve every stored value while equal rank refreshes a single layer',()=>{
  const conditions=new CombatConditions();
  assert.equal(apply(conditions,4),true);conditions.update(617);
  const before=conditions.captureState();
  assert.equal(apply(conditions,3),false);
  assert.deepEqual(conditions.captureState(),before);
  const remaining=conditions.snapshot(owner)[0].remainingMs;
  assert.equal(apply(conditions,4),true);
  const refreshed=conditions.snapshot(owner);
  assert.equal(refreshed.length,1);assert.equal(refreshed[0].stackCount,1);
  assert.equal(refreshed[0].sourceId,owner);assert.equal(refreshed[0].strength,1009);
  assert.ok(refreshed[0].remainingMs>remaining);
  assert.equal(conditions.attribute(owner,'evasionBonus',0),150);
  assert.equal(conditions.captureState().buffs[0][1][0].nextFrameAge,0);
  for(let repeat=0;repeat<3;repeat++)assert.equal(apply(conditions,4),true);
  assert.equal(conditions.fighter(owner,base).evasionBonus,150);
  assert.equal(conditions.snapshot(owner)[0].stackCount,1);
});

test('higher Dark Sense ranks replace lower ranks even when their duration is identical',()=>{
  for(const [lower,higher] of [[5,6],[7,8]]){
    const conditions=new CombatConditions();
    assert.equal(rankBuff(lower).effect.durationMs,rankBuff(higher).effect.durationMs);
    assert.equal(apply(conditions,lower),true);conditions.update(240);
    const remaining=conditions.snapshot(owner)[0].remainingMs;
    assert.equal(apply(conditions,higher),true);
    assert.equal(conditions.snapshot(owner)[0].strength,rankBuff(higher).rankPriority);
    assert.ok(conditions.snapshot(owner)[0].remainingMs>remaining);
    const stronger=conditions.captureState();
    assert.equal(apply(conditions,lower),false);
    assert.deepEqual(conditions.captureState(),stronger);
    assert.equal(conditions.fighter(owner,base).evasionBonus,150);
  }
});

test('Dark Sense applies immediately, processes age zero at the next boundary and expires after its last active age',()=>{
  for(let rank=1;rank<=8;rank++){
    const conditions=new CombatConditions(),lastAge=ages[rank-1];
    assert.equal(apply(conditions,rank),true);
    assert.equal(conditions.fighter(owner,base).evasionBonus,150);
    assert.equal(conditions.captureState().buffs[0][1][0].nextFrameAge,0);
    conditions.update(59);
    assert.equal(conditions.captureState().buffs[0][1][0].nextFrameAge,0);
    conditions.update(1);
    assert.equal(conditions.captureState().buffs[0][1][0].nextFrameAge,1);
    conditions.update(lastAge*60);
    assert.equal(conditions.hasBuff(owner,'dark-sense'),true);
    assert.equal(conditions.captureState().buffs[0][1][0].nextFrameAge,lastAge+1);
    assert.equal(conditions.fighter(owner,base).evasionBonus,150);
    conditions.update(59);assert.equal(conditions.hasBuff(owner,'dark-sense'),true);
    conditions.update(1);assert.equal(conditions.hasBuff(owner,'dark-sense'),false);
    assert.equal(conditions.fighter(owner,base).evasionBonus,0);
  }
});

test('Dark Sense changes real physical and magical miss thresholds by 150 and stops affecting hits after expiry',()=>{
  for(const kind of ['physical','magic'] as const){
    const conditions=new CombatConditions();
    let rolls=0;
    const hit=(roll:number,original=base)=>{
      const target=conditions.fighter(owner,original),random=()=>{rolls++;return roll/1000;};
      return kind==='physical'?rollPhysicalHit(base,target,random):rollMagicHit(base,target,100,random);
    };
    // Native base threshold is 12; the buff moves it to 162, with a strict comparison.
    assert.equal(hit(100).kind,'hit');assert.equal(apply(conditions,1),true);
    assert.equal(hit(100).kind,'miss');assert.equal(hit(161).kind,'miss');assert.equal(hit(162).kind,'hit');
    assert.equal(conditions.fighter(owner,{...base,evasionBonus:700}).evasionBonus,850);
    assert.equal(hit(761,{...base,evasionBonus:700}).kind,'miss');
    assert.equal(hit(762,{...base,evasionBonus:700}).kind,'hit');
    conditions.update(2820);assert.equal(hit(100).kind,'hit');
    assert.equal(rolls,7);
  }
});
