import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {calculateCharacter,equipmentPower,type CharacterStatsCatalog} from '../src/domain/character-stats.ts';
import type {ItemCatalog,ItemInstance} from '../src/domain/items.ts';

const read=(name:string)=>JSON.parse(readFileSync(new URL(`../public/content/${name}.json`,import.meta.url),'utf8'));
const catalog=read('character-stats') as CharacterStatsCatalog,items=read('items') as ItemCatalog;
const dagger=Object.keys(catalog.equipment).find(key=>items.items[key].kind==='dagger')!;
const zero={strength:0,dexterity:0,vitality:0,intelligence:0,mentality:0};
const weapon=(id:string,damage:number,magicPercent:number):ItemInstance=>({id,item:dagger,quantity:1,enhancement:0,gems:[],
  numbers:{baseAttack:damage,baseDefense:0,magicPercent,modifiers:[],gemModifiers:[],sockets:0,enhancementUses:0}} as ItemInstance);

test('base attacks use only the main weapon while offhand item modifiers remain active for every class',()=>{
  const main=weapon('main',40,50),offhand=weapon('offhand',500,100);
  offhand.numbers!.modifiers=[{stat:'weaponBlock',value:17},{stat:'maxMana',value:23}];
  for(const classId of Object.keys(catalog.classes)){
    const single=calculateCharacter(catalog,items,classId,1,zero,{'main-hand':main});
    const dual=calculateCharacter(catalog,items,classId,1,zero,{'main-hand':main,'off-hand':offhand});
    assert.equal(dual.physicalAttack,single.physicalAttack,classId);
    assert.equal(dual.magicAttack,single.magicAttack,classId);
    assert.equal(dual.weaponBlock,single.weaponBlock+17,classId);
    assert.equal(dual.maxMana,single.maxMana+23,classId);
  }
});

test('offhand instance enhancements stay available for its own strike and affect base attack only after moving to main hand',()=>{
  const main=weapon('main',40,50),offhand=weapon('offhand',20,60);
  offhand.numbers!.enhancementRule={step:3,threshold:2,extra:4};offhand.enhancement=4;
  const power=equipmentPower(catalog.equipment[dagger],offhand);
  assert.equal(power.attack,44);assert.equal(power.magicAttack,26);
  const single=calculateCharacter(catalog,items,'assassin',1,zero,{'main-hand':main});
  const dual=calculateCharacter(catalog,items,'assassin',1,zero,{'main-hand':main,'off-hand':offhand});
  assert.equal(dual.physicalAttack,single.physicalAttack);assert.equal(dual.magicAttack,single.magicAttack);
  const swapped=calculateCharacter(catalog,items,'assassin',1,zero,{'main-hand':offhand,'off-hand':main});
  assert.equal(swapped.physicalAttack,single.physicalAttack+4);assert.equal(swapped.magicAttack,single.magicAttack+6);
  const empty=calculateCharacter(catalog,items,'assassin',1,zero,{});
  const offOnly=calculateCharacter(catalog,items,'assassin',1,zero,{'off-hand':offhand});
  assert.equal(offOnly.physicalAttack,empty.physicalAttack);assert.equal(offOnly.magicAttack,empty.magicAttack);
});
