import type { StoryCommand } from './story-graph.ts';
import type { StoryNodeCommit } from './story-runtime.ts';
import type { StoryWorldState, StoryEntityState } from './story-world.ts';

/** 正常演出和调试预演共用角色落位、转场及事件完成的提交规则。 */
export function storyCommitCommands(commit: StoryNodeCommit, world: StoryWorldState, changes: readonly StoryEntityState[]): StoryCommand[] {
  const commands = [...commit.commands];
  const run = commit.checkpoint.runs.find(candidate => candidate.id === commit.runId);
  const explicitTravel = commands.some(command => command.type === 'travel' || command.type === 'world' && command.command.kind === 'travel');
  const stage = commit.stage ?? run?.stage;
  const bindings: StoryCommand[] = [];
  for (const entity of changes) {
    if (!entity.map || !entity.actor || entity.x === undefined || entity.y === undefined) throw new Error('绑定剧情角色缺少地图与位置');
    const existing=world.entity(entity.id);
    // 隐式绑定只是把当前舞台的角色名单写回世界，不能复活脚本已经明确移除的实体
    // （event-57 的 done 节点会重发上一幕的 cast，把 scene-1 刚移除的路障写回来）。
    // 内容要求复活时用显式 place / show，它们不受这条限制。
    if(existing?.removed)continue;
    if(existing?.map&&existing.map!==entity.map)continue;
    const persistent=existing?.map&&existing.actor&&existing.mapVisit===undefined;
    bindings.push({type:'world',command:{kind:'place',...(!persistent?{scope:'visit' as const}:{}),entity:{...entity,map:entity.map,actor:entity.actor,x:entity.x,y:entity.y}}});
  }
  commands.unshift(...bindings);
  // `retainPlayerPosition` 只说明这一幕从主角真实站位起步，不意味着整段都没动过他：
  // 演出里出现过 `walk`/`face` 时，表现层的最终帧已经和入场位置不同，收尾仍要把这个位置写回。
  // 没有表现层时只拿到脚本里的兜底锚点，保持不提交（见 findings 106）。
  const performed = commit.stage;
  const moved = !!performed && (!world.currentLocation || performed.map !== world.currentLocation.map ||
    performed.x !== world.currentLocation.x || performed.y !== world.currentLocation.y ||
    performed.facing !== world.currentLocation.facing);
  if ((run?.status === 'completed' || run?.status === 'waiting') && stage && !explicitTravel && (!stage.retainPlayerPosition || moved))
    commands.push({type:'travel',destination:{map:stage.map,x:stage.x,y:stage.y,facing:stage.facing}});
  if(commit.eventId&&run?.status==='completed')commands.push({type:'flag',flag:commit.eventId});
  return commands;
}
