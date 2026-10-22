import type { Campaign } from './campaign.ts';
import type { EntityPlacement, WorldMap } from './content.ts';
import type { StoryEvent } from './story-graph.ts';
import { storyExitTargets } from './story-graph.ts';
import type { StoryCondition } from './story-condition.ts';
import { storyReachableMaps } from './story-script.ts';

/** 条件里引用的任务 id（递归展开 all/any/not）。 */
function conditionQuestIds(condition: StoryCondition | undefined): string[] {
  if (!condition) return [];
  if (condition.type === 'quest') return [condition.quest];
  if (condition.type === 'all' || condition.type === 'any') return condition.conditions.flatMap(conditionQuestIds);
  if (condition.type === 'not') return conditionQuestIds(condition.condition);
  return [];
}

/** 条件里引用的事件 / 选择 id，用于沿剧情链预取后续脚本。 */
function conditionIds(condition: StoryCondition | undefined, kind: 'event' | 'choice'): string[] {
  if (!condition) return [];
  if (kind === 'event' && condition.type === 'event') return [condition.event];
  if (kind === 'choice' && condition.type === 'choice') return [condition.choice];
  if (condition.type === 'all' || condition.type === 'any') return condition.conditions.flatMap(child => conditionIds(child, kind));
  if (condition.type === 'not') return conditionIds(condition.condition, kind);
  return [];
}

interface StoryFacts {
  quests: Set<string>;
  events: Set<string>;
  choices: Set<string>;
  items: Set<string>;
  /** 剧情生成的人物（actor / characterId）与遭遇战敌人，用于接上 near/interaction/battle。 */
  actors: Set<string>;
  enemies: Set<string>;
}

/**
 * 从这些脚本出发，沿「脚本会产生的触发事实」展开后续事件：完成的任务、完成的事件、
 * 出现过的选择、给出的物品。开演前的运行时兜底据此把同一条剧情链后面的地图
 * 一起加载，避免战斗中推进任务后再现读下一张图。最多展开 `limit` 个脚本。
 */
export function chainedStoryScripts(
  campaign: Pick<Campaign, 'scripts' | 'events'>,
  seeds: Iterable<string>,
  limit = 256,
): string[] {
  const scripts = new Set<string>();
  const scanned = new Set<string>();
  const facts: StoryFacts = { quests: new Set(), events: new Set(), choices: new Set(), items: new Set(), actors: new Set(), enemies: new Set() };
  const queue: string[] = [];
  const add = (script: string) => { if (campaign.scripts[script] && !scripts.has(script) && scripts.size < limit) { scripts.add(script); queue.push(script); } };
  for (const seed of seeds) add(seed);
  for (const event of campaign.events) if (scripts.has(event.script)) facts.events.add(event.id);
  const absorb = (script: string) => {
    for (const reachable of storyReachableScripts(campaign, [script])) {
      if (scanned.has(reachable)) continue;
      scanned.add(reachable);
      const definition = campaign.scripts[reachable];
      if (!definition) continue;
      for (const node of definition.nodes) {
        for (const command of node.commands) {
          if (command.type === 'quest' && 'quest' in command.command) facts.quests.add(command.command.quest);
          else if (command.type === 'choice') facts.choices.add(command.choice);
          else if (command.type === 'item-give') facts.items.add(command.item);
          else if (command.type === 'encounter') for (const spawn of command.encounter.spawns) facts.enemies.add(spawn.enemyId);
          else if (command.type === 'world') {
            const change = command.command;
            if (change.kind === 'place') {
              if (change.entity.actor) facts.actors.add(change.entity.actor);
              if (change.entity.characterId) facts.actors.add(change.entity.characterId);
            }
          }
        }
        // 玩家在这段脚本里可能做过的选择：分支出口的键就是 choice 事件的触发键。
        if (node.exit.type === 'choice') facts.choices.add(node.exit.choice);
        // 遭遇战刷出来的敌人：战斗中的 `defeat:`/`health-below-30:` 事件由它们触发，
        // 不进 facts 的话战斗一开打就会在演出前临时加载。
        if (node.exit.type === 'waitEncounter') for (const spawn of node.exit.encounter.spawns) facts.enemies.add(spawn.enemyId);
      }
    }
  };
  while (queue.length) {
    absorb(queue.shift()!);
    for (const event of campaign.events) {
      if (scripts.has(event.script)) continue;
      const matched = event.source === 'quest' ? conditionQuestIds(event.condition).some(id => facts.quests.has(id))
        : event.source === 'event' ? (event.key !== undefined && facts.events.has(event.key)) || conditionIds(event.condition, 'event').some(id => facts.events.has(id))
        : event.source === 'choice' ? (event.key !== undefined && facts.choices.has(event.key)) || conditionIds(event.condition, 'choice').some(id => facts.choices.has(id))
        : event.source === 'near' ? event.near !== undefined && (facts.actors.has(event.near) || (event.nearCharacterId !== undefined && facts.actors.has(event.nearCharacterId)))
        : event.source === 'interaction' ? event.key !== undefined && facts.actors.has(event.key)
        : event.source === 'battle'
          ? (event.key?.startsWith('defeat:') === true && facts.enemies.has(event.key.slice('defeat:'.length)))
            || (event.key?.startsWith('health-below-30:') === true && facts.enemies.has(event.key.slice('health-below-30:'.length)))
        : false;
      if (!matched) continue;
      add(event.script);
      facts.events.add(event.id);
      if (scripts.size >= limit) break;
    }
  }
  return [...scripts];
}

export interface LocalStoryScriptsInput {
  campaign: Pick<Campaign, 'events' | 'placements' | 'mapEntryPlacements' | 'quests' | 'scripts'>;
  map: Pick<WorldMap, 'id' | 'entities'>;
  /** 当前地图上已经投影出来的人物；省略时只用静态摆放。 */
  entities?: readonly EntityPlacement[];
  /** 已经完成的剧情事件 id；start 事件全部完成后不再把开场算进本图。 */
  completedEvents?: readonly string[];
  /** 当前会话的任务状态；quest 事件在条件引用的任务已经进行中时可能很快触发。 */
  questStatus?: (id: string) => string;
  /** 本图可能出现的敌人 id，用于归位 battle 事件；不传时不预取 battle 脚本。 */
  enemyIds?: Iterable<string>;
}

/**
 * 这张图上可能触发的剧情脚本。入口加载只阻塞在这里列出的脚本所到达的地图；
 * quest/inventory/choice/event 这类无法静态定位的全局事件由运行时兜底。
 * `quest` 事件在条件引用的任务已经进行中时也算「本图可能出现」：战斗结算把它推进到
 * ready 后就会在这张图上起演，入口阶段把它到达的地图一起预取，避免演出中再弹加载。
 */
export function localStoryScripts({ campaign, map, entities = [], completedEvents = [], questStatus, enemyIds }: LocalStoryScriptsInput): string[] {
  const scripts = new Set<string>();
  const local = [
    ...map.entities,
    ...campaign.placements.filter(placement => placement.map === map.id),
    ...(campaign.mapEntryPlacements ?? []).filter(placement => placement.map === map.id),
    ...entities
  ];
  const enemies = new Set(enemyIds ?? []);
  const nearMatches = (event: StoryEvent): boolean => event.near !== undefined && local.some(entity =>
    entity.actor === event.near && (event.nearCharacterId === undefined || (entity.characterId ?? entity.actor) === event.nearCharacterId));
  const actorOnMap = (actor: string | undefined, characterId?: string): boolean => local.some(entity =>
    (actor === undefined || entity.actor === actor) &&
    (characterId === undefined || (entity.characterId ?? entity.actor) === characterId));
  const battleEnemy = (key: string | undefined): string | undefined => {
    if (!key) return undefined;
    if (key.startsWith('defeat:')) return key.slice('defeat:'.length);
    if (key.startsWith('health-below-30:')) return key.slice('health-below-30:'.length);
    return undefined;
  };
  const quests = new Map(campaign.quests.map(quest => [quest.id, quest]));
  const placeHere = (place: { type: string; map?: string; spots?: readonly { map: string }[] } | undefined): boolean =>
    place?.type === 'fixed' ? place.map === map.id
      : place?.type === 'alternatives' ? (place.spots ?? []).some(spot => spot.map === map.id) : false;
  /**
   * 这个任务能不能在这张图上接取、推进或交付。任务事件的条件写的是任务状态，
   * 变化就发生在这里；刷新后事件可能演到别的地图，所以不能只看事件自己到达哪张图。
   */
  const questPlaysHere = (id: string): boolean => {
    const quest = quests.get(id);
    if (!quest) return false;
    if ([quest.places?.available, quest.places?.active, quest.places?.ready].some(placeHere)) return true;
    const giver = (quest.giver !== undefined || quest.giverCharacterId !== undefined) && actorOnMap(quest.giver, quest.giverCharacterId);
    const delivery = (quest.delivery !== undefined || quest.deliveryCharacterId !== undefined) && actorOnMap(quest.delivery, quest.deliveryCharacterId);
    return !!(giver || delivery);
  };

  for (const event of campaign.events) {
    if (event.source === 'start') {
      if (!completedEvents.includes(event.id)) scripts.add(event.script);
    } else if (event.source === 'map-entry') {
      if ((event.key === undefined || event.key === map.id) && (event.map === undefined || event.map === map.id)) scripts.add(event.script);
    } else if (event.source === 'region') {
      if (event.map === map.id) scripts.add(event.script);
    } else if (event.source === 'near') {
      if (nearMatches(event)) scripts.add(event.script);
    } else if (event.source === 'interaction') {
      if (event.key === undefined || local.some(entity => entity.actor === event.key)) scripts.add(event.script);
    } else if (event.source === 'battle') {
      const enemy = battleEnemy(event.key);
      if (enemy !== undefined && enemies.has(enemy)) scripts.add(event.script);
    } else if (event.source === 'quest' && questStatus) {
      const ids = conditionQuestIds(event.condition);
      const pending = ids.some(id => {
        const status = questStatus(id);
        return status === 'active' || status === 'ready';
      });
      // 两种都算本图可能出现：剧情会演到这张图；或任务能在这张图上变化（交付/接取/推进），
      // 即使演出会跑到别的地图，也要在进图时把那条链一起装好。
      const reachable = pending && storyReachableMaps(campaign, [event.script]).includes(map.id);
      const relevant = ids.some(id => questStatus(id) !== 'locked' && questPlaysHere(id));
      if (reachable || relevant) scripts.add(event.script);
    }
  }
  for (const entity of local) if (entity.afterInteractScript) scripts.add(entity.afterInteractScript);
  for (const quest of campaign.quests) {
    const giver = (quest.giver !== undefined || quest.giverCharacterId !== undefined) && actorOnMap(quest.giver, quest.giverCharacterId);
    const delivery = (quest.delivery !== undefined || quest.deliveryCharacterId !== undefined) && actorOnMap(quest.delivery, quest.deliveryCharacterId);
    if (!giver && !delivery) continue;
    if (quest.offerScript) scripts.add(quest.offerScript);
    if (quest.completeScript) scripts.add(quest.completeScript);
  }
  return [...scripts];
}

/** 沿 call/分支/选择等控制流展开，返回这些入口会执行到的全部脚本。 */
export function storyReachableScripts(campaign: Pick<Campaign, 'scripts'>, scripts: Iterable<string>): string[] {
  const result = new Set<string>();
  const visited = new Set<string>();
  const queue: { script: string; node: string }[] = [];
  for (const name of scripts) {
    const script = campaign.scripts[name];
    if (script) queue.push({ script: name, node: script.entry });
  }
  while (queue.length) {
    const reference = queue.pop()!;
    const key = `${reference.script}:${reference.node}`;
    if (visited.has(key) || visited.size >= 4000) continue;
    visited.add(key);
    result.add(reference.script);
    const node = campaign.scripts[reference.script]?.nodes.find(candidate => candidate.id === reference.node);
    if (!node) continue;
    for (const target of storyExitTargets(node.exit)) queue.push(target);
  }
  return [...result];
}

export interface DirectStoryMaps {
  maps: string[];
  truncated: boolean;
}

/**
 * 这些脚本控制流上直接到达/演到的地图。多取一张用来判断是否超出预算；
 * 超出部分交给目的地进入时的加载和运行时兜底，不静默丢掉。
 */
export function directStoryMaps(campaign: Pick<Campaign, 'scripts' | 'events'>, scripts: Iterable<string>, limit = 12): DirectStoryMaps {
  const found = storyReachableMaps(campaign, scripts, limit + 1);
  return { maps: found.slice(0, limit), truncated: found.length > limit };
}
