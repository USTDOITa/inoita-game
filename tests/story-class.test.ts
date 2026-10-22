import { storyScriptActions } from '../src/domain/story-script.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBattle, parseCampaign, parseWorld, parseStoryClasses, parseCharacterStats, parseItemCatalog } from '../src/application/content-validation.ts';
import { newStorySession } from '../src/domain/story-class.ts';
import { NavigationWorld } from '../src/domain/navigation-world.ts';
import { canStandOnTerrain } from '../src/domain/navigation.ts';

const read = (file: string) => JSON.parse(fs.readFileSync(new URL('../public/content/'+file, import.meta.url), 'utf8'));
const catalog = parseStoryClasses(read('story-classes.json'));
const items = parseItemCatalog(read('items.json'));
const campaign = parseCampaign(read('campaign.json'));
const battle = parseBattle(read('battle.json')), stats = parseCharacterStats(read('character-stats.json'));
const world = parseWorld(read('world.json'));
const hero = world.actors[campaign.start.actor];

test('each story class supplies its own equipment and stats without changing story identity', () => {
  assert.equal(catalog.defaultClass, 'dark-knight');
  for (const entry of catalog.classes) {
    const session = newStorySession(campaign, hero, entry);
    assert.equal(session.character?.classId, entry.id);
    assert.equal(session.character?.appearance.id, hero.id);
    assert.equal(session.character?.appearance.portrait, hero.portrait);
    assert.equal(session.character?.appearance.clips, entry.playerActor.clips);
    assert.notEqual(session.character?.appearance.clips, entry.previewActor.clips);
    assert.deepEqual(session.player, entry.player);
    assert.notEqual(session.player, entry.player);
  }
});

test('new stories start with original potion supply and class equipment', () => {
  assert.deepEqual(items.startingInventory,[{item:'healing-potion-s',quantity:5}]);
  assert.equal(items.startingShortcut,'healing-potion-s');
  for(const entry of catalog.classes){
    const session=newStorySession(campaign,hero,entry,items,stats,battle);
    assert.deepEqual(session.bag.entries.map(({item,quantity})=>({item,quantity})),items.startingInventory);
    assert.deepEqual(session.bag.equipmentItems(),items.startingEquipment[entry.id]);
    assert.ok(session.skills.bar().assigned('item',items.startingShortcut),'开局的药水就配在第一组快捷栏上');
  }
});

test('starting another story clears quest progress, flags and collected items', () => {
  const previous = newStorySession(campaign, hero, catalog.classes[1],items,stats,battle);
  previous.setHealth(1);
  assert.ok(previous.recovery.use(previous.bag,previous.bag.entries[0].id,
    [{id:'player',player:previous.player!,setHealth:value=>previous.setHealth(value),setMana:value=>previous.hero!.setMana(value)}],'player').used);
  previous.mark('opening-finished'); previous.accept(campaign.quests[0].id);
  previous.accept('grafton-mission');
  previous.enemyDefeated({id:'earl',enemyId:'enemy-earl-grafton-1',x:0,y:0});
  assert.equal(previous.complete('grafton-mission'),true);
  previous.accept('knight-uniform');previous.bag.add('ectoplasm',2);
  const next = newStorySession(campaign, hero, catalog.classes[4],items,stats,battle);
  assert.equal(next.character?.classId, catalog.classes[4].id);
  assert.equal(next.flags.size, 0);
  assert.equal(next.storyWorld.captureState().entities.length, 0);
  assert.deepEqual(next.bag.entries.map(({item,quantity})=>({item,quantity})),items.startingInventory);
  assert.ok(next.skills.bar().assigned('item',items.startingShortcut));
  assert.equal(next.recovery.cooldown.cooling,false);
  assert.equal(previous.recovery.cooldown.cooling,true);
  assert.equal(next.status(campaign.quests[0].id), 'available');
  assert.ok(previous.flags.has('opening-finished'));
});

test('opening starts covered and places the player at the original camp foothold', () => {
  assert.equal(campaign.start.x, 120); assert.equal(campaign.start.y, 312);
  const opening = storyScriptActions(campaign, campaign.start.script);
  assert.deepEqual(opening[0], { type: 'fade', opacity: 1, color: 0, durationMs: 0 });
  const stage = opening.find(action => action.type === 'stage' && action.x === campaign.start.x && action.y === campaign.start.y)!;
  assert.ok(stage.type === 'stage');
  assert.equal(stage.x, campaign.start.x); assert.equal(stage.y, campaign.start.y);
  const map = read('maps/shadow-camp.json');
  assert.ok(canStandOnTerrain(map, campaign.start.x, campaign.start.y));
  assert.deepEqual(new NavigationWorld(map).nearest({}, { x: campaign.start.x, y: campaign.start.y }), { x: 120, y: 312 });
  const reveal = opening.findIndex(action => action.type === 'fade' && action.opacity === 0);
  assert.equal(opening.slice(0, reveal).filter(action => action.type === 'dialogue').length, 6);
});

test('cross-map performances place native actors before the map is revealed', () => {
  for (const name of ['event-1', 'event-7']) {
    const actions=storyScriptActions(campaign,name),first=actions[0];
    assert.equal(first?.type,'stage',name);
    assert.ok(first?.type==='stage' && first.cast.length>0,name);
    const reveal=actions.findIndex(action=>action.type==='fade'&&action.opacity===0);
    assert.ok(reveal>0,name);
    if(first?.type!=='stage')continue;
    for(const member of first.cast){
      // 未定位的继承角色是否在场由世界投影决定；不在场时演出的 face/camera/effect
      // 都会被 StoryPresenter.present() 跳过，不能要求它在揭幕前 appear。
      if(member.unpositioned)continue;
      assert.ok(member.visible || actions.slice(0,reveal).some(action=>action.type==='appear'&&action.target===member.id),`${name}: ${member.id}`);
    }
  }
});

test('class content rejects missing defaults, duplicate choices and incomplete player poses', () => {
  const missing = structuredClone(catalog); missing.defaultClass = 'unknown';
  assert.throws(() => parseStoryClasses(missing), /默认职业不存在/);
  const duplicate = structuredClone(catalog); duplicate.classes[1].id = duplicate.classes[0].id;
  assert.throws(() => parseStoryClasses(duplicate), /六个不同职业/);
  const pose = structuredClone(catalog); delete pose.classes[0].playerActor.clips['walk-east'];
  assert.throws(() => parseStoryClasses(pose), /walk-east/);
});

test('class selection requires both native panel headers and their shared side pieces', () => {
  for (const key of ['descriptionTop', 'attributesTop', 'panelLeft', 'panelRight'] as const) {
    const missing = structuredClone(catalog);
    delete (missing.assets as Partial<typeof catalog.assets>)[key];
    assert.throws(() => parseStoryClasses(missing), new RegExp(key));
    const outside = structuredClone(catalog);
    outside.assets[key] = '../work/panel.png';
    assert.throws(() => parseStoryClasses(outside), /内部资源路径/);
  }
});
