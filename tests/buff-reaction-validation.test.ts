import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog,BattleBuffEffect} from '../src/domain/battle.ts';
import {parseBattle} from '../src/application/content-validation.ts';
import {skillEffectNames} from '../src/domain/skill-action.ts';
import {skillReactionEffects} from '../src/domain/skill-reactions.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
function child(candidate:BattleCatalog):BattleBuffEffect {
  const unit=candidate.skills['demon-s-shield'].action!.combatUnits!.find(unit=>unit.effect==='buff')!;
  assert.equal(unit.effect,'buff');if(unit.effect!=='buff')throw new Error('missing shield');
  const reaction=unit.ranks.at(-1)!.effect.reactions![0];
  assert.ok('buff' in reaction);
  return reaction.buff.effect;
}

test('nested buff assets are required and collected for every active rank and passive reaction',()=>{
  const data=structuredClone(catalog),nested=child(data);
  nested.applicationEffect='missing-child-application';
  assert.throws(()=>parseBattle(data),/missing-child-application/);
  nested.applicationEffect='life-drain';
  assert.ok(skillEffectNames(data.skills['demon-s-shield'].action!).includes('life-drain'));
  assert.doesNotThrow(()=>parseBattle(data));
  nested.periodic=[{kind:'visual',effect:'missing-child-pulse'}];
  nested.tickMs=60;nested.simulationFrames!.pulseIntervalFrames=1;
  assert.throws(()=>parseBattle(data),/missing-child-pulse/);
  assert.ok(skillEffectNames(data.skills['demon-s-shield'].action!).includes('missing-child-pulse'));
  const passive=data.skills['shield-of-rage'];
  for(const reactions of passive.reactionsByRank!)for(const reaction of reactions){
    if(reaction.kind==='shield-of-rage')reaction.buff.effect.reactions=[{
      kind:'physical-avoidance',buff:{key:'mana-recovery',rankPriority:1,effect:structuredClone(nested)},
    }];
  }
  nested.periodic=[];nested.tickMs=0;delete nested.simulationFrames!.pulseIntervalFrames;
  assert.ok(skillReactionEffects(passive).includes('missing-child-pulse'));
  assert.throws(()=>parseBattle(data),/missing-child-pulse/);
});

test('nested buffs retain the same strict lifetime and replacement priority validation',()=>{
  const data=structuredClone(catalog),nested=child(data);
  nested.durationMs++;
  assert.throws(()=>parseBattle(data),/reactions.*durationMs/);
  nested.durationMs--;
  const unit=data.skills['demon-s-shield'].action!.combatUnits!.find(unit=>unit.effect==='buff')!;
  if(unit.effect!=='buff')throw new Error('missing shield');
  const reaction=unit.ranks.at(-1)!.effect.reactions![0];
  assert.ok('buff' in reaction);
  reaction.buff.rankPriority=0;
  assert.throws(()=>parseBattle(data),/rankPriority/);
});
