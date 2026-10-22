import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire,registerHooks} from 'node:module';
import test from 'node:test';
import type Phaser from 'phaser';
import {NavigationWorld} from '../src/domain/navigation-world.ts';
import type {CharacterVisual} from '../src/rendering/characters.ts';

const require=createRequire(import.meta.url);
const World=require('../node_modules/phaser/src/physics/arcade/World.js') as typeof Phaser.Physics.Arcade.World;
const bodyUrl=new URL('../node_modules/phaser/src/physics/arcade/Body.js',import.meta.url).href;
const shim=`import Body from ${JSON.stringify(bodyUrl)};export default {Physics:{Arcade:{Body}},Scenes:{Events:{PRE_UPDATE:'preupdate',POST_UPDATE:'postupdate',PRE_RENDER:'prerender',RENDER:'render'}}};`;
const hook=registerHooks({resolve(specifier,context,next){return specifier==='phaser'
  ?{url:`data:text/javascript,${encodeURIComponent(shim)}`,shortCircuit:true}:next(specifier,context);}});
const {MovementWorld}=await import('../src/rendering/movement-world.ts');hook.deregister();
type CollisionObject=Parameters<NonNullable<Phaser.Physics.Arcade.Collider['processCallback']>>[0];

test('the installed collision filter follows registered bodies, current visibility and shape, and removal',t=>{
  const members=new Set<unknown>(),events=new EventEmitter();
  const group={scene:{},add:(value:unknown)=>members.add(value),remove:(value:unknown)=>members.delete(value),destroy:()=>members.clear()};
  const scene={sys:{scale:{width:640,height:480}},events,add:{group:()=>group}} as unknown as Phaser.Scene;
  const world=new World(scene,{gravity:{x:0,y:0},debug:false});
  let collider:Phaser.Physics.Arcade.Collider;
  scene.physics={world,add:{collider:(...args:Parameters<typeof world.addCollider>)=>{collider=world.addCollider(...args);return collider;}}} as Phaser.Physics.Arcade.ArcadePhysics;
  const movement=new MovementWorld(scene,new NavigationWorld({name:'arena',bounds:{x:0,y:0,width:200,height:200}}));
  t.after(()=>{movement.destroy();world.destroy();});
  const visual=(id:string,x:number)=>({actor:{collision:{x:-4,y:-4,width:8,height:8}},entity:{id},container:Object.assign(new EventEmitter(),{
    x,y:40,scaleX:1,scaleY:1,angle:0,rotation:0,displayOriginX:0,displayOriginY:0,active:true,visible:true,
    setPosition(x:number,y:number){this.x=x;this.y=y;return this;},setDepth(){return this;},setVisible(value:boolean){this.visible=value;return this;}
  })}) as unknown as CharacterVisual;
  const first=visual('first',40),second=visual('second',48);
  const a=movement.register(first),b=movement.register(second);
  const permits=(x:unknown,y:unknown)=>collider!.processCallback!(x as CollisionObject,y as CollisionObject);
  assert.equal(permits(first.container,second.container),true);assert.equal(permits(a,b),true);
  first.container.visible=false;assert.equal(permits(a,b),false);first.container.visible=true;
  movement.setEnabled(second,false);assert.equal(permits(a,b),false);movement.setEnabled(second,true);
  second.actor.collision=undefined;assert.equal(permits(a,b),false);
  second.actor.collision={x:-4,y:-4,width:8,height:8};assert.equal(permits(a,b),true);
  assert.equal(permits({body:{}},b),false);assert.equal(permits({body:null},b),false);
  movement.remove(first);a.enable=true;assert.equal(permits(a,b),false,'removed bodies cannot regain collision membership');
  const replacement=movement.register(first);assert.notEqual(replacement,a);assert.equal(permits(first.container,second.container),true);
  first.container.emit('destroy');replacement.enable=true;assert.equal(permits(replacement,b),false);
  assert.equal(members.has(first.container),false);assert.equal(members.has(second.container),true);
  // 同队单位互不碰撞；队伍与中立单位仍按实体范围碰撞。
  const ally=visual('ally',56);const allyBody=movement.register(ally,true,true,'party');
  movement.register(second,true,true,'party');
  assert.equal(permits(allyBody,b),false,'同队单位之间不参与碰撞');
  movement.register(second,true,true);
  assert.equal(permits(allyBody,b),true,'队伍单位与中立单位仍碰撞');
});

test('a separation that pushes the foot into terrain returns to the step start; when the start is illegal too it recovers to the nearest body-free spot',t=>{
  const events=new EventEmitter();
  const group={scene:{},add(){},remove(){},destroy(){}};
  const scene={sys:{scale:{width:640,height:480}},events,add:{group:()=>group}} as unknown as Phaser.Scene;
  const world=new World(scene,{gravity:{x:0,y:0},debug:false});
  scene.physics={world,add:{collider:(...args:Parameters<typeof world.addCollider>)=>world.addCollider(...args)}} as Phaser.Physics.Arcade.ArcadePhysics;
  // 12×12 格，第 5 行整行是墙；其余可站。脚点 (40,40) 在 row 2，墙带覆盖 y 80..96。
  const blocked=new Array(144).fill(false);for(let col=0;col<12;col++)blocked[5*12+col]=true;
  const navigation=new NavigationWorld({name:'arena',tileSize:16,columns:12,rows:12,blocked});
  const movement=new MovementWorld(scene,navigation);
  t.after(()=>{movement.destroy();world.destroy();});
  const collision={x:-8,y:-8,width:16,height:16};
  const visual={actor:{collision},entity:{id:'hero'},container:Object.assign(new EventEmitter(),{
    x:40,y:40,scaleX:1,scaleY:1,angle:0,rotation:0,displayOriginX:0,displayOriginY:0,active:true,visible:true,
    setPosition(x:number,y:number){this.x=x;this.y=y;return this;},setDepth(){return this;},setVisible(value:boolean){this.visible=value;return this;}
  })} as unknown as CharacterVisual;
  const body=movement.register(visual,true);
  const settle=()=>(movement as unknown as {settleStep(delta:number):void}).settleStep(16);
  body.update(.016); // 正常一步：本帧起点 (40,40)
  // 模拟碰撞分离把身体推进墙带：body 左上角 = 脚点 + collision 偏移。
  body.position.set(40+collision.x,88+collision.y);body.updateCenter();
  settle();
  assert.deepEqual(movement.position(visual),{x:40,y:40},'分离造成的位移应退回本帧起点');
  // 起点本身也不合法：只能按整个碰撞盒就近自愈，不能停在墙里。
  (body as unknown as {stepStart:{x:number;y:number}}).stepStart={x:40,y:88};
  body.position.set(40+collision.x,88+collision.y);body.updateCenter();
  settle();
  const foot=movement.position(visual);
  assert.ok(navigation.terrainFree(foot),`自愈后的脚点仍不可站：${JSON.stringify(foot)}`);
  assert.ok(navigation.bodyTerrainFree({collision},foot),`自愈后的整盒仍压墙：${JSON.stringify(foot)}`);
});

test('content actors placed on blocked terrain are never relocated by physics',t=>{
  const events=new EventEmitter();
  const group={scene:{},add(){},remove(){},destroy(){}};
  const scene={sys:{scale:{width:640,height:480}},events,add:{group:()=>group}} as unknown as Phaser.Scene;
  const world=new World(scene,{gravity:{x:0,y:0},debug:false});
  scene.physics={world,add:{collider:(...args:Parameters<typeof world.addCollider>)=>world.addCollider(...args)}} as Phaser.Physics.Arcade.ArcadePhysics;
  const blocked=new Array(144).fill(false);for(let col=0;col<12;col++)blocked[5*12+col]=true;
  const navigation=new NavigationWorld({name:'arena',tileSize:16,columns:12,rows:12,blocked});
  const movement=new MovementWorld(scene,navigation);
  t.after(()=>{movement.destroy();world.destroy();});
  const visual={actor:{collision:{x:-8,y:-8,width:16,height:16}},entity:{id:'torch'},container:Object.assign(new EventEmitter(),{
    x:40,y:88,scaleX:1,scaleY:1,angle:0,rotation:0,displayOriginX:0,displayOriginY:0,active:true,visible:true,
    setPosition(x:number,y:number){this.x=x;this.y=y;return this;},setDepth(){return this;},setVisible(value:boolean){this.visible=value;return this;}
  })} as unknown as CharacterVisual;
  const body=movement.register(visual,false);
  body.update(.016);
  (movement as unknown as {settleStep(delta:number):void}).settleStep(16);
  assert.deepEqual(movement.position(visual),{x:40,y:88},'内容坐标必须原样保留');
  assert.equal(movement.state(visual)!.wallRecoveries,0,'原地写回不算一次回退');
  // projectStoryWorld 会拿内容坐标重建整组落位；这条必须继续被跳过而不是校验失败。
  assert.equal(navigation.canSettleAll([{actor:movement.actor(visual),position:{x:40,y:88},enabled:true}]),true);
});

test('a movable actor without terrain recovery is not relocated when its start is illegal',t=>{
  const events=new EventEmitter();
  const group={scene:{},add(){},remove(){},destroy(){}};
  const scene={sys:{scale:{width:640,height:480}},events,add:{group:()=>group}} as unknown as Phaser.Scene;
  const world=new World(scene,{gravity:{x:0,y:0},debug:false});
  scene.physics={world,add:{collider:(...args:Parameters<typeof world.addCollider>)=>world.addCollider(...args)}} as Phaser.Physics.Arcade.ArcadePhysics;
  const blocked=new Array(144).fill(false);for(let col=0;col<12;col++)blocked[5*12+col]=true;
  const navigation=new NavigationWorld({name:'arena',tileSize:16,columns:12,rows:12,blocked});
  const movement=new MovementWorld(scene,navigation);
  t.after(()=>{movement.destroy();world.destroy();});
  const visual={actor:{collision:{x:-8,y:-8,width:16,height:16}},entity:{id:'guard'},container:Object.assign(new EventEmitter(),{
    x:40,y:88,scaleX:1,scaleY:1,angle:0,rotation:0,displayOriginX:0,displayOriginY:0,active:true,visible:true,
    setPosition(x:number,y:number){this.x=x;this.y=y;return this;},setDepth(){return this;},setVisible(value:boolean){this.visible=value;return this;}
  })} as unknown as CharacterVisual;
  const body=movement.register(visual,true,false);
  body.update(.016);
  (movement as unknown as {settleStep(delta:number):void}).settleStep(16);
  assert.deepEqual(movement.position(visual),{x:40,y:88},'敌人/非恢复角色不搬迁内容异常点');
  assert.equal(movement.state(visual)!.terrainRecovery,false);
});

test('placeAll repairs a strict actor out of a blocked cell instead of aborting the performance',t=>{
  const events=new EventEmitter(),group={scene:{},add(){},remove(){},destroy(){}};
  const scene={sys:{scale:{width:640,height:480}},events,add:{group:()=>group}} as unknown as Phaser.Scene;
  const world=new World(scene,{gravity:{x:0,y:0},debug:false});
  scene.physics={world,add:{collider:(...args:Parameters<typeof world.addCollider>)=>world.addCollider(...args)}} as Phaser.Physics.Arcade.ArcadePhysics;
  const blocked=new Array(144).fill(false);for(let col=0;col<12;col++)blocked[5*12+col]=true;
  const navigation=new NavigationWorld({name:'arena',tileSize:16,columns:12,rows:12,blocked});
  const movement=new MovementWorld(scene,navigation);
  t.after(()=>{movement.destroy();world.destroy();});
  const collision={x:-8,y:-8,width:16,height:16};
  const visual={actor:{collision},entity:{id:'hero'},container:Object.assign(new EventEmitter(),{
    x:40,y:40,scaleX:1,scaleY:1,angle:0,rotation:0,displayOriginX:0,displayOriginY:0,active:true,visible:true,
    setPosition(x:number,y:number){this.x=x;this.y=y;return this;},setDepth(){return this;},setVisible(value:boolean){this.visible=value;return this;}
  })} as unknown as CharacterVisual;
  movement.register(visual,true,true);
  assert.doesNotThrow(()=>movement.placeAll([{visual,position:{x:40,y:88},enabled:true}]));
  const foot=movement.position(visual);
  assert.ok(navigation.terrainFree(foot),`修正后的脚点仍不可站：${JSON.stringify(foot)}`);
  assert.ok(navigation.bodyTerrainFree({collision},foot),`修正后的整盒仍压墙：${JSON.stringify(foot)}`);
});

test('placeAll keeps the performance alive when the map has no legal body spot',t=>{
  const events=new EventEmitter(),group={scene:{},add(){},remove(){},destroy(){}};
  const scene={sys:{scale:{width:640,height:480}},events,add:{group:()=>group}} as unknown as Phaser.Scene;
  const world=new World(scene,{gravity:{x:0,y:0},debug:false});
  scene.physics={world,add:{collider:(...args:Parameters<typeof world.addCollider>)=>world.addCollider(...args)}} as Phaser.Physics.Arcade.ArcadePhysics;
  const blocked=new Array(144).fill(true);
  const navigation=new NavigationWorld({name:'sealed',tileSize:16,columns:12,rows:12,blocked});
  const movement=new MovementWorld(scene,navigation);
  t.after(()=>{movement.destroy();world.destroy();});
  const collision={x:-8,y:-8,width:16,height:16};
  const visual={actor:{collision},entity:{id:'hero'},container:Object.assign(new EventEmitter(),{
    x:40,y:40,scaleX:1,scaleY:1,angle:0,rotation:0,displayOriginX:0,displayOriginY:0,active:true,visible:true,
    setPosition(x:number,y:number){this.x=x;this.y=y;return this;},setDepth(){return this;},setVisible(value:boolean){this.visible=value;return this;}
  })} as unknown as CharacterVisual;
  movement.register(visual,true,true);
  assert.doesNotThrow(()=>movement.placeAll([{visual,position:{x:40,y:88},enabled:true}]),
    '没有合法落点时保持原位并记录，不中断剧情');
  assert.deepEqual(movement.position(visual),{x:40,y:88});
});
