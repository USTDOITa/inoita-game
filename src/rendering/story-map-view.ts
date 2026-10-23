import type Phaser from 'phaser';
import type { ActorDefinition, WorldMap } from '../domain/content.ts';
import type { SceneActorState } from '../domain/scene-snapshot.ts';
import { createCharacter, setCharacterClip, type CharacterVisual } from './characters.ts';
import { drawMapLayers } from './map-layers.ts';

/** 地图图层与完整对象名单分别构造，共同由舞台接管寿命。 */
export function drawStoryMap(scene: Phaser.Scene, map: WorldMap): () => void {
  const layers = drawMapLayers(scene, map, { keyPrefix: 'story-dodge' });
  return () => layers.destroy();
}

export function drawStoryCharacters(scene: Phaser.Scene, actors: readonly SceneActorState[],
  appearances: ReadonlyMap<string, ActorDefinition>): Map<string, CharacterVisual> {
  const characters = new Map<string, CharacterVisual>();
  try {
    for (const actor of actors) {
      const appearance = appearances.get(actor.id);
      if (!appearance) throw new Error('角色资源缺失：' + actor.actor);
      const visual = createCharacter(scene, appearance, { id: actor.id, actor: actor.actor,
        characterId: actor.characterId, x: actor.x, y: actor.y, flip: actor.flip });
      characters.set(actor.id, visual);
      setCharacterClip(scene, visual, actor.clip ?? `idle-${actor.facing}`);
      for (const layer of visual.layers) {
        if (actor.animationProgress !== undefined) layer.anims.setProgress(actor.animationProgress);
        if (actor.animationPlaying === false) layer.anims.stop();
      }
      visual.container.setVisible(actor.visible).setAlpha(actor.alpha ?? 1);
    }
    return characters;
  } catch (error) {
    for (const visual of characters.values()) if (visual.container.scene) visual.container.destroy();
    throw error;
  }
}
