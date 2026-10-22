import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {equipmentAttackProcs} from '../src/domain/equipment-attack-procs.ts';
import {BattleCharacter,type ItemNumbers,type CharacterStatsCatalog} from '../src/domain/character-stats.ts';
import type {ItemCatalog,ItemInstance} from '../src/domain/items.ts';

const item=(id:string,numbers?:Pick<ItemNumbers,'modifiers'|'gemModifiers'>):ItemInstance=>({
  id,item:'test-equipment',quantity:1,enhancement:0,gems:[],
  ...(numbers?{numbers:{magicPercent:0,sockets:0,enhancementUses:0,...numbers}}:{}),
});

test('six elemental thresholds come from actual item and gem modifiers with their original integer units',()=>{
  const equipped=[item('weapon',{modifiers:[{stat:'fire',value:100},{stat:'wind',value:50},{stat:'freeze',value:150},
    {stat:'divine',value:50},{stat:'darkness',value:10},{stat:'poison',value:200},{stat:'criticalRate',value:999}],
    gemModifiers:[{stat:'wind',value:20},{stat:'poison',value:30}]}),
    item('other',{modifiers:[{stat:'fire',value:75},{stat:'freeze',value:-25}],gemModifiers:[]}),item('unrolled')];
  const before=structuredClone(equipped);
  assert.deepEqual(equipmentAttackProcs(equipped),{fireSplashChance:175,windStrikeChance:70,frostStrikeChance:125,
    divineStrikeChance:50,darknessStrikeChance:10,poisonStrikeChance:230});
  assert.deepEqual(equipped,before);
  assert.deepEqual(equipmentAttackProcs([]),{fireSplashChance:0,windStrikeChance:0,frostStrikeChance:0,
    divineStrikeChance:0,darknessStrikeChance:0,poisonStrikeChance:0});
});

test('negative thresholds survive until the host merges all attribute sources',()=>{
  const negative=item('negative',{modifiers:[{stat:'darkness',value:-120},{stat:'poison',value:-10}],
    gemModifiers:[{stat:'darkness',value:-40},{stat:'poison',value:10}]});
  const positive=item('positive',{modifiers:[{stat:'darkness',value:100},{stat:'toString',value:999}],gemModifiers:[]});
  assert.equal(equipmentAttackProcs([negative]).darknessStrikeChance,-160);
  assert.equal(equipmentAttackProcs([negative,positive]).darknessStrikeChance,-60);
  assert.equal(equipmentAttackProcs([positive,negative]).darknessStrikeChance,-60);
  assert.equal(equipmentAttackProcs([negative]).poisonStrikeChance,0);
});

test('existing equipment catalog rolls feed all six native fixed elemental options',()=>{
  const read=(name:string)=>JSON.parse(readFileSync(new URL(`../public/content/${name}.json`,import.meta.url),'utf8'));
  const hero=new BattleCharacter('dark-knight',read('character-stats') as CharacterStatsCatalog,read('items') as ItemCatalog);
  const names=['blood-raven','masamune','obsidian-laser','heathen-s-mace','darkness-shredder','destructive-fang'];
  for(const name of names)hero.bag.add(name);
  const equipped=names.map(name=>hero.bag.entries.find(entry=>entry.item===name)!);
  assert.ok(equipped.every(entry=>entry?.numbers));
  const rates=equipmentAttackProcs(equipped);
  assert.equal(rates.fireSplashChance,100);assert.equal(rates.windStrikeChance,50);
  assert.equal(rates.divineStrikeChance,50);assert.equal(rates.darknessStrikeChance,10);assert.equal(rates.poisonStrikeChance,200);
  assert.ok(rates.frostStrikeChance>=176&&rates.frostStrikeChance<=364);
});
