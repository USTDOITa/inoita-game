import assert from 'node:assert/strict';
import test from 'node:test';
import {equipmentThreatReduction} from '../src/domain/equipment-threat.ts';
import type {ItemInstance} from '../src/domain/items.ts';
import type {ItemNumbers} from '../src/domain/character-stats.ts';

const item=(id:string,numbers?:Pick<ItemNumbers,'modifiers'|'gemModifiers'>):ItemInstance=>({
  id,item:'test-equipment',quantity:1,enhancement:0,gems:[],
  ...(numbers?{numbers:{magicPercent:0,sockets:0,enhancementUses:0,...numbers}}:{}),
});

test('threat reduction reads instance and gem modifiers while unrelated combat options do not contribute',()=>{
  const equipped=[item('weapon',{
    modifiers:[{stat:'aggroReduction',value:150},{stat:'physicalAttackRate',value:500}],
    gemModifiers:[{stat:'aggroReduction',value:40},{stat:'lifeSteal',value:30}],
  }),item('armor',{modifiers:[{stat:'aggroReduction',value:60}],gemModifiers:[]}),item('unrolled')];
  const before=structuredClone(equipped);
  assert.equal(equipmentThreatReduction(equipped),250);
  assert.deepEqual(equipped,before);
  assert.equal(equipmentThreatReduction([]),0);
});

test('negative item and gem values cancel positive threat reduction before the host applies its clamp',()=>{
  const negative=item('negative',{modifiers:[{stat:'aggroReduction',value:-120}],gemModifiers:[{stat:'aggroReduction',value:-40}]});
  const positive=item('positive',{modifiers:[{stat:'aggroReduction',value:100}],gemModifiers:[]});
  assert.equal(equipmentThreatReduction([negative]),-160);
  assert.equal(equipmentThreatReduction([negative,positive]),-60);
  assert.equal(equipmentThreatReduction([positive,negative]),-60);
});
