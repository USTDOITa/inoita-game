import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {skillForGrowth,type BattleCatalog} from '../src/domain/battle.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const expected={
  whist:{hero:[101,103,106,110,111,112,113,114],companion:[102,104,106,108,109,110,111,112]},
  'shouts-of-threat':{hero:[1002,1004,1006,1009,1010,1011,1012,1013],companion:[1002,1004,1006,1008,1009,1010,1011,1012]},
  'weapon-hitback':{hero:[4003,4005,4007,4009,4010,4011,4012,4013],companion:[4002,4004,4006,4008,4009,4010,4011,4012]},
};
function buff(id:string,growth:'hero'|'companion'){
  const unit=skillForGrowth(catalog.skills[id],growth).action!.combatUnits!.find(unit=>unit.effect==='buff');
  assert.ok(unit?.effect==='buff');return unit;
}

test('direct buffs retain source formula strength for both growth profiles at every rank',()=>{
  for(const [id,profiles] of Object.entries(expected))for(const growth of ['hero','companion'] as const)
    assert.deepEqual(buff(id,growth).ranks.map(rank=>rank.strength),profiles[growth]);
  for(const growth of ['hero','companion'] as const){
    const reaction=skillForGrowth(catalog.skills.flare,growth).reactionsByRank![0].find(row=>row.kind==='flare');
    assert.ok(reaction?.kind==='flare');assert.equal(reaction.unlearnedStealth.rankPriority,1);
  }
});

test('same-rank weaker companion debuffs retain the hero source and age; equal strength refreshes across ranks',()=>{
  for(const id of ['shouts-of-threat','weapon-hitback']){
    const hero=buff(id,'hero'),companion=buff(id,'companion'),conditions=new CombatConditions();
    const apply=(row:typeof hero.ranks[number],source:string)=>conditions.applyBuff('enemy',hero.buff,row.strength,row.effect,source);
    assert.equal(apply(hero.ranks[3],'player'),true);conditions.update(120);
    const before=conditions.snapshot('enemy');
    assert.equal(apply(companion.ranks[3],'weak'),false);assert.deepEqual(conditions.snapshot('enemy'),before);
    assert.equal(apply(companion.ranks[4],'equal'),true);
    assert.equal(conditions.snapshot('enemy')[0].sourceId,'equal');
    assert.ok(conditions.snapshot('enemy')[0].remainingMs>before[0].remainingMs);
    assert.equal(apply(hero.ranks[3],'player'),true);assert.equal(conditions.snapshot('enemy')[0].sourceId,'player');
  }
});
