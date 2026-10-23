import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { Campaign } from '../src/domain/campaign.ts';
import { Session } from '../src/domain/session.ts';
import { StoryDirector, type StoryUI } from '../src/domain/story-director.ts';
import type { WorldMap } from '../src/domain/content.ts';
import type { SceneOptions } from '../src/scenes/world-scene.ts';

const phaser=registerHooks({resolve(specifier,context,next){
  return specifier==='phaser'?{url:'data:text/javascript,export default {BlendModes:{NORMAL:0,ADD:1,MULTIPLY:2,SCREEN:3},Scene:class{},Physics:{Arcade:{Body:class{}}}}',shortCircuit:true}:next(specifier,context);
}});
const {WorldScene}=await import('../src/scenes/world-scene.ts');
phaser.deregister();

const base:Campaign=JSON.parse(readFileSync(new URL('../public/content/campaign.json',import.meta.url),'utf8'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('GM jump waits for cancelled NPC interaction and stage release before installing another scene',async()=>{
  const campaign:Campaign={...base,events:[{id:'old-quest',source:'quest',key:'grafton-mission',script:'old-quest'}],
    scripts:{...base.scripts,'old-quest':{entry:'start',nodes:[{id:'start',presentation:[],commands:[{type:'flag',flag:'stale-trigger'}],exit:{type:'end'}}]}}};
  const session=new Session(campaign),order:string[]=[],locks:boolean[]=[];
  let finishInteraction!:()=>void,finishRelease!:()=>void;
  const ui:StoryUI={async dialogue(){},async choice(_prompt,options){return options[0];},async questPopup(){},toast(){},closeDialogue(){},skipDialogue(){}};
  const director=new StoryDirector(campaign,session,ui,value=>locks.push(value),{begin(){},async execute(){},async finish(){},
    async release(){order.push('release');await new Promise<void>(resolve=>{finishRelease=resolve;});order.push('released');}});
  const interaction=director.run(async()=>{await new Promise<void>(resolve=>{finishInteraction=resolve;});order.push('interaction ended');});
  session.accept('grafton-mission');
  const jump=director.debugJump(async()=>{order.push('install scene');});
  await tick();assert.deepEqual(order,[],'旧对话尚未退出时，GM不能安装新现场');
  finishInteraction();await tick();assert.deepEqual(order,['interaction ended','release']);
  finishRelease();await interaction;await jump;
  assert.deepEqual(order,['interaction ended','release','released','install scene']);
  assert.equal(session.flags.has('stale-trigger'),false,'取消前排队的任务触发不能进入新现场');
  assert.deepEqual(locks,[true,false],'旧手动播放收尾期间保持GM调试锁');
  assert.equal(director.busy,false);
});

test('repeated GM travel to the same map restarts a fresh visit without carrying cinematic snapshots',async()=>{
  const world=JSON.parse(readFileSync(new URL('../public/content/world.json',import.meta.url),'utf8'));
  const map:WorldMap=JSON.parse(readFileSync(new URL('../public/'+world.maps.find((entry:{id:string})=>entry.id===base.start.map).file,import.meta.url),'utf8'));
  const session=new Session(base),restarts:SceneOptions[]=[];
  const state={loadingWorld:false,destroyed:false,map,near:null,
    options:{preparedScene:{map:map.id,actors:[{id:'obsolete-actor'}]}},
    app:{session,campaign:base,world,content:{async map(){return map;}},ui:{loading(){}}},
    scene:{restart(options:SceneOptions){restarts.push(options);state.loadingWorld=false;options.onReady?.();}}};
  const scene=Object.setPrototypeOf(state,WorldScene.prototype) as unknown as InstanceType<typeof WorldScene>;
  for(let attempt=0;attempt<2;attempt++)assert.deepEqual(await scene.gmTravel(map.id,base.start),{ok:true});
  assert.equal(restarts.length,2,'同图也必须重启正式世界，清理上一次访问的演员和战斗');
  for(const options of restarts){
    assert.equal(options.map,map.id);assert.equal(options.suppressEntry,true);
    assert.equal(options.preparedScene,undefined);assert.equal(options.generatedEntities,undefined);
    assert.equal(options.checkpoint,undefined);
  }
});
