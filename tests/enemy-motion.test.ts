import {CombatCooldownStore} from '../src/domain/combat-cooldowns.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import fs from 'node:fs';
import { movementBodyClass } from '../src/rendering/arcade-movement.ts';
import { NavigationWorld, type NavigationActor } from '../src/domain/navigation-world.ts';
import { EnemyController } from '../src/domain/enemy-ai.ts';
import { resolveBasicAttack } from '../src/domain/basic-attack.ts';
import type { BattleCatalog } from '../src/domain/battle.ts';
import type { Point } from '../src/domain/navigation.ts';

const require=createRequire(import.meta.url);
const World=require('../node_modules/phaser/src/physics/arcade/World.js') as typeof Phaser.Physics.Arcade.World;
const Body=movementBodyClass(require('../node_modules/phaser/src/physics/arcade/Body.js'));
const catalog:BattleCatalog=JSON.parse(fs.readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8'));

test('native wolf chase crosses path points without zero-motion steps at 30, 60 and 120 Hz',()=>{
  const wolf=catalog.enemies.find(e=>e.name==='狼'&&e.basicAttack)!;
  assert.ok(wolf);
  for(const hz of [30,60,120]){
    const scene={sys:{scale:{width:2000,height:500}}} as unknown as Phaser.Scene;
    const world=new World(scene,{gravity:{x:0,y:0},debug:false});
    const navigation=new NavigationWorld({name:'arena',bounds:{x:0,y:0,width:2000,height:500}});
    const object={x:80,y:160,scaleX:1,scaleY:1,angle:0,rotation:0,displayOriginX:0,displayOriginY:0,active:true,
      setPosition(this:Point,x:number,y:number){this.x=x;this.y=y;return this;}} as unknown as Phaser.GameObjects.GameObject&Point;
    const body=new Body(world,object);
    const navActor:NavigationActor={position:()=>body.footPosition(),shape:()=>wolf.actor,enabled:()=>true};
    body.initialize(navigation,navActor);body.setSize(8,8,false).setOffset(-4,-4);body.updateFromGameObject();body.shape(wolf.actor);
    object.body=body;world.add(body);navigation.register(navActor);
    const monster=()=>({id:'enemy',team:'enemy',position:body.footPosition(),bounds:wolf.actor.collision!});
    const player={id:'player',team:'party',position:{x:1500,y:160},bounds:{x:-8,y:-8,width:16,height:16}};
    const speed=wolf.behavior.moveSpeedPxPerSecond;
    const ai=new EnemyController('enemy',{...wolf.behavior,awarenessRangeUnits:1000},resolveBasicAttack(catalog,wolf),{
      cooldowns:new CombatCooldownStore(()=>0).forActor('enemy'),
      actor:id=>id==='enemy'?monster():id==='player'?player:undefined,candidates:()=>[monster(),player],facing:()=> 'east',
      home:()=>({x:80,y:160}),navigationBounds:()=>navigation.bounds,canStand:p=>navigation.canStand(navActor,p),
      followPath:next=>body.walk({next},speed),moveToward:p=>body.toward(p,speed),stop:()=>{body.halt();},
      relocate:()=>{},play:()=>()=>{},frame:()=>{},clearEffects:()=>{},
    });
    let steps=0,zeroSteps=0,previous=body.footPosition().x;
    world.on('worldstep',()=>{body.settleStep();const x=body.footPosition().x;if(ai.snapshot().state==='chasing'){
      steps++;if(Math.abs(x-previous)<.001)zeroSteps++;
    }previous=x;});
    ai.onContact({casterId:'player',targetId:'enemy'});ai.update(60);
    for(let i=1;i<=hz*2;i++){
      world.update(i*1000/hz,1000/hz);world.postUpdate();ai.update(1000/hz);
    }
    assert.ok(steps>=119,`${hz} Hz: ${steps} physics steps`);
    assert.equal(zeroSteps,0,`${hz} Hz: path handoffs must not stop walking`);
    assert.ok(body.footPosition().x-80>speed*1.8,`${hz} Hz: unexpected chase slowdown`);
    ai.dispose();world.destroy();
  }
});
