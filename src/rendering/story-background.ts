import type { Campaign } from '../domain/campaign.ts';
import type { ActorDefinition, WorldMap } from '../domain/content.ts';
import { storyStageWorldCast, type StoryStage } from '../domain/story-performance.ts';
import type { StoryWorldState } from '../domain/story-world.ts';
import type { StoryMapCharacter } from './story-map-view.ts';

export interface StageBackground {
  characters: StoryMapCharacter[];
  /** 需要预载的角色外观；同一外观只列一次。 */
  actorIds: Set<string>;
}

/**
 * 演出舞台的背景人物。投影规则与正式世界一致：剧情摆放覆盖同身份的静态 NPC，
 * 被剧情标记为不在场的人不画，剧情临时摆放的任务 NPC 也画出来。
 *
 * 舞台演员由演出端单独创建，这里跳过同一世界实体/同一人物身份；宝箱和泉水有本局状态，
 * 只画静态外观会骗人，也一并跳过。
 */
export function stageBackground(
  map: WorldMap,
  stage: Pick<StoryStage, 'cast' | 'resetActors'>,
  campaign: Pick<Campaign, 'placements'>,
  actors: Readonly<Record<string, ActorDefinition>>,
  world: Pick<StoryWorldState, 'projectEntities' | 'visible' | 'visit' | 'currentLocation' | 'actorAppearance'>,
  evaluate: Parameters<typeof storyStageWorldCast>[3],
): StageBackground {
  const castEntities = new Set(stage.cast.flatMap(member => member.worldEntityId ? [member.worldEntityId] : []));
  const castCharacters = new Set(stage.cast.flatMap(member => member.characterId ? [member.characterId] : []));
  const springEntities = new Set([...map.entities, ...campaign.placements]
    .filter(entity => entity.spring).map(entity => entity.id));
  const characters: StoryMapCharacter[] = [];
  const actorIds = new Set<string>();
  for (const member of storyStageWorldCast(map, campaign.placements, world, evaluate, stage.resetActors)) {
    if (castEntities.has(member.id) || (member.characterId && castCharacters.has(member.characterId)) || springEntities.has(member.id)) continue;
    const actor = actors[world.actorAppearance(member.actor)];
    if (!actor || actor.chest) continue;
    characters.push({ entity: member, actor });
    actorIds.add(actor.id);
  }
  return { characters, actorIds };
}
