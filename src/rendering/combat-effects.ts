import type Phaser from 'phaser';
import type {AttackPlacement} from '../domain/battle.ts';
import type {CharacterVisual} from './characters.ts';
import {retainLoadedSceneAssets} from './scene-assets.ts';

/** 地面特效高于场地（0），低于人物（y + 0.5）。 */
const GROUND_DEPTH=0.4;

/** 已生成的战斗特效按自身动画回收，角色附着效果同时随所属角色销毁。 */
export class CombatEffects {
  private readonly scene:Phaser.Scene;
  private readonly effects=new Set<Phaser.GameObjects.Container>();
  private ground?:Phaser.GameObjects.Layer;
  private aboveCharacters?:Phaser.GameObjects.Layer;
  constructor(scene:Phaser.Scene){this.scene=scene;}
  private retain(effect:Phaser.GameObjects.Container,textureKeys:Iterable<string>):void {
    const assets=retainLoadedSceneAssets(this.scene,textureKeys);
    this.effects.add(effect);
    effect.once('destroy',()=>{this.effects.delete(effect);assets.release();});
  }
  addWorld(effect:Phaser.GameObjects.Container,placement:Exclude<AttackPlacement,'attached'>,textureKeys:Iterable<string>):void {
    this.retain(effect,textureKeys);
    if(placement==='ground'){
      this.ground??=this.scene.add.layer().setDepth(GROUND_DEPTH);
      this.ground.add(effect);
    }else if(placement==='above-characters'){
      this.aboveCharacters??=this.scene.add.layer().setDepth(Number.MAX_SAFE_INTEGER);
      this.aboveCharacters.add(effect);
    }
  }
  addToCharacter(effect:Phaser.GameObjects.Container,character:CharacterVisual,textureKeys:Iterable<string>):void {
    character.container.addAt(effect,character.layers.length);
    this.retain(effect,textureKeys);
  }
  setPaused(paused:boolean):void {
    for(const effect of this.effects)for(const layer of effect.list as Phaser.GameObjects.Sprite[])
      if(paused)layer.anims.pause();else layer.anims.resume();
  }
  clear():void {
    for(const effect of [...this.effects])effect.destroy();
    this.effects.clear();
    this.ground?.destroy();this.ground=undefined;
    this.aboveCharacters?.destroy();this.aboveCharacters=undefined;
  }
}
