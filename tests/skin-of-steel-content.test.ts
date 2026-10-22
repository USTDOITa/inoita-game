import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {passiveModifiers} from '../src/domain/passive-skills.ts';

const battle=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const resistances=[45,65,85,115,125,135,145,155];

test('Skin of Steel already exports all eight unconditional physical-bonus and magic-resistance writes',()=>{
  const skill=battle.skills['skin-of-steel'];
  assert.deepEqual(skill.passiveUnits,['physicalResistanceBonus','magicResistance'].map(attribute=>({
    attribute,condition:'always',ranks:resistances.map(amount=>({kind:'add',amount})),
  })));
});

test('Skin of Steel reads the learned rank without a weapon condition or a defense modifier',()=>{
  for(let rank=1;rank<=8;rank++)for(const weapon of ['','dagger','longsword','axe','mace','two-handed','bow','crossbow','staff','orb']){
    const modifiers=passiveModifiers(battle,'warrior',{levels:{'skin-of-steel':rank}},weapon);
    assert.deepEqual(modifiers,['physicalResistanceBonus','magicResistance'].map(attribute=>({
      attribute,operation:{kind:'add',amount:resistances[rank-1]},
    })));
  }
  assert.deepEqual(passiveModifiers(battle,'warrior',{levels:{}},'two-handed'),[]);
  assert.deepEqual(passiveModifiers(battle,'priest',{levels:{'skin-of-steel':8}},'staff'),[]);
});
