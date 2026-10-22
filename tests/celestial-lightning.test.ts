import {CombatRuntime} from '../src/domain/combat-runtime.ts';
import {CombatActionDispatcher} from '../src/domain/combat-action-dispatcher.ts';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import test from 'node:test';
import type Phaser from 'phaser';
import type {BattleCatalog} from '../src/domain/battle.ts';
import type {CharacterVisual} from '../src/rendering/characters.ts';

const hook=registerHooks({resolve(specifier,context,next){return specifier==='phaser'
  ?{url:'data:text/javascript,export default {BlendModes:{NORMAL:0,MULTIPLY:1,SCREEN:2,ADD:3}}',shortCircuit:true}
  :next(specifier,context);}});
const {CombatPresenter}=await import('../src/rendering/combat-presenter.ts');hook.deregister();
const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const action=(growth:'action'|'companion')=>(growth==='action'?catalog.skills['celestial-lightning'].action:catalog.skills['celestial-lightning'].companion!.action)!;
const strikes=(growth:'action'|'companion')=>action(growth).transition!.casterStrikes!;

test('主动施放以自身为过渡落点，带十二道逐帧雷击与整数格距范围',()=>{
  for(const growth of ['action','companion'] as const){
    const current=action(growth);
    assert.equal(current.requiresTarget,false,'动作行 +2=1 是自身搜索，不需要先选敌人');
    assert.deepEqual(current.combatUnits!.map(unit=>unit.effect),['set-attribute','magic','clear-attribute']);
    assert.equal(current.events.length,1);
    const event=current.events[0];
    if(event.kind!=='units')throw new Error('units missing');
    assert.equal(event.frame,7);
    assert.deepEqual(event.cues.map(cue=>cue.target),['self','area','self']);
    assert.equal(event.cues[1].targetRangeMetric,'octagonal-grid');
    assert.equal(event.cues[1].targetRangePx,88);
    assert.equal(current.transition!.anchor,'caster');
    assert.equal(current.transition!.switchFrame,8);
    assert.equal(strikes(growth).effect,'monster-thunder');
    assert.deepEqual(strikes(growth).offsets,[{x:2,y:-100},{x:47,y:-51},{x:95,y:-85},{x:100,y:2},{x:51,y:47},{x:85,y:95},
      {x:-2,y:100},{x:-47,y:51},{x:-95,y:85},{x:-100,y:-2},{x:-51,y:-47},{x:-85,y:-95}]);
  }
});

test('主角与佣兵八级魔法倍率取各自训练分支',()=>{
  const rates={action:[2000,2160,2320,2480,2560,2640,2720,2800],companion:[1920,2080,2240,2400,2480,2560,2640,2720]};
  for(const growth of ['action','companion'] as const){
    const unit=action(growth).combatUnits![1];
    if(unit.effect!=='magic')throw new Error('damage unit changed');
    assert.deepEqual(unit.attributeWeights,{strength:0,dexterity:0,vitality:0,intelligence:10,mentality:12});
    rates[growth].forEach((rate,index)=>{
      const operation=unit.ranks[index].operation;
      assert.equal(operation.kind,'multiply-thousandth');
      if(operation.kind!=='multiply-thousandth')throw new Error('operation changed');
      assert.equal(operation.ratePerThousand,rate,`rank ${index+1}`);
    });
  }
});

/** 场景替身只记录生成位置与定时器；雷击用施法者的实时位置。 */
function fixture(){
  const spawned:{x:number;y:number}[]=[],timers:{delay:number;callback:()=>void;removed:boolean;remove:()=>void}[]=[];
  const character={actor:catalog.classes.find(entry=>entry.id==='priest')!.actor,entity:{id:'player',actor:'priest'},
    layers:[],clipName:null,container:{active:true,x:0,y:0,addAt:()=>{}}} as unknown as CharacterVisual;
  class Sprite extends EventEmitter {
    anims={accumulator:0,currentFrame:undefined as unknown};
    setOrigin(){return this;}setScale(){return this;}setBlendMode(){return this;}setTexture(){return this;}setVisible(){return this;}play(){return this;}
  }
  const effect={x:0,y:0,active:true,list:[] as Sprite[],
    setName(){return this;},setDepth(){return this;},destroy(){this.active=false;},
    on(){return this;},once(){return this;},add(sprite:Sprite){this.list.push(sprite);return this;},removeAll(){this.list=[];return this;},
    get length(){return this.list.length;}};
  const scene={events:new EventEmitter(),
    add:{container:(x:number,y:number)=>{spawned.push({x,y});return effect;},
      sprite:()=>new Sprite(),layer:()=>({setDepth(){return this;},add(){},destroy(){}})},
    anims:{exists:()=>false,create:()=>{},generateFrameNumbers:()=>[]},
    tweens:{add:()=>{},killTweensOf:()=>{}},
    time:{delayedCall:(delay:number,callback:()=>void)=>{
      const timer={delay,callback,removed:false,remove(){this.removed=true;}};timers.push(timer);return timer;
    }}} as unknown as Phaser.Scene;
  const presenter=new CombatPresenter(scene,catalog,id=>id==='player'?character:undefined,()=>[]);
  let frame=0;const runtime=new CombatRuntime(()=>frame);
  const dispatcher=new CombatActionDispatcher({runtime,catalog,actor:id=>id==='player'?{id,team:'party',position:character.container,bounds:character.actor.collision!}:undefined,
    candidates:()=>[],random:()=>0,viewport:()=>({width:640,height:360}),pose:()=>{},effect:(name,variant,position)=>presenter.renderEffect(name,variant,position),
    flight:()=>{},screen:()=>{},notify:()=>{},canSummonAt:()=>true,nearestSummonSpot:(position,_bounds,preferred)=>preferred??position,beginSummons:()=>{},summon:()=>undefined});
  return {presenter,spawned,timers,character,runtime,dispatcher,step:()=>runtime.step(++frame),move:(x:number,y:number)=>{character.container.x=x;character.container.y=y;}};
}

test('十二道雷击各生成一次，位置取施法者当时的实时位置',()=>{
  const run=fixture();
  run.dispatcher.casterStrikes('player',strikes('action'));
  assert.deepEqual(run.spawned,[{x:2,y:-100}],'第一道立即出现在施法者位置加偏移');
  assert.equal(run.runtime.pendingCount,11);
  run.move(40,-20);run.step();
  assert.deepEqual(run.spawned[1],{x:87,y:-71},'移动后按新位置加同一偏移');
  for(let index=1;index<11;index++)run.step();
  assert.equal(run.spawned.length,12);
});
