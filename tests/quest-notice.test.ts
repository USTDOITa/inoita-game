import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Campaign } from '../src/domain/campaign.ts';
import { BattleCharacter, type CharacterStatsCatalog } from '../src/domain/character-stats.ts';
import type { EntityPlacement, WorldIndex } from '../src/domain/content.ts';
import type { ItemCatalog } from '../src/domain/items.ts';
import { Session } from '../src/domain/session.ts';
import { StoryDirector, type StoryUI } from '../src/domain/story-director.ts';

const read=<T>(name:string):T=>JSON.parse(readFileSync(new URL(`../public/content/${name}.json`,import.meta.url),'utf8'));
const campaign=read<Campaign>('campaign'),world=read<WorldIndex>('world');
const items=read<ItemCatalog>('items'),stats=read<CharacterStatsCatalog>('character-stats');
const fusion=campaign.placements!.find(entry=>entry.actor==='fusion-machine-3d13b5ee')! as EntityPlacement;
const fusionActor=world.actors[fusion.actor];

function harness(content:Campaign=campaign){
  const session=new Session(content,undefined,undefined,items,new BattleCharacter('dark-knight',stats,items));
  const popups:{kind:'start'|'complete';quest:string;reward?:{experience:number}}[]=[];
  const ui:StoryUI={
    async dialogue(){},async choice(_prompt,options){return options[0];},
    async questPopup(kind,quest,reward){popups.push({kind,quest:quest.id,reward});},
    toast(){},closeDialogue(){},skipDialogue(){}
  };
  return {session,director:new StoryDirector(content,session,ui,()=>{}),popups};
}

test('talking to a quest giver shows the start notice before the quest is active',async()=>{
  const h=harness();
  assert.equal(await h.director.interact(fusion,fusionActor),true);
  assert.equal(h.session.status('quest-353'),'active');
  assert.deepEqual(h.popups.map(popup=>`${popup.kind}:${popup.quest}`),['start:quest-353']);
  assert.equal(h.popups[0].reward,undefined);
});

test('handing in a quest shows the complete notice with its reward',async()=>{
  const h=harness();
  assert.equal(h.session.accept('quest-353'),true);
  for(let count=0;count<5;count++)h.session.bag.add('paillette',1);
  h.session.refresh();
  assert.equal(h.session.status('quest-353'),'ready');
  assert.equal(await h.director.interact(fusion,fusionActor),true);
  assert.deepEqual(h.popups.map(popup=>`${popup.kind}:${popup.quest}`),['complete:quest-353']);
  assert.ok((h.popups[0].reward?.experience??0)>0);
});

test('a quest with an offer script keeps the script responsible for its notice',async()=>{
  const content:Campaign=structuredClone(campaign);
  const quest=content.quests.find(entry=>entry.id==='quest-353')!;
  quest.offerScript='offer-noop';
  content.scripts['offer-noop']={entry:'node',nodes:[{id:'node',presentation:[],commands:[{type:'quest',command:{type:'accept',quest:'quest-353'}}],exit:{type:'end'}}]};
  const h=harness(content);
  assert.equal(await h.director.interact(fusion,fusionActor),true);
  assert.equal(h.session.status('quest-353'),'active');
  assert.deepEqual(h.popups,[]);
});
