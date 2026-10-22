import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';

const battle=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;

test('Shadow Phantom preserves all eight critical bonuses behind the actor stealth-state condition',()=>{
  const skill=battle.skills['shadow-phantom'];
  assert.equal(skill.normalMaxLevel,3);
  assert.deepEqual(skill.passiveUnits,[{attribute:'criticalRate',condition:'stealthed',
    ranks:[170,230,270,290,310,330,350,370].map(amount=>({kind:'add',amount}))}]);
  const stateDependent=Object.values(battle.skills).filter(entry=>entry.passiveUnits?.some(unit=>unit.condition==='stealthed'));
  assert.deepEqual(stateDependent.map(entry=>entry.id),['shadow-phantom']);
});
