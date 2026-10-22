import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {resolveSkillReactions,type SkillReaction} from '../src/domain/skill-reactions.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const ranks=catalog.skills['ordination-prayer'].reactionsByRank!;
const thresholds=[150,210,280,380,410,450,480,510];
const perPulse=[3,4,5,6,7,7,8,8];
const reaction=(index:number)=>ranks[index]![0] as Extract<SkillReaction,{kind:'ordination-prayer'}>;
const noBuff={random:()=>0,learnedBuff:()=>undefined};

test('eight ranks carry their own threshold and put one layer on the recipient',()=>{
  assert.deepEqual(catalog.skills['ordination-prayer'].passiveUnits,[]);
  ranks.forEach((_rank,index)=>{
    const entry=reaction(index);
    assert.equal(entry.kind,'ordination-prayer');
    assert.equal(entry.chanceThreshold,thresholds[index],`rank ${index+1}`);
    assert.equal(entry.buff.key,'ordination-prayer');
    assert.deepEqual(entry.buff.effect.modifiers,
      [{attribute:'manaRecoveryPerPulse',operation:{kind:'add',amount:perPulse[index]}}],`rank ${index+1}`);
    assert.deepEqual(entry.buff.effect.simulationFrames,{lastActiveFrame:180});
    assert.equal(entry.buff.effect.maxStacks,1);
  });
});

test('the draw is strict, zero thresholds never roll, and the caster is the source',()=>{
  const event={kind:'direct-heal-accepted',ownerId:'priest',targetId:'ally'} as const;
  const entry=reaction(0);
  assert.deepEqual(resolveSkillReactions([entry],event,{random:()=>0,learnedBuff:()=>undefined}),
    [{kind:'apply-buff',sourceId:'priest',targetId:'ally',buff:entry.buff}]);
  // 阈值相等失败：抽到 150 时 150 不通过。
  assert.deepEqual(resolveSkillReactions([entry],event,{random:()=>149/999,learnedBuff:()=>undefined}),[]);
  assert.deepEqual(resolveSkillReactions([{...entry,chanceThreshold:0}],event,noBuff),[]);
});

test('the buff stacks to one layer, refreshes from a stronger caster and expires on its last frame',()=>{
  const conditions=new CombatConditions();
  const weak=reaction(0).buff,strong=reaction(7).buff;
  conditions.applyBuff('ally',weak.key,weak.rankPriority,weak.effect,'first-priest');
  assert.equal(conditions.attribute('ally','manaRecoveryPerPulse',0),3);
  assert.equal(conditions.snapshot('ally')[0]?.stackCount,1);
  conditions.applyBuff('ally',strong.key,strong.rankPriority,strong.effect,'second-priest');
  assert.equal(conditions.attribute('ally','manaRecoveryPerPulse',0),8);
  assert.equal(conditions.snapshot('ally')[0]?.sourceId,'second-priest','换成新的施法者');
  assert.equal(conditions.snapshot('ally')[0]?.stackCount,1,'不会叠到两层');
  conditions.update(180*60);assert.equal(conditions.hasBuff('ally','ordination-prayer'),true);
  conditions.update(60);assert.equal(conditions.hasBuff('ally','ordination-prayer'),true);
  conditions.update(60);
  assert.equal(conditions.hasBuff('ally','ordination-prayer'),false);
  assert.equal(conditions.attribute('ally','manaRecoveryPerPulse',0),0);
});
