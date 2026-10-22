import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import type {Campaign,CampaignQuest} from '../src/domain/campaign.ts';
import {Session} from '../src/domain/session.ts';
import {StoryDirector,type StoryUI} from '../src/domain/story-director.ts';
const read=(name:string)=>JSON.parse(readFileSync(new URL('../public/content/'+name+'.json',import.meta.url),'utf8'));
const campaign=read('campaign') as Campaign,world=read('world');
const ui:StoryUI={async dialogue(){},async choice(_prompt,options){return options[0];},async questPopup(){},closeDialogue(){},skipDialogue(){},toast(){}};
function fixture(id:string){
  const quest={...campaign.quests.find(quest=>quest.id===id)!,availableWhen:{type:'always' as const,value:true}};
  const content={...campaign,quests:[quest],questGroups:[],events:[]} as Campaign;
  return {quest,session:new Session(content),content};
}

test('Gunther capture preserves the animal, changes its appearance, and counts only after interaction',async()=>{
  const {quest,session,content}=fixture('quest-18');
  assert.equal(quest.goals[0].kind,'interact');
  assert.equal(quest.targetChanges![0].enemyId,'enemy-shaggy-grayfang-1');
  session.accept(quest.id);
  const director=new StoryDirector(content,session,ui,()=>{}, {begin(){},async execute(){},async finish(){},async release(){}});
  const source={id:'grayfang-instance',map:'hanun-forest-2',x:120,y:88};
  assert.equal(director.healthChanged(quest.targetChanges![0].enemyId,100,0,100,source),true);
  await setImmediate();
  assert.equal(session.status(quest.id),'active');
  assert.equal(session.quests.get(quest.id)!.goals[quest.goals[0].id],0);
  assert.equal(session.canSpawnEnemy({...source,enemyId:quest.targetChanges![0].enemyId}),false);
  const target=session.storyWorld.projectEntities(source.map,[]).find(entity=>entity.id==='quest-target:'+source.id)!;
  assert.equal(target.actor,quest.goals[0].target);
  assert.deepEqual([target.x,target.y],[120,88]);
  assert.ok(world.actors[target.actor]);
  assert.equal(session.weakenQuestTarget(quest.targetChanges![0].enemyId,source),false);
  await director.interact(target,world.actors[target.actor]);
  assert.equal(session.status(quest.id),'ready');
  assert.equal(session.storyWorld.visible(target.id),false);
  assert.equal(session.enemyVitals(source.id).deadUntil,'permanent');
  assert.deepEqual(session.enemyVitals(source.id).capture,{map:source.map,visit:session.storyWorld.visit});
  assert.equal(session.money,0,'捕获没有发放击杀或交付奖励');
  director.dispose();
});

test('a task with two transformed targets requires both interactions and keeps a captured target across a save',()=>{
  const {quest,session,content}=fixture('quest-94');session.accept(quest.id);
  assert.equal(quest.goals.length,2);
  const first=quest.targetChanges![0];
  session.weakenQuestTarget(first.enemyId,{id:'first',map:'field',x:40,y:40});
  const restored=new Session(content);restored.restoreState(session.captureState());
  const target=restored.storyWorld.projectEntities('field',[])[0];
  assert.equal(restored.status(quest.id),'active');
  restored.interact(target.actor,target.id);
  assert.equal(restored.status(quest.id),'active');
  for(let count=1;count<quest.goals.find(goal=>goal.id===first.goal)!.quantity;count++){
    const id='first-'+count;
    restored.weakenQuestTarget(first.enemyId,{id,map:'field',x:40,y:40});
    restored.interact(first.actor,'quest-target:'+id);
  }
  const second=quest.targetChanges!.find(change=>change.goal!==first.goal)!;
  for(let count=0;count<quest.goals.find(goal=>goal.id===second.goal)!.quantity;count++){
    const id='second-'+count;
    restored.weakenQuestTarget(second.enemyId,{id,map:'field',x:80,y:40});
    const other=restored.storyWorld.projectEntities('field',[]).find(entity=>entity.id==='quest-target:'+id)!;
    restored.interact(other.actor,other.id);
  }
  assert.equal(restored.status(quest.id),'ready');
});

test('corpse and capture tasks use the exact original monster-to-NPC mappings',()=>{
  for(const id of ['quest-261','quest-277','quest-498']){
    const quest=campaign.quests.find(quest=>quest.id===id) as CampaignQuest;
    assert.ok(quest.targetChanges?.length);
    for(const change of quest.targetChanges!)assert.ok(quest.goals.some(goal=>goal.id===change.goal&&goal.kind==='interact'&&goal.target===change.actor));
  }
});
