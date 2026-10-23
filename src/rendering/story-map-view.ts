import type Phaser from 'phaser';
import type { ActorDefinition, EntityPlacement, WorldMap } from '../domain/content.ts';
import { createCharacter, type CharacterVisual } from './characters.ts';
import { drawMapLayers } from './map-layers.ts';

/** 舞台背景里要画出的地图人物；由调用方按剧情投影算好，视图不判断剧情可见性。 */
export interface StoryMapCharacter {
  entity: EntityPlacement;
  actor: ActorDefinition;
}

/** 演出地图绘制背景与调用方给定的地图人物；宝箱、泉水和舞台演员由调用方排除。 */
export function drawStoryMap(scene: Phaser.Scene, map: WorldMap, characters: readonly StoryMapCharacter[] = []): () => void {
  const visuals: CharacterVisual[] = [];
  const layers = drawMapLayers(scene, map, { keyPrefix: 'story-dodge' });
  const destroyCharacters = () => {
    for (const character of visuals) if (character.container.scene) character.container.destroy();
    visuals.length = 0;
  };
  try {
    for (const { entity, actor } of characters) visuals.push(createCharacter(scene, actor, entity));
  } catch (error) {
    destroyCharacters();
    layers.destroy();
    throw error;
  }
  return () => { destroyCharacters(); layers.destroy(); };
}
