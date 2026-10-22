import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseBattle} from '../src/application/content-validation.ts';
import {StoryWorldState} from '../src/domain/story-world.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {resolvePeriodicEffect} from '../src/domain/combat-periodic.ts';

const battle=parseBattle(JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')));
test('native trap persists its application until projection and damages each recipient once',()=>{
  const world=new StoryWorldState();world.apply({kind:'party-buff',buff:'story-trap',strength:0});
  const restored=new StoryWorldState();restored.restoreState(world.captureState());
  assert.deepEqual(restored.pendingPartyBuffs,[{buff:'story-trap',strength:0}]);
  const effect=battle.statusAttackBuffs!['story-trap']!;
  assert.equal(effect.applicationEffect,'story-trap-hit');
  const conditions=new CombatConditions(),hits:string[]=[];
  for(const member of ['player','companion-a','companion-b'])conditions.applyBuff(member,'story-trap',0,effect,member);
  restored.consumePartyBuffs(1);assert.deepEqual(restored.pendingPartyBuffs,[]);
  for(let frame=0;frame<20;frame++)conditions.update(60,tick=>{
    hits.push(tick.targetId);
    assert.equal(tick.sourceId,tick.targetId);
    const result=resolvePeriodicEffect(tick.effect,{buffId:'story-trap',stackCount:1,targetHealingRate:1000,
      source:{classId:null,lifeFeastRate:0,attributes:{} as never,attributeValue:()=>25}});
    assert.deepEqual(result,[{kind:'damage-target',amount:10}]);
  });
  assert.deepEqual(hits.sort(),['companion-a','companion-b','player']);
});
