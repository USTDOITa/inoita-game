import type { ActorDefinition } from './content.ts';
import type { Campaign } from './campaign.ts';
import type { StoryPlayerState } from './story-interface.ts';
import { Session } from './session.ts';
import type { ItemCatalog } from './items.ts';
import { BattleCharacter, type CharacterStatsCatalog } from './character-stats.ts';
import type { BattleCatalog } from './battle.ts';
import type { CompanionCatalog } from './party.ts';

export interface StoryClass {
  id: string;
  name: string;
  description: string;
  icon: string;
  attributes: { name: string; value: number }[];
  previewActor: ActorDefinition;
  playerActor: ActorDefinition;
  player: StoryPlayerState;
}
export interface StoryClassCatalog {
  defaultClass: string;
  background: string;
  assets: { selected: string; title: string; back: string; start: string; startPressed: string;
    descriptionTop: string; attributesTop: string; panelLeft: string; panelRight: string };
  classes: StoryClass[];
}

/** 职业决定装备与属性；剧情仍通过同一个主角身份引用凯恩。 */
export function newStorySession(campaign: Campaign, hero: ActorDefinition, selected: StoryClass, items?: ItemCatalog, stats?:CharacterStatsCatalog, battle?:BattleCatalog, companions?:CompanionCatalog): Session {
  const appearance = { ...hero, clips: selected.playerActor.clips,
    effectAnchor: selected.playerActor.effectAnchor ?? hero.effectAnchor };
  const fighter=items&&stats?new BattleCharacter(selected.id,stats,items):undefined;
  return new Session(campaign, selected.player, { classId: selected.id, appearance }, items, fighter,battle,stats,companions);
}
