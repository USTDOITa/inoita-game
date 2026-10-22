import assert from 'node:assert/strict';
import test from 'node:test';
import { QuestItemGenerators } from '../src/domain/quest-item-spawns.ts';
import { GroundLootStore } from '../src/domain/ground-loot.ts';
import type { QuestItemSpawn } from '../src/domain/content.ts';

const point:QuestItemSpawn={id:'copper-point',quest:'collection',item:'copper',x:56,y:120,respawnFrames:312};
const active=(quest:string)=>quest==='collection';

test('only active tasks produce one physical item at each native point',()=>{
  const generators=new QuestItemGenerators(),ground=new GroundLootStore();
  generators.enter('mine',1,[point,{...point,id:'other',quest:'later'}],ground);
  generators.advance(0,active,ground);assert.equal(ground.forMap('mine').length,0);
  generators.advance(1,active,ground);
  const [drop]=ground.forMap('mine');assert.deepEqual({x:drop.x,y:drop.y,reward:drop.reward},{x:56,y:120,reward:{kind:'item',item:'copper',quantity:1}});
  generators.advance(1000,active,ground);assert.equal(ground.forMap('mine').length,1,'uncollected item binds its generator');
  assert.deepEqual(ground.collectNearby('mine',56,120,()=>false),[]);
  generators.advance(1200,active,ground);assert.equal(ground.forMap('mine').length,1,'a full bag keeps the same item on the ground');
});

test('pickup resets native counters and the strict shared check gate controls regeneration',()=>{
  const generators=new QuestItemGenerators(),ground=new GroundLootStore();generators.enter('mine',1,[point],ground);
  generators.advance(1,active,ground);
  const picked=ground.collectNearby('mine',56,120,()=>{});generators.collected(picked.map(drop=>drop.id),10);
  assert.equal(generators.captureState().generators[0].remainingFrames,171);
  generators.advance(151,active,ground);assert.equal(ground.forMap('mine').length,0);
  generators.advance(152,active,ground);assert.equal(generators.captureState().generators[0].remainingFrames,21);
  generators.advance(302,active,ground);assert.equal(ground.forMap('mine').length,0);
  generators.advance(303,active,ground);assert.equal(ground.forMap('mine').length,1);
});

test('completed tasks stop producing and save restoration preserves an uncollected item',()=>{
  const generators=new QuestItemGenerators(),ground=new GroundLootStore();generators.enter('mine',1,[point],ground);generators.advance(1,active,ground);
  const restored=new QuestItemGenerators();restored.restoreState(JSON.parse(JSON.stringify(generators.captureState())),ground);
  restored.enter('mine',1,[point],ground);restored.advance(1000,active,ground);
  assert.equal(ground.forMap('mine').length,1);
  const picked=ground.collectNearby('mine',56,120,()=>{});restored.collected(picked.map(drop=>drop.id),1000);
  restored.advance(1151,()=>false,ground);assert.equal(ground.forMap('mine').length,0);
  restored.advance(1400,active,ground);assert.equal(ground.forMap('mine').length,1,'a later active task cycle can generate again');
});

test('leaving a map clears its generated items while other ground rewards survive',()=>{
  const generators=new QuestItemGenerators(),ground=new GroundLootStore();generators.enter('mine',1,[point],ground);generators.advance(1,active,ground);
  ground.add('mine',8,8,[{kind:'money',amount:3}]);
  generators.enter('camp',2,[],ground);
  assert.deepEqual(ground.forMap('mine').map(drop=>drop.reward),[{kind:'money',amount:3}]);
  generators.enter('mine',3,[point],ground);generators.advance(10,active,ground);
  assert.equal(ground.forMap('mine').filter(drop=>drop.reward.kind==='item').length,1);
});

test('invalid generator snapshots are rejected before replacing the live state',()=>{
  const generators=new QuestItemGenerators(),ground=new GroundLootStore();generators.enter('mine',1,[point],ground);generators.advance(1,active,ground);
  const saved=generators.captureState(),bad=structuredClone(saved);bad.generators[0].dropId='missing';
  assert.throws(()=>generators.restoreState(bad,ground),/实例/);assert.deepEqual(generators.captureState(),saved);
});

test('session clock, JSON restore and pickup share the same generator countdown',async()=>{
  const {Session}=await import('../src/domain/session.ts');
  const {groundLootFor}=await import('../src/domain/ground-loot.ts');
  const {readFileSync}=await import('node:fs');
  const campaign=JSON.parse(readFileSync(new URL('../public/content/campaign.json',import.meta.url),'utf8'));
  const items=JSON.parse(readFileSync(new URL('../public/content/items.json',import.meta.url),'utf8'));
  const quest={...campaign.quests.find((quest:{id:string})=>quest.id==='quest-49'),availableWhen:{type:'always',value:true}};
  const content={...campaign,quests:[quest],questGroups:[],events:[]};
  const create=()=>new Session(content,undefined,undefined,items);
  const run=create(),definition={...point,quest:'quest-49',item:'lumps-of-copper'};
  run.applyStoryCommands([{type:'travel',destination:{map:'mine',x:56,y:120,facing:'south'}}]);
  run.enterMap('mine',[definition]);run.accept('quest-49');run.advanceCombatFrames(60,()=>{});
  const saved=JSON.parse(JSON.stringify(run.captureState())),loaded=create();loaded.restoreState(saved);
  loaded.enterMap('mine',[definition]);loaded.advanceCombatFrames(540,()=>{});
  const ground=groundLootFor(loaded);assert.equal(ground.forMap('mine').length,1,'read resumes the same bound item');
  const picked=ground.collectNearby('mine',56,120,reward=>{if(reward.kind==='item')loaded.bag.add(reward.item,reward.quantity);});
  loaded.questItemGenerators.collected(picked.map(drop=>drop.id),loaded.combatTick);loaded.emit();
  const mid=JSON.parse(JSON.stringify(loaded.captureState())),again=create();again.restoreState(mid);again.enterMap('mine',[definition]);
  again.advanceCombatFrames((303-again.combatTick)*60,()=>{});
  assert.equal(groundLootFor(again).forMap('mine').length,1,'read retains the original reset deadline');
  assert.equal(again.itemCount('lumps-of-copper'),1);
  const bad=structuredClone(again.captureState());bad.questItemGeneration.generators[0].dropId='missing';
  const before=again.captureState();assert.throws(()=>again.restoreState(bad),/实例/);assert.deepEqual(again.captureState(),before);
});
