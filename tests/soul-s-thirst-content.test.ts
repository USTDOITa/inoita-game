import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog,SkillLoadout} from '../src/domain/battle.ts';
import {passiveModifiers} from '../src/domain/passive-skills.ts';

const battle=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const chance=[50,70,90,120,130,140,150,160],mana=[7,9,11,14,15,16,17,18];

test('Souls Thirst exports unconditional chance and fixed mana recovery at all eight ranks',()=>{
  const skill=battle.skills['soul-s-thirst'];
  assert.deepEqual(skill.passiveUnits,[
    {attribute:'bloodThirstChance',condition:'always',ranks:chance.map(amount=>({kind:'add',amount}))},
    {attribute:'bloodThirstManaRecovery',condition:'always',ranks:mana.map(amount=>({kind:'add',amount}))},
  ]);
});

test('Souls Thirst modifiers follow the owners rank independently of weapons or the Blood Thirst learned rank',()=>{
  for(let rank=1;rank<=8;rank++)for(const weapon of ['','dagger','longsword','axe','mace','shield','two-handed','bow','staff']){
    const loadout:SkillLoadout={levels:{'soul-s-thirst':rank}};
    const expected=[{attribute:'bloodThirstChance',operation:{kind:'add',amount:chance[rank-1]}},
      {attribute:'bloodThirstManaRecovery',operation:{kind:'add',amount:mana[rank-1]}}];
    assert.deepEqual(passiveModifiers(battle,'warrior',loadout,weapon),expected);
    assert.deepEqual(passiveModifiers(battle,'warrior',{...loadout,levels:{...loadout.levels,'blood-thirst':8}},weapon),expected);
  }
  assert.deepEqual(passiveModifiers(battle,'warrior',{levels:{}},'two-handed'),[]);
  assert.deepEqual(passiveModifiers(battle,'assassin',{levels:{'soul-s-thirst':8}},'two-handed'),[]);
});
