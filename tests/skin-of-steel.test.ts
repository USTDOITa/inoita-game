import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleBuffEffect,BattleCatalog} from '../src/domain/battle.ts';
import {calculateCharacter,type CharacterStatsCatalog} from '../src/domain/character-stats.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import type {ItemCatalog,ItemInstance} from '../src/domain/items.ts';
import {passiveModifiers} from '../src/domain/passive-skills.ts';
import {rollMagicHit,rollPhysicalHit,type PhysicalFighter} from '../src/domain/physical-hit.ts';

const read=(name:string)=>JSON.parse(readFileSync(new URL(`../public/content/${name}.json`,import.meta.url),'utf8'));
const catalog=read('battle') as BattleCatalog,stats=read('character-stats') as CharacterStatsCatalog,items=read('items') as ItemCatalog;
const amounts=[45,65,85,115,125,135,145,155];
const base:PhysicalFighter={level:10,physicalAttack:1000,defense:260,defenseRate:0,physicalResistance:500,magicResistance:200,
  hitBase:100,hitBonus:1000,evasionBase:0,evasionBonus:0,criticalRate:0,criticalResistance:0,criticalDamage:0,
  criticalDamageResistance:0,weaponBlock:0,shieldBlock:0};
const passive=(rank:number,weapon='unarmed')=>passiveModifiers(catalog,'warrior',{levels:{'skin-of-steel':rank}},weapon);
const effect=(modifiers:BattleBuffEffect['modifiers']):BattleBuffEffect=>({durationMs:10000,tickMs:0,states:[],periodic:[],modifiers});
const current=(conditions:CombatConditions,rank=1,overrides:Partial<PhysicalFighter>={})=>conditions.fighter('owner',{...base,...overrides},passive(rank));
const damages=(target:PhysicalFighter,amount=1000)=>[
  rollPhysicalHit(base,target,()=>.5,amount).damage,rollMagicHit(base,target,amount,()=>.5).damage];

function equipmentPanel(modifier:number,gem:number){
  const entry:ItemInstance={id:'magic-resistance',item:Object.keys(stats.equipment)[0],quantity:1,enhancement:0,gems:[],
    numbers:{modifiers:[{stat:'magicResistance',value:modifier}],gemModifiers:[{stat:'magicResistance',value:gem}],
      magicPercent:0,sockets:0,enhancementUses:0}};
  return calculateCharacter(stats,items,'warrior',10,{strength:0,dexterity:0,vitality:0,intelligence:0,mentality:0},{body:entry});
}

test('all eight Steel Skin ranks add each resistance once before physical and magical damage',()=>{
  assert.deepEqual(passive(0),[]);
  assert.deepEqual(damages(current(new CombatConditions(),0)),[500,800]);
  for(let rank=1;rank<=8;rank++)for(const weapon of ['unarmed','two-handed','staff']){
    const modifiers=passive(rank,weapon),amount=amounts[rank-1];
    assert.deepEqual(modifiers,['physicalResistanceBonus','magicResistance'].map(attribute=>({attribute,operation:{kind:'add',amount}})));
    const target=new CombatConditions().fighter('owner',base,modifiers);
    assert.equal(target.physicalResistance,500+amount);assert.equal(target.magicResistance,200+amount);
    assert.deepEqual(damages(target),[500-amount,800-amount]);
  }
});

test('equipment retains signed raw magic resistance while its panel projection only limits the upper bound',()=>{
  const high=equipmentPanel(900,-100),negative=equipmentPanel(0,-100);
  assert.equal(high.baseMagicResistance,800);assert.equal(high.magicResistance,750);
  assert.equal(negative.baseMagicResistance,-100);assert.equal(negative.magicResistance,-100);
});

test('magic resistance limits only the final equipment, passive and Buff result',()=>{
  const conditions=new CombatConditions(),panel=equipmentPanel(900,-100);
  conditions.applyBuff('owner','phantom-clash',1,effect([{attribute:'magicResistance',operation:{kind:'subtract',amount:100}}]));
  const target=current(conditions,1,{magicResistance:panel.baseMagicResistance});
  assert.equal(target.magicResistance,745);assert.equal(damages(target)[1],255);
  conditions.removeBuff('owner','phantom-clash');
  assert.equal(current(conditions,1,{magicResistance:panel.baseMagicResistance}).magicResistance,750);
});

test('negative magic resistance increases damage while cached values bypass the ordinary upper bound',()=>{
  const conditions=new CombatConditions(),panel=equipmentPanel(0,-100);
  const negative=current(conditions,1,{magicResistance:panel.baseMagicResistance});
  assert.equal(negative.magicResistance,-55);assert.equal(damages(negative,100)[1],105);
  conditions.setTemporaryAttribute('owner','magicResistance',1000);
  assert.equal(conditions.cachedAttribute('owner','magicResistance'),1000);
  assert.equal(current(conditions).magicResistance,1000);
  assert.equal(damages(current(conditions),100)[1],0);
  conditions.clearTemporaryAttribute('owner','magicResistance');
  assert.equal(current(conditions,1,{magicResistance:800}).magicResistance,750);
  conditions.setTemporaryAttribute('owner','magicResistance',-55);
  assert.equal(current(conditions).magicResistance,-55);assert.equal(damages(current(conditions),100)[1],105);
  const legacy=conditions.captureState();
  legacy.temporary=[['owner',[['magicResistance',{operation:{kind:'multiply-thousandth',ratePerThousand:1200}}]]]];
  conditions.restoreState(legacy);
  assert.equal(conditions.cachedAttribute('owner','magicResistance'),undefined);
  const multiplied=current(conditions,1,{magicResistance:800});
  assert.equal(multiplied.magicResistance,900);
  assert.equal(conditions.cachedAttribute('owner','magicResistance'),900);
  assert.equal(damages(multiplied)[1],100);
});

test('physical resistance preserves both a total above 750 and a negative extra resistance',()=>{
  const conditions=new CombatConditions();
  const high=current(conditions,8,{defense:5000});
  assert.equal(high.physicalResistance,1105);assert.equal(damages(high)[0],0);
  conditions.applyBuff('owner','phantom-clash',1,effect([{attribute:'physicalResistanceBonus',operation:{kind:'subtract',amount:1000}}]));
  const negative=current(conditions);
  assert.equal(negative.physicalResistance,-455);assert.equal(damages(negative)[0],1455);
});

test('native resistance debuffs modify learned Steel Skin and removal restores the passive',()=>{
  const conditions=new CombatConditions(),phantom=catalog.skills['phantom-clash'].action!.combatUnits!.find(unit=>unit.effect==='buff')!;
  assert.equal(phantom.effect,'buff');if(phantom.effect!=='buff')throw new Error('missing Phantom Clash debuff');
  conditions.applyBuff('owner',phantom.buff,phantom.ranks[0].strength,phantom.ranks[0].effect);
  assert.deepEqual([current(conditions).physicalResistance,current(conditions).magicResistance],[538,210]);
  assert.deepEqual(damages(current(conditions)),[462,790]);conditions.removeBuff('owner',phantom.buff);
  const armor=catalog.skills['armor-penetration'].reactionsByRank![0][0];
  assert.equal(armor.kind,'armor-penetration');if(armor.kind!=='armor-penetration')throw new Error('missing Armor Break');
  conditions.applyBuff('owner',armor.buff.key,armor.buff.rankPriority,armor.buff.effect);
  assert.deepEqual([current(conditions).physicalResistance,current(conditions).magicResistance],[0,245]);
  assert.deepEqual(damages(current(conditions)),[1000,755]);conditions.removeBuff('owner',armor.buff.key);
  const divine=catalog.statusAttackBuffs?.['divine-defense-break'];assert.ok(divine);
  conditions.applyBuff('owner','divine-defense-break',1,divine);
  assert.deepEqual([current(conditions).physicalResistance,current(conditions).magicResistance],[500,0]);
  assert.deepEqual(damages(current(conditions)),[500,1000]);conditions.removeBuff('owner','divine-defense-break');
  assert.deepEqual(damages(current(conditions)),[455,755]);
});

test('Buff refresh preserves newest-first arithmetic without capping intermediate magic resistance',()=>{
  const conditions=new CombatConditions();
  const half=effect([{attribute:'magicResistance',operation:{kind:'multiply-thousandth',ratePerThousand:500}}]);
  const add=effect([{attribute:'magicResistance',operation:{kind:'add',amount:100}}]);
  conditions.applyBuff('owner','phantom-clash',1,half);
  conditions.applyBuff('owner','guardian-of-darkness',1,add);
  assert.equal(current(conditions,1,{magicResistance:800}).magicResistance,472);
  conditions.applyBuff('owner','phantom-clash',1,half);
  assert.equal(current(conditions,1,{magicResistance:800}).magicResistance,522);
});
