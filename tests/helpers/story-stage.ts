import type { StoryStage, StoryStageSnapshot } from '../../src/domain/story-performance.ts';
import type { SceneActorState } from '../../src/domain/scene-snapshot.ts';

/** 明确构造测试场景；传入 background 才会成为快照中的背景对象。 */
export function stageSnapshot(stage: StoryStage, background: SceneActorState[] = []): StoryStageSnapshot {
  const actors: SceneActorState[] = [
    { id: 'player', actor: 'player', x: stage.x, y: stage.y, facing: stage.facing, visible: stage.playerVisible },
    ...stage.cast.map(member => ({ ...member, id: `cast:${member.id}` })),
    ...background,
  ];
  return structuredClone({ ...stage, scene: { map: stage.map, actors },
    bindings: [['player', 'player'], ...stage.cast.map(member => [member.id, `cast:${member.id}`] as [string, string])] });
}
