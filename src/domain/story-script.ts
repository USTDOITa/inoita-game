import type { ChoiceAction, ScriptAction } from './content.ts';
import type { StoryCommand, StoryEvent, StoryNode, StoryNodeRef, StoryScript } from './story-graph.ts';
import { storyExitTargets } from './story-graph.ts';

/**
 * 把作者写的动作序列编成稳定节点图：连续的表现动作合成一个节点，选择与队伍变化各自占一个节点。
 * 节点 id 按编译顺序编号，所以同一份输入总是编出同一个图。
 */
export function compileScript(name: string, actions: readonly ScriptAction[]): StoryScript {
  const nodes: StoryNode[] = [];
  let serial = 0;
  const create = (presentation: StoryNode['presentation'], commands: StoryCommand[], exit: StoryNode['exit']): StoryNode => {
    const node = { id: `scene-${++serial}`, presentation, commands, exit };
    nodes.push(node); return node;
  };
  const ref = (node: string): StoryNodeRef => ({ script: name, node });
  const compile = (list: readonly ScriptAction[], tail?: StoryNodeRef): StoryNodeRef => {
    const terminal = tail ?? ref(create([], [], { type: 'end' }).id);
    let next = terminal, buffer: StoryNode['presentation'] = [];
    const flush = () => { if (buffer.length) { next = ref(create(buffer.reverse(), [], { type: 'next', target: next }).id); buffer = []; } };
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const action = list[index];
      if (action.type === 'choice') {
        flush();
        const choice = action as ChoiceAction, cases: Record<string, StoryNodeRef> = {};
        for (const option of choice.options) {
          const mark = create([], [{ type: 'flag', flag: `choice:${name}:${option.value}` }], { type: 'next', target: next });
          cases[option.value] = compile((option.lines ?? []).map(line => ({ type: 'dialogue', ...line })), ref(mark.id));
        }
        const node = create(
          [{ ...choice, options: choice.options.map(({ lines: _, ...option }) => option) }], [],
          { type: 'choice', choice: `${name}:response-${serial + 1}`, cases });
        next = ref(node.id);
      } else if (action.type === 'party-join' || action.type === 'party-leave') {
        flush(); next = ref(create([], [action], { type: 'next', target: next }).id);
      } else buffer.push(action);
    }
    flush(); return next;
  };
  const entry = compile(structuredClone(actions));
  return { entry: entry.node, nodes };
}

/** Includes branches once; intended for resource collection and authored-action validation. */
export function storyActions(campaign: Pick<CampaignScripts, 'scripts'>): StoryNode['presentation'] {
  return Object.values(campaign.scripts).flatMap(script => script.nodes.flatMap(node => node.presentation));
}

/** Traverses declared control flow once, preserving the first route's presentation order. */
export function storyScriptActions(campaign: Pick<CampaignScripts, 'scripts'>, name: string): StoryNode['presentation'] {
  const result: StoryNode['presentation'] = [], seen = new Set<string>();
  const visit = (reference: StoryNodeRef): void => {
    const key = JSON.stringify(reference); if (seen.has(key)) return; seen.add(key);
    const node = campaign.scripts[reference.script]?.nodes.find(n => n.id === reference.node);
    if (!node) throw new Error('剧情节点缺失：' + key);
    result.push(...node.presentation); storyExitTargets(node.exit).forEach(visit);
  };
  const script = campaign.scripts[name]; if (!script) throw new Error('剧情缺失：' + name);
  visit({ script: name, node: script.entry }); return result;
}

/**
 * 从这些剧情脚本出发，收集控制流上可能切换到的地图。演出中途到达新地图会触发它的进入事件，
 * 所以进入事件的脚本继续展开——整段进图剧情会经过的每张地图都能在第一次加载里准备资源。
 * 分支与选择按所有出口展开；只读脚本，不执行剧情。
 */
export function storyReachableMaps(
  campaign: Pick<CampaignScripts, 'scripts'> & { events: readonly StoryEvent[] },
  scripts: Iterable<string>, limit = 6,
): string[] {
  const maps = new Map<string, true>();
  const visited = new Set<string>();
  const queue: StoryNodeRef[] = [];
  const enqueueScript = (name: string) => {
    const script = campaign.scripts[name];
    if (script) queue.push({ script: name, node: script.entry });
  };
  const addMap = (map: string) => {
    if (maps.has(map) || maps.size >= limit) return;
    maps.set(map, true);
    for (const event of campaign.events)
      if (event.source === 'map-entry' && (event.key === undefined || event.key === map)
        && (event.map === undefined || event.map === map)) enqueueScript(event.script);
  };
  const addAction = (action: StoryNode['presentation'][number]): void => {
    if (action.type === 'stage') { if (!action.mapFromWorld) addMap(action.map); }
    else if (action.type === 'parallel') action.actions.forEach(addAction);
  };
  for (const name of scripts) enqueueScript(name);
  while (queue.length) {
    const reference = queue.pop()!;
    const key = JSON.stringify(reference);
    if (visited.has(key) || visited.size >= 4000) continue;
    visited.add(key);
    const node = campaign.scripts[reference.script]?.nodes.find(candidate => candidate.id === reference.node);
    if (!node) continue;
    if (node.stage && !node.stage.mapFromWorld) addMap(node.stage.map);
    for (const action of node.presentation) addAction(action);
    for (const command of node.commands) {
      if (command.type === 'travel') addMap(command.destination.map);
      else if (command.type === 'world' && command.command.kind === 'travel') addMap(command.command.destination.map);
    }
    for (const target of storyExitTargets(node.exit)) queue.push(target);
  }
  return [...maps.keys()];
}

interface CampaignScripts { scripts: Record<string, StoryScript> }
