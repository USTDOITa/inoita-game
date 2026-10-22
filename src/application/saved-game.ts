import {newStorySession,type StoryClassCatalog} from '../domain/story-class.ts';
import {restoreSaveGame,type SaveGame} from '../domain/save-game.ts';
import {prepareCombatRestore} from '../domain/combat-snapshot.ts';
import type {Campaign} from '../domain/campaign.ts';
import type {WorldIndex} from '../domain/content.ts';
import type {ItemCatalog} from '../domain/items.ts';
import type {CharacterStatsCatalog} from '../domain/character-stats.ts';
import type {BattleCatalog} from '../domain/battle.ts';
import type {CompanionCatalog} from '../domain/party.ts';
import type {StoryWorldViewSnapshot} from '../scenes/world-scene.ts';

export interface SavedGameContent {
  campaign:Campaign;world:WorldIndex;storyClasses:StoryClassCatalog;items:ItemCatalog;
  characterStats:CharacterStatsCatalog;battleCatalog:BattleCatalog;companions:CompanionCatalog;
}
/** 候选会话独立于当前游戏，坏记录在切换场景之前被拒绝。 */
export function prepareSavedGame(game:SaveGame<StoryWorldViewSnapshot>,content:SavedGameContent){
  const selected=content.storyClasses.classes.find(entry=>entry.id===game.summary.classId);
  if(!selected)throw new Error('存档记录的职业在当前内容里不存在');
  const world=structuredClone(game.world),location=world?.location;
  const map=content.world.maps.find(entry=>entry.id===location?.map);
  if(!map||game.summary.mapId!==location.map||!Number.isFinite(location.x)||!Number.isFinite(location.y)||
    !['north','south','east','west'].includes(location.facing))throw new Error('存档记录的地图或位置无效');
  if(!Array.isArray(world.generatedEntities)||new Set(world.generatedEntities.map(entity=>entity.id)).size!==world.generatedEntities.length||
    world.generatedEntities.some(entity=>!content.world.actors[entity.actor]||!Number.isFinite(entity.x)||!Number.isFinite(entity.y)))throw new Error('存档记录的地图人物无效');
  const session=newStorySession(content.campaign,content.world.actors[content.campaign.start.actor],selected,
    content.items,content.characterStats,content.battleCatalog,content.companions);
  restoreSaveGame(session,game);
  if(world.world)world.world=prepareCombatRestore(world.world,content.battleCatalog,session.party?.activeIds??[]);
  return {session,world,map};
}
