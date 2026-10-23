import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parseBattle, parseCampaign, parseCharacterStats, parseCompanions, parseItemCatalog, parseMap, parseStoryClasses, parseStoryDebugCatalog, parseWorld} from '../src/application/content-validation.ts';
import {createHeadlessStory} from '../src/debug/headless-story.ts';
import {validateDebugCatalog} from '../src/debug/catalog-validation.ts';
import type {WorldMap} from '../src/domain/content.ts';

const root = new URL('../public/content/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, root), 'utf8'));
const campaign = parseCampaign(read('campaign'));
const catalog = parseStoryDebugCatalog(read('debug/start'));
campaign.debugStory = catalog;
const world = parseWorld(read('world'));
const maps = new Map<string, WorldMap>(world.maps.map(reference =>
  [reference.id, parseMap(read('maps/' + reference.id))]));

test('the debug catalog is a valid, time-ordered snapshot', () => {
  validateDebugCatalog({campaign, maps, catalog});
  const task = catalog.tasks.find(row => row.quest === 'quest-10')!;
  assert(task, 'quest-10 应有现场表');
  assert(task.start, 'quest-10 现场表缺少 start');
  const flags = new Set(task.start!.world?.flags ?? []);
  assert(flags.has(JSON.stringify(['absent-actor', 'training-dungeon-one', 'npc-593'])),
    'quest-10 起点必须隐藏后一阶段的猎人 npc-593');
  assert(flags.has('quest-npc-located-npc-59'), '莱曼的摆放标记必须随现场表安装');
  assert(!flags.has(JSON.stringify(['absent-actor', 'training-dungeon-one', 'npc-351'])),
    'quest-10 起点应保留前一阶段的猎人 npc-351');
  const later = catalog.tasks.find(row => row.quest === 'quest-347')!;
  assert(later.start, 'quest-347 现场表缺少 start');
  const laterFlags = new Set(later.start!.world?.flags ?? []);
  assert(laterFlags.has(JSON.stringify(['absent-actor', 'training-dungeon-one', 'npc-351'])),
    'quest-347 由后一阶段的 npc-593 发布，起点必须让 npc-351 退场');
  assert(!laterFlags.has(JSON.stringify(['absent-actor', 'training-dungeon-one', 'npc-593'])),
    'quest-347 的发布人 npc-593 必须可见');
});

test('a battle event fires from the encounter that spawns its enemy', async () => {
  const story = createHeadlessStory({
    campaign, world, maps,
    items: parseItemCatalog(read('items')),
    battle: parseBattle(read('battle')),
    stats: parseCharacterStats(read('character-stats')),
    companions: parseCompanions(read('companions')),
    storyClasses: parseStoryClasses(read('story-classes')),
  });
  const event = (id: string) => campaign.events.find(row => row.id === id)!;
  await story.replayEvent(event('event-0'));
  story.travel({map: 'old-sanctuary-54cffd62', x: 104, y: 88, facing: 'south'});
  const result = await story.replayEvent(event('event-54'));
  assert.equal(result.status, 'completed');
  const state = story.capture();
  assert(state.runtime.completedEvents.includes('event-54'));
  assert(state.runtime.completedEvents.includes('event-55'),
    'event-54 的辛战斗结算后应派发 event-55');
  const flags = new Set(state.storyWorld.flags);
  assert(flags.has(JSON.stringify(['absent-actor', 'training-dungeon-one', 'npc-351'])));
  assert(!flags.has(JSON.stringify(['absent-actor', 'training-dungeon-one', 'npc-593'])));
});

test('replaying the opening and the later battle swaps the two hunters in order', async () => {
  const story = createHeadlessStory({
    campaign, world, maps,
    items: parseItemCatalog(read('items')),
    battle: parseBattle(read('battle')),
    stats: parseCharacterStats(read('character-stats')),
    companions: parseCompanions(read('companions')),
    storyClasses: parseStoryClasses(read('story-classes')),
  });
  const event = (id: string) => campaign.events.find(row => row.id === id)!;
  await story.replayEvent(event('event-0'));
  let flags = new Set(story.capture().storyWorld.flags);
  assert(flags.has(JSON.stringify(['absent-actor', 'training-dungeon-one', 'npc-593'])));
  assert(!flags.has(JSON.stringify(['absent-actor', 'training-dungeon-one', 'npc-351'])));
  story.travel({map: 'training-dungeon-one', x: 312, y: 392, facing: 'south'});
  await story.replayEvent(event('event-55'));
  flags = new Set(story.capture().storyWorld.flags);
  assert(flags.has(JSON.stringify(['absent-actor', 'training-dungeon-one', 'npc-351'])),
    'event-55 之后前一阶段的猎人应退场');
  assert(!flags.has(JSON.stringify(['absent-actor', 'training-dungeon-one', 'npc-593'])),
    'event-55 之后后一阶段的猎人应登场');
});
