import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog,SkillLoadout} from '../src/domain/battle.ts';
import {passiveModifiers} from '../src/domain/passive-skills.ts';

const battle=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const chance=[10,20,30,40,50,50,60,60];

test('Warriors Instinct exports the stepwise-rounded chance at all eight ranks',()=>{
  const skill=battle.skills['warrior-s-instinct'];
  assert.deepEqual(skill.passiveUnits,[{attribute:'cooldownResetChance',condition:'always',
    ranks:chance.map(amount=>({kind:'add',amount}))}]);
});

test('Warriors Instinct exports unconditional rank values before the live weapon-dependent trigger adjustment',()=>{
  for(let rank=1;rank<=8;rank++)for(const weapon of ['','dagger','longsword','axe','mace','shield','two-handed','bow','staff','orb','crossbow']){
    const loadout:SkillLoadout={levels:{'warrior-s-instinct':rank}};
    assert.deepEqual(passiveModifiers(battle,'warrior',loadout,weapon),[
      {attribute:'cooldownResetChance',operation:{kind:'add',amount:chance[rank-1]}},
    ]);
  }
  assert.deepEqual(passiveModifiers(battle,'warrior',{levels:{}},'two-handed'),[]);
  assert.deepEqual(passiveModifiers(battle,'assassin',{levels:{'warrior-s-instinct':8}},'two-handed'),[]);
});
