import {applyCombatOperation} from '../src/domain/combat-operation.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {partyCombatModifiers,partyProcSucceeds} from '../src/domain/party-combat.ts';
import type {CompanionCatalog} from '../src/domain/party.ts';
const catalog=JSON.parse(readFileSync(new URL('../public/content/companions.json',import.meta.url),'utf8')) as CompanionCatalog;
const effects=Object.fromEntries(Object.values(catalog.groupSkills).map(skill=>[skill.effect,skill.value]));
const totals=(weapon:string,armor:string,health=100,maxHealth=100)=>{
  const result:Record<string,number>={};
  for(const modifier of partyCombatModifiers(effects,weapon,armor,health,maxHealth))result[modifier.attribute]=applyCombatOperation(result[modifier.attribute]??0,modifier.operation);
  return result;
};
test('group combat effects require the original weapon and armor class and add unconditional bonuses once',()=>{
  const base={magicDamageRate:20,magicResistance:30,criticalDamage:50};
  assert.deepEqual(totals('dagger','robe'),base);
  assert.deepEqual(totals('longsword','plate'),{physicalDamageRate:20,magicDamageRate:40,defenseRate:100,magicResistance:30,criticalDamage:50});
  assert.deepEqual(totals('mace','leather'),{physicalDamageRate:30,...base});
  assert.deepEqual(totals('staff','cloth'),{...base,magicDamageRate:50});
  for(const weapon of ['bow','crossbow','two-handed'])assert.deepEqual(totals(weapon,'leather'),{physicalDamageRate:60,...base});
  assert.deepEqual(partyCombatModifiers({},'longsword','plate',1,100),[]);
});
test('low life resistance applies at the integer thirty-percent boundary and combines with magic resistance',()=>{
  const enabled=totals('dagger','robe',30,101),disabled=totals('dagger','robe',31,101);
  assert.equal(enabled.physicalResistanceBonus,100);assert.equal(enabled.magicResistance,130);
  assert.equal(disabled.physicalResistanceBonus,undefined);assert.equal(disabled.magicResistance,30);
});
test('blunt stun uses native formula 843 value twenty and strict one-through-999 sampling',()=>{
  const chance=catalog.groupSkills['blunt-stun-chance'].value;assert.equal(chance,20);
  const results=Array.from({length:999},(_,index)=>partyProcSucceeds(chance,()=> (index+.5)/999));
  assert.equal(results.filter(Boolean).length,19);
  assert.equal(results[18],true);assert.equal(results[19],false);assert.equal(results[998],false);
  assert.equal(partyProcSucceeds(0,()=>assert.fail('a disabled proc must not consume randomness')),false);
  assert.equal(partyProcSucceeds(1000,()=>.999999),true);
});
