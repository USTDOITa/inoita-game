import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog,SkillLoadout} from '../src/domain/battle.ts';
import {passiveModifiers} from '../src/domain/passive-skills.ts';

const battle=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const chance=[61,101,161,241,261,281,301,321],damage=[30,50,80,120,130,140,150,160];

test('Weapon Specializing exports both independent native attribute writes at every rank',()=>{
  const skill=battle.skills['weapon-specializing'];
  assert.deepEqual(skill.passiveUnits,[
    {attribute:'offhandAttackChance',condition:'always',ranks:chance.map(amount=>({kind:'add',amount}))},
    {attribute:'physicalDamageRate',condition:'weapon-two-handed',ranks:damage.map(amount=>({kind:'add',amount}))},
  ]);
});

test('Weapon Specializing keeps offhand chance unconditional and damage specific to a two-handed main weapon',()=>{
  for(let rank=1;rank<=8;rank++)for(const weapon of ['','dagger','longsword','axe','mace','shield','two-handed','bow','staff']){
    const loadout:SkillLoadout={levels:{'weapon-specializing':rank}};
    const actual=passiveModifiers(battle,'warrior',loadout,weapon);
    assert.deepEqual(actual,[{attribute:'offhandAttackChance',operation:{kind:'add',amount:chance[rank-1]}},
      ...(weapon==='two-handed'?[{attribute:'physicalDamageRate',operation:{kind:'add',amount:damage[rank-1]}}]:[])]);
  }
  assert.deepEqual(passiveModifiers(battle,'warrior',{levels:{}},'two-handed'),[]);
  assert.deepEqual(passiveModifiers(battle,'assassin',{levels:{'weapon-specializing':8}},'two-handed'),[]);
});
