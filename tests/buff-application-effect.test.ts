import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import test from 'node:test';
import type Phaser from 'phaser';
import type {BattleCatalog} from '../src/domain/battle.ts';
import type {CharacterVisual} from '../src/rendering/characters.ts';
import {parseBattle} from '../src/application/content-validation.ts';

const phaser=registerHooks({resolve(specifier,context,next){
  return specifier==='phaser'?{url:'data:text/javascript,export default {BlendModes:{NORMAL:0,MULTIPLY:1,SCREEN:2,ADD:3}}',shortCircuit:true}:next(specifier,context);
}});
const {CombatPresenter}=await import('../src/rendering/combat-presenter.ts');
const {WorldCombat}=await import('../src/scenes/world-combat.ts');phaser.deregister();
const {CombatConditions}=await import('../src/domain/combat-conditions.ts');
const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;

class Sprite extends EventEmitter {
  anims={accumulator:0};scaleX=1;
  setOrigin(){return this;}setScale(x:number){this.scaleX=x;return this;}
  setBlendMode(){return this;}setTexture(){return this;}setVisible(){return this;}play(){return this;}
}
class Effect extends EventEmitter {
  list:Sprite[]=[];active=true;name='';depth=0;
  readonly x:number;readonly y:number;
  constructor(x:number,y:number){super();this.x=x;this.y=y;}
  get length(){return this.list.length;}
  setDepth(depth:number){this.depth=depth;return this;}setName(name:string){this.name=name;return this;}
  add(sprite:Sprite){this.list.push(sprite);return this;}
  removeAll(){this.list=[];return this;}
  destroy(){this.active=false;this.emit('destroy');}
}

test('accepted buff applications attach independent overlapping animations that survive action cancellation',()=>{
  const nodes:{node:Effect,index:number}[]=[];
  const actor=catalog.classes[0].actor;
  const target={actor,entity:{flip:true},layers:[{},{}],container:{active:true,
    addAt:(node:Effect,index:number)=>nodes.push({node,index})}} as unknown as CharacterVisual;
  const scene={add:{container:(x:number,y:number)=>new Effect(x,y),sprite:()=>new Sprite()},
    anims:{exists:()=>false,create:()=>{},generateFrameNumbers:()=>[]}} as unknown as Phaser.Scene;
  const presenter=new CombatPresenter(scene,catalog,id=>id==='target'?target:undefined,()=>[]);
  presenter.showBuffApplication('target','life-drain');presenter.showBuffApplication('target','life-drain');
  assert.equal(nodes.length,2);assert.equal(presenter.effects.size,0);
  for(const {node,index} of nodes){
    assert.deepEqual({x:node.x,y:node.y},{x:0,y:0});assert.equal(index,2);
    assert.equal(node.list[0].scaleX,1);
  }
  presenter.clear();assert.ok(nodes.every(({node})=>node.active));
  nodes[0].node.list[0].emit('animationcomplete');
  assert.equal(nodes[0].node.active,false);assert.equal(nodes[1].node.active,true);
});

test('zero-health buff application remains at the recipient world position above characters',()=>{
  let effect:Effect|undefined;
  const target={actor:catalog.classes[0].actor,container:{active:true,x:20,y:40,
    addAt:()=>assert.fail('zero-health effect must be independent of the actor')}} as unknown as CharacterVisual;
  const scene={add:{container:(x:number,y:number)=>effect=new Effect(x,y),sprite:()=>new Sprite()},
    anims:{exists:()=>false,create:()=>{},generateFrameNumbers:()=>[]}} as unknown as Phaser.Scene;
  const presenter=new CombatPresenter(scene,catalog,()=>target,()=>[]);
  presenter.showBuffApplication('target','molten-armor-aura',false);
  assert.ok(effect);assert.deepEqual({x:effect.x,y:effect.y},{x:20,y:40});
  assert.equal(effect.depth,Number.MAX_SAFE_INTEGER);
  target.container.x=100;presenter.clear();assert.equal(effect.x,20);assert.equal(effect.active,true);
});

test('buff application assets must be present for every active skill rank',()=>{
  const data=structuredClone(catalog);
  const unit=data.skills['molten-armor'].action!.combatUnits!.find(unit=>unit.effect==='buff')!;
  assert.equal(unit.effect,'buff');if(unit.effect!=='buff')return;
  unit.ranks[0].effect.applicationEffect='missing-buff-application';
  assert.throws(()=>parseBattle(data),/missing-buff-application/);
  unit.ranks[0].effect.applicationEffect='life-drain';
  assert.doesNotThrow(()=>parseBattle(data));
});

test('buff units play application effects for new and accepted refreshes, but not rejected weaker ranks',t=>{
  t.mock.method(Math,'random',()=>0);
  const conditions=new CombatConditions(),played:string[]=[];
  const host=Object.setPrototypeOf({conditions,arena:[],pendingDefeats:new Set(),hero:{level:1},
    memberOf:()=>({player:{health:100}}),partyFighter:()=>({}),syncCombatResourceLimits:()=>{},applyStateConsequences:()=>{},
    presenterFor:()=>({showBuffApplication:(id:string,effect:string)=>played.push(`${id}:${effect}`)})},WorldCombat.prototype);
  const skill=catalog.skills['molten-armor'];
  const cast=(level:number)=>Reflect.get(WorldCombat.prototype,'skillUnit').call(host,{
    casterId:'caster',targetId:'recipient',cueIndex:0,skill:{...skill,level}});
  cast(5);cast(4);cast(5);cast(8);
  assert.deepEqual(played,Array(3).fill('recipient:molten-armor-aura'));
  assert.equal(conditions.snapshot('recipient')[0].sourceId,'caster');
  assert.equal(conditions.snapshot('recipient')[0].stackCount,1);
});

test('the buff host uses fixed placement at zero HP and while defeat is confirmed',()=>{
  let health=20;const pendingDefeats=new Set<string>(),follows:boolean[]=[];
  const host=Object.setPrototypeOf({arena:[],pendingDefeats,memberOf:()=>({player:{health}}),
    presenterFor:()=>({showBuffApplication:(_id:string,_effect:string,follow:boolean)=>follows.push(follow)})},WorldCombat.prototype);
  const play=()=>Reflect.get(WorldCombat.prototype,'showBuffApplication').call(host,'caster','target','molten-armor-aura');
  play();health=0;play();health=20;pendingDefeats.add('target');play();
  assert.deepEqual(follows,[true,false,false]);
});
