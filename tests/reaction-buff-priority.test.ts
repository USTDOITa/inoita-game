import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {skillForGrowth,type BattleCatalog} from '../src/domain/battle.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {resolveSkillReactions,type SkillReactionBuff} from '../src/domain/skill-reactions.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
function flares(growth:'hero'|'companion',rank:number,ownerId:string):SkillReactionBuff {
  const skill=skillForGrowth(catalog.skills['flares-of-pain'],growth);
  const commands=resolveSkillReactions(skill.reactionsByRank![rank-1],{
    kind:'attack-effects',ownerId,opponentId:'victim',damageKind:'physical',outcome:'hit',
    actionId:'firestorm',hasMoltenArmor:false,
  },{random:()=>0,learnedBuff:()=>undefined});
  const command=commands[0];
  assert.equal(command?.kind,'apply-buff');
  if(command?.kind!=='apply-buff')throw new Error('missing ignition');
  assert.equal(command.sourceId,ownerId);assert.equal(command.targetId,'victim');
  return command.buff;
}
function apply(conditions:CombatConditions,buff:SkillReactionBuff,source:string){
  return conditions.applyBuff('victim',buff.key,buff.rankPriority,buff.effect,source);
}

test('a weaker same-rank companion ignition preserves the heroes burn source and age',()=>{
  const conditions=new CombatConditions(),hero=flares('hero',4,'player'),companion=flares('companion',4,'ally');
  assert.equal(hero.rankPriority,4009);assert.equal(companion.rankPriority,4008);
  assert.equal(apply(conditions,hero,'player'),true);
  conditions.update(120);
  const before=conditions.snapshot('victim');
  assert.equal(apply(conditions,companion,'ally'),false);
  assert.deepEqual(conditions.snapshot('victim'),before);
  const sources:string[]=[];
  conditions.update(1740,tick=>sources.push(tick.sourceId));
  assert.deepEqual(sources,['player']);
});

test('equal-strength ignitions from different ranks refresh in both directions',()=>{
  const hero=flares('hero',4,'player'),companion=flares('companion',5,'ally');
  assert.equal(hero.rankPriority,4009);assert.equal(companion.rankPriority,4009);
  assert.deepEqual(hero.effect.periodic,companion.effect.periodic);
  for(const [first,firstSource,next,nextSource] of [
    [hero,'player',companion,'ally'],[companion,'ally',hero,'player'],
  ] as const){
    const conditions=new CombatConditions();apply(conditions,first,firstSource);conditions.update(120);
    assert.equal(apply(conditions,next,nextSource),true);
    const snapshot=conditions.snapshot('victim')[0];
    assert.equal(snapshot.sourceId,nextSource);assert.equal(snapshot.stackCount,1);
    const sources:string[]=[];conditions.update(60,tick=>sources.push(tick.sourceId));
    assert.deepEqual(sources,[nextSource],'accepted replacement restarts the age-zero pulse');
  }
});
