import type Phaser from 'phaser';
import type { StoryPlayerState } from '../domain/story-interface.ts';
import { gaugeFillWidth, type StatusHudSkin } from '../domain/status-hud.ts';
import type { CharacterVisual } from './characters.ts';

/** 世界空间中的人物双条，随人物容器移动和镜头缩放。 */
export class OverheadStatus {
  readonly container:Phaser.GameObjects.Container;
  private readonly health:Phaser.GameObjects.Rectangle;
  private readonly mana:Phaser.GameObjects.Rectangle;
  private readonly character:CharacterVisual;
  private readonly skin:StatusHudSkin['overhead'];
  private readonly read:()=>StoryPlayerState|undefined;
  private hasPlayer=false;

  constructor(scene:Phaser.Scene,character:CharacterVisual,skin:StatusHudSkin,
    read:()=>StoryPlayerState|undefined,subscribe:(listener:()=>void)=>()=>void) {
    this.character=character;this.skin=skin.overhead;this.read=read;
    const image=(part:'frame'|'leader')=>{
      const rect=this.skin[part];
      return scene.add.image(rect.x,rect.y,skin.assets[`overhead-${part}`]).setOrigin(0);
    };
    const gauge=(kind:'health'|'mana')=>{
      const rect=this.skin[kind];
      return scene.add.rectangle(rect.x,rect.y,rect.width,rect.height,parseInt(rect.color.slice(1),16)).setOrigin(0);
    };
    this.health=gauge('health');this.mana=gauge('mana');
    this.container=scene.add.container(0,0,[image('leader'),image('frame'),this.health,this.mana]).setName('overhead-status');
    character.container.add(this.container);
    this.refresh();
    const unsubscribe=subscribe(()=>this.refresh());
    this.container.once('destroy',unsubscribe);
  }
  private refresh():void {
    const player=this.read();
    this.hasPlayer=!!player;
    for(const kind of ['health','mana'] as const){
      const rect=this.skin[kind],max=player?.[kind==='health'?'maxHealth':'maxMana']??0;
      const width=gaugeFillWidth(player?.[kind]??0,max,rect.width);
      this[kind].setSize(width,rect.height).setVisible(width>0);
    }
  }
  setVisible(visible:boolean):void {
    const anchor=this.character.actor.headAnchor;
    this.container.setVisible(visible&&!!anchor&&this.hasPlayer);
    if(anchor)this.container.setPosition(anchor.x,anchor.y);
  }
  destroy():void { this.container.destroy(); }
}
