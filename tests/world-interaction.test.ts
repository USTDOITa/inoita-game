import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { Campaign } from '../src/domain/campaign.ts';
import { BattleCharacter, type CharacterStatsCatalog } from '../src/domain/character-stats.ts';
import type { ActorDefinition, EntityPlacement, Facing, WorldIndex, WorldMap } from '../src/domain/content.ts';
import type { DropCatalog } from '../src/domain/drops.ts';
import type { ItemCatalog } from '../src/domain/items.ts';
import { Session } from '../src/domain/session.ts';

class Rectangle {
  x:number;y:number;width:number;height:number;
  constructor(x:number,y:number,width:number,height:number) {this.x=x;this.y=y;this.width=width;this.height=height;}
  static Contains(area:Rectangle,x:number,y:number):boolean {return x>=area.x&&y>=area.y&&x<=area.x+area.width&&y<=area.y+area.height;}
}

// 只替换 Phaser 的绘制边界；角色创建、目标选择与交互分发都跑生产代码。
class Display extends EventEmitter {
  x:number;y:number;visible=true;active=true;alpha=1;width=0;height=0;
  list:Display[]=[];
  anims={timeScale:1,accumulator:0};
  input?:{enabled:boolean};
  constructor(x=0,y=0) {super();this.x=x;this.y=y;}
  setDepth() {return this;} setOrigin() {return this;} setBlendMode() {return this;} setScale() {return this;}
  setAlpha(value:number) {this.alpha=value;return this;} setVisible(value:boolean) {this.visible=value;return this;}
  setText() {return this;} setColor() {return this;}
  addAt(value:Display,index:number) {this.list.splice(index,0,value);return this;}
  add() {return this;}
  setInteractive() {this.input={enabled:true};return this;}
  disableInteractive() {if(this.input)this.input.enabled=false;return this;}
  play() {return this;} destroy() {this.active=false;this.removeAllListeners();}
}
const boundary=Symbol.for('inotia.world-interaction-test.phaser');
Object.defineProperty(globalThis,boundary,{value:{Rectangle},configurable:true});
const phaser=registerHooks({resolve(specifier,context,next) {
  return specifier==='phaser'?{shortCircuit:true,url:`data:text/javascript,${encodeURIComponent(`
    const {Rectangle}=globalThis[Symbol.for('inotia.world-interaction-test.phaser')];
    export default {Geom:{Rectangle},BlendModes:{NORMAL:0,ADD:1,SCREEN:2,MULTIPLY:3},Scene:class{},Physics:{Arcade:{Body:class{}}}};
  `)}`}:next(specifier,context);
}});
const {WorldScene}=await import('../src/scenes/world-scene.ts');
phaser.deregister();

const read=<T>(file:string):T=>JSON.parse(readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8')) as T;
const world=read<WorldIndex>('content/world.json'),campaign=read<Campaign>('content/campaign.json');
const items=read<ItemCatalog>('content/items.json'),stats=read<CharacterStatsCatalog>('content/character-stats.json');
const drops=read<DropCatalog>('content/drops.json');

interface Character {entity:EntityPlacement;actor:ActorDefinition;container:Display;marker:null}
interface SceneHooks {
  createActor(entity:EntityPlacement):Character;
  attackKey():void;
}

function session():Session {
  return new Session(campaign,undefined,undefined,items,new BattleCharacter('dark-knight',stats,items));
}

function mapOf(id:string):WorldMap {
  return read<WorldMap>(world.maps.find(reference=>reference.id===id)!.file);
}

function machine(map:WorldMap):EntityPlacement {
  return map.entities.find(entity=>world.actors[entity.actor]?.service==='fusion-machine')!;
}

/** 站在融合器正下方，面朝它按一次攻击键。 */
function pressAttack(mapId:string,current=new Session(campaign,undefined,undefined,items,new BattleCharacter('dark-knight',stats,items))) {
  const map=mapOf(mapId),entity=machine(map),calls:string[]=[],animations=new Set<string>();
  current.chests.enterMap(map.id);
  const combat={controlledVisual:undefined as {container:Display}|undefined,controlledMember:{level:100},
    facing:'north' as Facing,cannotAct:false,playerCannotAct:()=>false,hasHostileTarget:()=>false,
    attack:()=>calls.push('attack'),setPerformanceActive(){},syncChestEnemies(){}};
  const state={
    app:{world,items,session:current,campaign,locked:false,suspended:false,
      ui:{ready:true,controlLayoutEditing:false},audio:{ui:(sound:string)=>calls.push(sound)},shops:{shops:{}},
      director:{interact:(_entity:EntityPlacement,actor:ActorDefinition)=>{calls.push(`interact:${actor.id}`);return Promise.resolve(true);}},
      openCrafting:(actorId:string)=>calls.push(`openCrafting:${actorId}`)},
    map,dropCatalog:drops,player:{container:new Display()},characters:[] as Character[],near:null as Character|null,combat,
    autoAttack:{engage(){}},performing:false,loadingWorld:false,active:true,chestFades:new Map(),
    sys:{isActive:()=>true},
    add:{container:(x:number,y:number)=>new Display(x,y),sprite:()=>new Display(),text:()=>new Display()},
    anims:{exists:(key:string)=>animations.has(key),create:({key}:{key:string})=>animations.add(key),generateFrameNumbers:()=>[]},
    movement:{register(){},setEnabled(){}},
    tweens:{add:()=>({paused:false,pause(){},resume(){}})},
    refreshCombatTarget(){},refreshLoadout(){}
  };
  const scene=Object.setPrototypeOf(state,WorldScene.prototype) as unknown as SceneHooks;
  state.characters.push(scene.createActor({...entity}));
  state.player.container.x=entity.x;state.player.container.y=entity.y+16;
  scene.attackKey();
  return {calls,entity};
}

test('an available fusion quest takes the interaction before the crafting panel',()=>{
  const {calls,entity}=pressAttack('shadow-hall');
  assert.deepEqual(calls,[`interact:${entity.actor}`]);
});

test('a ready fusion quest is handed in instead of opening the crafting panel',()=>{
  const current=session();
  assert.equal(current.accept('quest-353'),true);
  for(let count=0;count<5;count++)current.bag.add('paillette',1);
  current.refresh();
  assert.equal(current.status('quest-353'),'ready');
  const {calls}=pressAttack('shadow-hall',current);
  assert.deepEqual(calls,['interact:fusion-machine-3d13b5ee']);
});

test('an active fusion quest does not block the crafting panel',()=>{
  const current=session();
  assert.equal(current.accept('quest-353'),true);
  assert.equal(current.status('quest-353'),'active');
  const {calls}=pressAttack('shadow-hall',current);
  assert.deepEqual(calls,['openCrafting:fusion-machine-3d13b5ee']);
});

test('a fusion machine without any offer opens the crafting panel',()=>{
  const {calls,entity}=pressAttack('hall-of-afterlife-0780bd4c');
  assert.deepEqual(calls,[`openCrafting:${entity.actor}`]);
});
