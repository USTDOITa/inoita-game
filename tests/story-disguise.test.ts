import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {Campaign} from '../src/domain/campaign.ts';
import type {ItemCatalog} from '../src/domain/items.ts';
import type {CharacterStatsCatalog} from '../src/domain/character-stats.ts';
import {BattleCharacter} from '../src/domain/character-stats.ts';
import type {BattleCatalog} from '../src/domain/battle.ts';
import type {CompanionCatalog} from '../src/domain/party.ts';
import {Session} from '../src/domain/session.ts';
const read=<T>(name:string):T=>JSON.parse(readFileSync(new URL(`../public/content/${name}.json`,import.meta.url),'utf8'));
const campaign=read<Campaign>('campaign'),items=read<ItemCatalog>('items'),stats=read<CharacterStatsCatalog>('character-stats');

test('native disguise creates locked equipment, preserves displaced gear, and destroys masks on removal',()=>{
  const hero=new BattleCharacter('dark-knight',stats,items);
  const session=new Session(campaign,undefined,undefined,items,hero,read<BattleCatalog>('battle'),stats,read<CompanionCatalog>('companions'));
  const olaf=session.party!.joinStory('mercenary-olaf');
  const original=session.bag.equipmentItems().head;
  const commands=(id:string)=>campaign.scripts[id].nodes.flatMap(node=>node.commands).filter(command=>
    command.type==='equip'||command.type==='unequip-destroy'||command.type==='world'&&command.command.kind==='actor-appearance');
  session.applyStoryCommands(commands('event-103'));
  assert.equal(session.bag.equipmentItems().head,'disguise-mask');
  assert.equal(session.bag.equipmentItems(session.bag.equipmentFor(olaf.id)).head,'disguise-mask');
  if(original)assert.equal(session.itemCount(original),1);
  assert.equal(session.storyWorld.actorAppearance('story-eara-e221699c'),'story-eara-e221699c-disguise-mask');
  const checkpoint=session.captureState();session.restoreState(checkpoint);
  session.applyStoryCommands(commands('event-108'));
  assert.equal(session.bag.equipmentItems().head,undefined);
  assert.equal(session.bag.equipmentItems(session.bag.equipmentFor(olaf.id)).head,undefined);
  assert.equal(session.itemCount('disguise-mask'),0);
  assert.equal(session.storyWorld.actorAppearance('story-eara-e221699c'),'story-eara-e221699c');
});
