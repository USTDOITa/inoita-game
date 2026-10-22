import test from 'node:test';
import assert from 'node:assert/strict';
import { storyCommitCommands } from '../src/domain/story-commit.ts';
import { StoryWorldState, type StoryWorldSnapshot } from '../src/domain/story-world.ts';
import type { StoryNodeCommit, StoryRuntimeSnapshot } from '../src/domain/story-runtime.ts';
import type { StoryCommand } from '../src/domain/story-graph.ts';

/**
 * 隐式舞台绑定（每次提交都把当前舞台的角色名单写回世界）与脚本显式移除的关系。
 * event-57 的 done 节点正是靠这条路径把 scene-1 刚移除的路障写回来的。
 */
const runtime: StoryRuntimeSnapshot = { version: 1, sequence: 0, runs: [], completedEvents: [],
  handledOccurrences: [], encounterResults: [], pendingOccurrences: [], occurrenceSequences: [] };
const ENTITY = { id: 'quest-npc-located-npc-121', map: 'castle02', actor: 'barricade-307ed4dd',
  characterId: 'npc-121', x: 568, y: 216, facing: 'south' as const, visible: true };

function world(snapshot: Partial<StoryWorldSnapshot> = {}): StoryWorldState {
  const state = new StoryWorldState();
  state.restoreState({ entities: [ENTITY], exits: [], flags: [], choices: [], encounters: [], mapVisit: 0, ...snapshot });
  return state;
}
function commit(commands: StoryNodeCommit['commands'] = [], stage?: StoryNodeCommit['stage']): StoryNodeCommit {
  return { commands, checkpoint: runtime, node: { script: 'event-57', node: 'done' }, runId: 'run', stage };
}
const placesOf = (commands: readonly StoryCommand[], id = ENTITY.id): number =>
  commands.filter(command => command.type === 'world' && command.command.kind === 'place'
    && command.command.entity.id === id).length;

test('implicit stage bindings do not revive an entity the script removed', () => {
  const state = world();
  state.apply({ kind: 'remove', id: ENTITY.id });
  assert.equal(state.entity(ENTITY.id)!.removed, true);
  const commands = storyCommitCommands(commit(), state, [ENTITY]);
  assert.equal(placesOf(commands), 0, '已移除的角色不再被隐式绑定写回');
  for (const command of commands) if (command.type === 'world') state.apply(command.command);
  assert.equal(state.entity(ENTITY.id)!.removed, true, '提交后仍保持移除');
});

test('implicit stage bindings still place actors that are only hidden or moved', () => {
  const state = world();
  state.apply({ kind: 'hide', id: ENTITY.id });
  const commands = storyCommitCommands(commit(), state, [{ ...ENTITY, x: 600, y: 240 }]);
  assert.equal(placesOf(commands), 1, '只是隐藏或换位的角色照常写回');
  for (const command of commands) if (command.type === 'world') state.apply(command.command);
  assert.equal(state.entity(ENTITY.id)!.x, 600);
  assert.equal(state.entity(ENTITY.id)!.visible, true);
});

test('an explicit place or show in the node still revives a removed entity', () => {
  for (const kind of ['place', 'show'] as const) {
    const state = world();
    state.apply({ kind: 'remove', id: ENTITY.id });
    const node = kind === 'place'
      ? { type: 'world' as const, command: { kind, entity: ENTITY } }
      : { type: 'world' as const, command: { kind, id: ENTITY.id } };
    const commands = storyCommitCommands(commit([node]), state, [ENTITY]);
    for (const command of commands) if (command.type === 'world') state.apply(command.command);
    assert.equal(state.entity(ENTITY.id)!.removed, false, `${kind} 是内容明确要求的复活`);
  }
});

test('bindings still skip entities registered on another map', () => {
  const state = world();
  state.apply({ kind: 'place', entity: { ...ENTITY, map: 'castle01' } });
  const commands = storyCommitCommands(commit(), state, [ENTITY]);
  assert.equal(placesOf(commands), 0, '跨图实体不参与本图绑定');
  assert.equal(state.entity(ENTITY.id)!.map, 'castle01');
});

const caveStage = (x: number, y: number, facing: 'south' | 'east' = 'south'): NonNullable<StoryNodeCommit['stage']> => ({
  type: 'stage', map: 'silent-cave-depths', x, y, facing, playerVisible: true,
  retainPlayerPosition: true, cast: []
});
const committedRun = (stage: StoryNodeCommit['stage']): StoryRuntimeSnapshot => ({
  ...runtime, runs: [{ id: 'run', script: 'event-4', occurrence: 'event-4', cursor: { script: 'event-4', node: 'scene-1' },
    status: 'completed', stage }]
});
const atEntrance = () => world({ location: { map: 'silent-cave-depths', x: 40, y: 168, facing: 'east' } });

test('retained player position still writes back where the performance walks him', () => {
  const performed = caveStage(104, 184, 'east');
  const node: StoryNodeCommit = { commands: [], checkpoint: committedRun(performed), node: { script: 'event-4', node: 'scene-1' }, runId: 'run', stage: performed };
  const commands = storyCommitCommands(node, atEntrance(), []);
  const travel = commands.find(command => command.type === 'travel');
  assert.deepEqual(travel && travel.type === 'travel' && travel.destination,
    { map: 'silent-cave-depths', x: 104, y: 184, facing: 'east' },
    '事件 4 的凯恩从洞口走进来后，战斗应当从他停下的位置开始');
});

test('retained player position without a performance frame is not treated as a move', () => {
  const anchor = caveStage(200, 184);
  const node: StoryNodeCommit = { commands: [], checkpoint: committedRun(anchor), node: { script: 'event-4', node: 'scene-1' }, runId: 'run', stage: undefined };
  const commands = storyCommitCommands(node, atEntrance(), []);
  assert.equal(commands.some(command => command.type === 'travel'), false,
    '无表现层时只能拿到脚本兜底锚点，不能把主角传送过去');
});

test('a retained stage that leaves the player standing still does not submit a move', () => {
  const performed = caveStage(40, 168, 'east');
  const node: StoryNodeCommit = { commands: [], checkpoint: committedRun(performed), node: { script: 'event-4', node: 'scene-1' }, runId: 'run', stage: performed };
  const commands = storyCommitCommands(node, atEntrance(), []);
  assert.equal(commands.some(command => command.type === 'travel'), false);
});
