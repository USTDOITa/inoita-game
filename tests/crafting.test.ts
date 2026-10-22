import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {EquipmentCrafting,CraftingError,parseCrafting,validateCrafting} from '../src/domain/crafting.ts';
import {BattleCharacter,type CharacterStatsCatalog} from '../src/domain/character-stats.ts';
import {Session} from '../src/domain/session.ts';
import type {ItemCatalog} from '../src/domain/items.ts';
import type { WorldIndex } from '../src/domain/content.ts';
import type { Campaign } from '../src/domain/campaign.ts';
const read=<T>(file:string):T=>JSON.parse(readFileSync(new URL(`../public/content/${file}.json`,import.meta.url),'utf8'));
const items=read<ItemCatalog>('items'),stats=read<CharacterStatsCatalog>('character-stats'),campaign=read<Campaign>('campaign');
const catalog=parseCrafting(read('crafting'));
function fixture(){
  const hero=new BattleCharacter('dark-knight',stats,items),session=new Session(campaign,undefined,undefined,items,hero);
  const target=hero.bag.equipment['main-hand']!;hero.bag.unequip('main-hand');session.gainMoney(100000);
  for(const op of Object.values(catalog.operations))for(const m of op.materials)hero.bag.add(m.item,m.quantity*4);
  return {hero,session,target,crafting:new EquipmentCrafting(session,catalog)};
}
const notice=(expected:string)=>(error:unknown)=>error instanceof CraftingError&&error.notice===expected;

test('both original recipes mutate the same instance, charge actual materials once and publish one complete state',()=>{
  const {hero,session,target,crafting}=fixture(),bag=hero.bag;
  const state=bag.captureState(),gear=state.instances.find(e=>e.id===target)!;gear.enhancement=5;gear.gems=['novice-jewel'];
  gear.numbers!.gemModifiers=[{stat:'strength',value:2}];bag.restoreState(state);
  const before=bag.get(target)!,layouts=bag.captureState(),money=session.money,counts=bag.counts;
  let updates=0;session.subscribe(()=>{updates++;assert.equal(bag.get(target)!.numbers!.chaos!.tier,'chaos');assert.equal(session.money,money-items.items[before.item].level*700);});
  const quote=crafting.quote('chaos',target);crafting.commit(quote,()=>.999);
  assert.equal(updates,1);assert.equal(bag.get(target)!.id,before.id);
  const after=bag.get(target)!;delete after.numbers!.chaos;assert.deepEqual(after,before);
  assert.deepEqual(bag.captureState().allCells,layouts.allCells);assert.deepEqual(bag.captureState().pouches,layouts.pouches);
  for(const m of catalog.operations.chaos.materials)assert.equal(bag.count(m.item),counts.get(m.item)!-m.quantity);
  const snapshot=session.captureState();assert.throws(()=>crafting.commit(quote),notice('craft-target'));assert.deepEqual(session.captureState(),snapshot);
});

test('native tier prerequisites and caps reject without charge; epic chaos preserves all equipment fields',()=>{
  const {hero,session,target,crafting}=fixture(),bag=hero.bag;
  assert.equal(crafting.targetProblem('epic-chaos',target),'craft-needs-chaos');
  crafting.commit(crafting.quote('chaos',target),()=>.999);
  const before=bag.get(target)!,money=session.money;
  crafting.commit(crafting.quote('epic-chaos',target),()=>.999);
  assert.equal(bag.get(target)!.numbers!.chaos!.tier,'epic-chaos');assert.equal(bag.get(target)!.numbers!.chaos!.valuePercent,147);
  assert.equal(session.money,money-items.items[before.item].level*900);
  assert.equal(crafting.targetProblem('chaos',target),'craft-epic');
  const state=bag.captureState();state.instances.find(e=>e.id===target)!.numbers!.chaos!.valuePercent=200;bag.restoreState(state);
  const snapshot=session.captureState();assert.throws(()=>crafting.quote('epic-chaos',target),notice('craft-max'));assert.deepEqual(session.captureState(),snapshot);
});

test('stale equipment, depleted materials, reduced money and invalid randomness preserve state',()=>{
  for(const kind of ['equipment','materials','money','random'] as const){
    const {hero,session,target,crafting}=fixture(),bag=hero.bag,quote=crafting.quote('chaos',target);
    if(kind==='equipment')bag.equip(target,'main-hand');
    if(kind==='materials'){const m=catalog.operations.chaos.materials[0];bag.remove(m.item,bag.count(m.item));}
    if(kind==='money')session.spendMoney(session.money);
    const snapshot=session.captureState();assert.throws(()=>crafting.commit(quote,()=>kind==='random'?1:0));assert.deepEqual(session.captureState(),snapshot);
  }
});

test('crafting content closes over materials, original fees, and existing fusion services',()=>{
  validateCrafting(catalog,items);assert.equal(catalog.operations.chaos.costPerLevel,700);assert.equal(catalog.operations['epic-chaos'].costPerLevel,900);
  const invalid=structuredClone(catalog);invalid.operations.chaos.rule.levelDiceDivisor=0;assert.throws(()=>parseCrafting(invalid));
  const world=read<WorldIndex>('world'),machines=Object.values(world.actors).filter(actor=>actor.service==='fusion-machine');
  assert.equal(machines.length,11);assert(machines.every(actor=>actor.name==='融合器'));
});
