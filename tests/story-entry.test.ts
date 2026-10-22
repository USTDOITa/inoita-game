import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chainedStoryScripts, directStoryMaps, localStoryScripts, storyReachableScripts } from '../src/domain/story-entry.ts';

const realCampaign = JSON.parse(readFileSync(new URL('../public/content/campaign.json', import.meta.url), 'utf8')) as Parameters<typeof localStoryScripts>[0]['campaign'];

const end = { type: 'end' as const };
const stage = (map: string) => ({ type: 'stage' as const, map, x: 0, y: 0, facing: 'south' as const, playerVisible: true, cast: [] });

function campaign() {
  return {
    scripts: {
      start: { entry: 'n', nodes: [{ id: 'n', presentation: [stage('start-next')], commands: [], exit: end }] },
      entry: { entry: 'n', nodes: [{ id: 'n', presentation: [stage('entry-next')], commands: [], exit: end }] },
      region: { entry: 'n', nodes: [{ id: 'n', presentation: [stage('region-next')], commands: [], exit: end }] },
      near: { entry: 'n', nodes: [{ id: 'n', presentation: [stage('near-next')], commands: [], exit: end }] },
      interact: { entry: 'n', nodes: [{ id: 'n', presentation: [stage('interact-next')], commands: [], exit: end }] },
      quest: { entry: 'n', nodes: [{ id: 'n', presentation: [stage('quest-next')], commands: [], exit: end }] },
      battle: { entry: 'n', nodes: [{ id: 'n', presentation: [stage('battle-next')], commands: [], exit: end }] }
    },
    events: [
      { id: 'e-start', source: 'start', script: 'start' },
      { id: 'e-entry', source: 'map-entry', key: 'map-a', script: 'entry' },
      { id: 'e-region', source: 'region', map: 'map-a', script: 'region' },
      { id: 'e-near', source: 'near', near: 'npc-actor', nearCharacterId: 'npc-1', script: 'near' },
      { id: 'e-battle', source: 'battle', key: 'defeat:goblin', script: 'battle' }
    ],
    placements: [
      { id: 'placement-id-1', map: 'map-a', actor: 'npc-actor', characterId: 'npc-1', x: 1, y: 2, condition: { type: 'always', value: true } }
    ],
    mapEntryPlacements: [],
    quests: [
      { id: 'q1', giver: 'npc-actor', giverCharacterId: 'npc-1', offerScript: 'quest', completeScript: null }
    ]
  } as unknown as Parameters<typeof localStoryScripts>[0]['campaign'];
}

const map = { id: 'map-a', entities: [{ id: 'chest', actor: 'chest-actor', x: 0, y: 0 }] } as unknown as Parameters<typeof localStoryScripts>[0]['map'];

function completed(openingFinished: boolean): string[] {
  return openingFinished ? ['e-start'] : [];
}

test('local scripts cover start, map-entry, region, near by actor, interaction, quest and battle', () => {
  const scripts = localStoryScripts({ campaign: campaign(), map, completedEvents: completed(false), enemyIds: ['goblin'] });
  assert.deepEqual(scripts.sort(), ['battle', 'entry', 'near', 'quest', 'region', 'start']);
});

test('an opening-finished session does not preload the start script', () => {
  const scripts = localStoryScripts({ campaign: campaign(), map, completedEvents: completed(true), enemyIds: ['goblin'] });
  assert.ok(!scripts.includes('start'));
});

test('near events match the actor and character, not the placement id', () => {
  const found = localStoryScripts({ campaign: campaign(), map, completedEvents: completed(true) });
  assert.ok(found.includes('near'), 'placement.id 不能作为 near 的匹配键，必须按 actor 命中');
  const wrong = campaign();
  wrong.events = wrong.events.map(event => event.id === 'e-near' ? { ...event, nearCharacterId: 'other-npc' } : event);
  const scripts = localStoryScripts({ campaign: wrong, map, completedEvents: completed(true) });
  assert.ok(!scripts.includes('near'));
});

test('afterInteractScript on a map entity is preloaded even without an event', () => {
  const withInteract = { ...map, entities: [{ id: 'chest', actor: 'chest-actor', x: 0, y: 0, afterInteractScript: 'interact' }] };
  const scripts = localStoryScripts({ campaign: campaign(), map: withInteract, completedEvents: completed(true) });
  assert.ok(scripts.includes('interact'));
});

test('a quest event whose active quest can play out on this map is prefetched, but not on unrelated maps', () => {
  const questStatus = (id: string) => id === 'quest-22' ? 'active' : 'locked';
  const cave = localStoryScripts({ campaign: realCampaign, map: { id: 'silent-cave-depths', entities: [] }, completedEvents: completed(true), questStatus });
  assert.ok(cave.includes('event-5'), '洞穴里的任务事件应在进图时一起预取，战斗结束后不再等加载');
  const camp = localStoryScripts({ campaign: realCampaign, map: { id: 'shadow-camp', entities: [] }, completedEvents: completed(true), questStatus });
  assert.ok(!camp.includes('event-5'), '与这张图无关的任务事件不应拖累入口加载');
  const idle = localStoryScripts({ campaign: realCampaign, map: { id: 'silent-cave-depths', entities: [] }, completedEvents: completed(true), questStatus: () => 'locked' });
  assert.ok(!idle.includes('event-5'), '任务没在进行中时不预取');
});

test('the cave chain prefetches the follow-up map, and spawned NPCs pull their near events', () => {
  const questStatus = (id: string) => id === 'quest-22' ? 'active' : 'locked';
  const caveLocal = localStoryScripts({ campaign: realCampaign, map: { id: 'silent-cave-depths', entities: [] }, completedEvents: completed(true), questStatus });
  const caveScripts = chainedStoryScripts(realCampaign, caveLocal);
  assert.ok(caveScripts.includes('event-5'), '事件 4 的支线必须接上事件 5');
  const caveMaps = directStoryMaps(realCampaign, storyReachableScripts(realCampaign, caveScripts), 12).maps;
  assert.ok(caveMaps.includes('silent-cave-entrance'), '战斗后的洞口地图由运行时兜底预取');

  // 事件 413 在塞伦草甸生成「回忆之门」，靠近它触发的 480/560 演到记忆层地图。
  const meadowLocal = localStoryScripts({
    campaign: realCampaign, map: { id: 'sellen-meadows-2-8fee3900', entities: [] },
    completedEvents: completed(true), questStatus: () => 'active',
  });
  const meadowScripts = chainedStoryScripts(realCampaign, meadowLocal);
  assert.ok(meadowScripts.includes('event-413'));
  assert.ok(meadowScripts.includes('event-480'), '剧情生成的人物应当接上 near 事件');
  const meadowMaps = directStoryMaps(realCampaign, storyReachableScripts(realCampaign, meadowScripts), 12).maps;
  assert.ok(meadowMaps.includes('kiyan-s-memory-layer-1-631d46d8'), '记忆层地图由运行时兜底预取');
});

test('reachable scripts follow called scripts as well as the caller continuation', () => {
  const graph = {
    scripts: {
      main: { entry: 'n1', nodes: [
        { id: 'n1', presentation: [], commands: [], exit: { type: 'call', target: { script: 'side', node: 's1' }, then: { script: 'main', node: 'n2' } } },
        { id: 'n2', presentation: [], commands: [], exit: end }
      ] },
      side: { entry: 's1', nodes: [{ id: 's1', presentation: [], commands: [], exit: end }] }
    }
  } as unknown as Parameters<typeof storyReachableScripts>[0];
  assert.deepEqual(storyReachableScripts(graph, ['main']).sort(), ['main', 'side']);
});

test('direct story maps follow all branches and report a truncated budget', () => {
  const script = {
    entry: 'n1',
    nodes: [
      { id: 'n1', presentation: [stage('b')], commands: [{ type: 'travel', destination: { map: 'c', x: 0, y: 0, facing: 'south' } }], exit: { type: 'branch', condition: {}, then: { script: 'main', node: 'n2' }, otherwise: { script: 'main', node: 'n3' } } },
      { id: 'n2', presentation: [], commands: [], exit: end },
      { id: 'n3', presentation: [stage('d')], commands: [], exit: end }
    ]
  };
  const graph = { scripts: { main: script }, events: [] } as unknown as Parameters<typeof directStoryMaps>[0];
  assert.deepEqual(directStoryMaps(graph, ['main']).maps.sort(), ['b', 'c', 'd']);
  const limited = directStoryMaps(graph, ['main'], 2);
  assert.equal(limited.maps.length, 2);
  assert.equal(limited.truncated, true);
});

test('the entry prefetch chain covers the event that will play on handover', () => {
  const map = JSON.parse(readFileSync(new URL('../public/content/maps/shadow-camp.json', import.meta.url), 'utf8'));
  // 交付刺杀任务时会在影之营地触发 event-6；进图预取用的是本图脚本的整条链。
  const local = localStoryScripts({ campaign: realCampaign, map, completedEvents: [], questStatus: () => 'ready' });
  const entry = storyReachableScripts(realCampaign, local);
  const coveredScripts = new Set(storyReachableScripts(realCampaign, chainedStoryScripts(realCampaign, entry)));
  const runtimeScripts = storyReachableScripts(realCampaign, chainedStoryScripts(realCampaign, ['event-6']));
  assert.ok(runtimeScripts.includes('event-6'));
  for (const script of runtimeScripts) assert.ok(coveredScripts.has(script), `进图链缺少 ${script}`);
  const coveredMaps = new Set(directStoryMaps(realCampaign, [...coveredScripts], 12).maps);
  for (const id of directStoryMaps(realCampaign, runtimeScripts, 12).maps) assert.ok(coveredMaps.has(id), `进图链缺少地图 ${id}`);
});

test('entry chains cover quest handovers, choices and event follow-ups', () => {
  const world = JSON.parse(readFileSync(new URL('../public/content/world.json', import.meta.url), 'utf8'));
  const mapOf = (id: string) => JSON.parse(readFileSync(new URL(`../public/content/maps/${id}.json`, import.meta.url), 'utf8'));
  const covered = new Map<string, Set<string>>();
  for (const reference of world.maps as { id: string }[]) {
    const map = mapOf(reference.id);
    const enemyIds = (map.enemySpawns ?? []).map((row: { enemyId: string }) => row.enemyId);
    // 最宽松的任务状态：所有任务都可能在本图推进，进图链必须能覆盖它们触发的剧情。
    const local = localStoryScripts({ campaign: realCampaign, map, completedEvents: [], questStatus: () => 'active', enemyIds });
    covered.set(reference.id, new Set(chainedStoryScripts(realCampaign, storyReachableScripts(realCampaign, local))));
  }
  const quests = new Map(realCampaign.quests.map(quest => [quest.id, quest]));
  const conditionQuests = (condition: unknown): string[] => {
    const ids: string[] = [];
    const walk = (value: { type?: string; quest?: string; conditions?: unknown[]; condition?: unknown } | undefined) => {
      if (!value) return;
      if (value.type === 'quest' && value.quest) ids.push(value.quest);
      for (const child of value.conditions ?? []) walk(child as never);
      walk(value.condition as never);
    };
    walk(condition as never);
    return ids;
  };
  const readyMaps = (id: string): string[] => {
    const place = quests.get(id)?.places?.ready;
    if (place?.type === 'fixed') return [place.map];
    if (place?.type === 'alternatives') return place.spots.map(spot => spot.map);
    return [];
  };
  const failures: string[] = [];
  for (const event of realCampaign.events) {
    if (event.source === 'quest') {
      const maps = new Set(conditionQuests(event.condition).flatMap(readyMaps));
      for (const id of maps) if (!covered.get(id)?.has(event.script)) failures.push(`${event.id} 在 ${id} 交付时未预取`);
    }
  }
  const choiceScript = new Map<string, string>();
  for (const [name, script] of Object.entries(realCampaign.scripts) as [string, { nodes: { exit: { type: string; choice?: string } }[] }][])
    for (const node of script.nodes) if (node.exit.type === 'choice' && node.exit.choice) choiceScript.set(node.exit.choice, name);
  const parentScript = (event: typeof realCampaign.events[number]): string | undefined => {
    if (event.source === 'choice') return choiceScript.get(event.key ?? '');
    if (event.source === 'event') {
      const parent = (event.condition as { conditions?: { type: string; event?: string }[] } | undefined)?.conditions?.find(child => child.type === 'event')?.event;
      return parent ? realCampaign.scripts[realCampaign.events.find(row => row.id === parent)?.script ?? ''] ? (realCampaign.events.find(row => row.id === parent)?.script ?? undefined) : undefined : undefined;
    }
    return undefined;
  };
  for (const event of realCampaign.events) {
    const parent = parentScript(event);
    if (!parent) continue;
    for (const [map, scripts] of covered)
      if (scripts.has(parent) && !scripts.has(event.script)) failures.push(`${event.id} 在 ${map} 的 ${parent} 之后未预取`);
  }
  assert.deepEqual(failures, []);
});

test('encounter spawns pull their battle-triggered follow-up scripts into the chain', () => {
  const content = campaign();
  const encounterExit = { type: 'waitEncounter' as const,
    encounter: { id: 'boss-battle', map: 'map-a', status: 'prepared' as const,
      spawns: [{ id: 'boss', enemyId: 'enemy-boss', x: 0, y: 0 }] },
    outcomes: { won: { script: 'boss', node: 'n' }, lost: { script: 'boss', node: 'n' } } };
  content.scripts.boss = { entry: 'n', nodes: [{ id: 'n', presentation: [], commands: [], exit: encounterExit }] };
  content.scripts.defeat = { entry: 'n', nodes: [{ id: 'n', presentation: [], commands: [], exit: end }] };
  content.scripts.low = { entry: 'n', nodes: [{ id: 'n', presentation: [], commands: [], exit: end }] };
  content.events.push({ id: 'e-boss-defeat', source: 'battle', key: 'defeat:enemy-boss', script: 'defeat' });
  content.events.push({ id: 'e-boss-low', source: 'battle', key: 'health-below-30:enemy-boss', script: 'low' });
  const chained = chainedStoryScripts(content, ['boss']);
  assert.ok(chained.includes('defeat'), '击杀遭遇战敌人的事件要一起预取');
  assert.ok(chained.includes('low'), '低血量触发的战斗演出也要一起预取');
});
