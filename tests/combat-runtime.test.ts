import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatRuntime,type FlightEvent} from '../src/domain/combat-runtime.ts';
import type {ActionPlayback,Combatant} from '../src/domain/combat.ts';
import {LOGIC_FRAME_MS} from '../src/domain/battle.ts';

function fixture(){
  let frame=0;const runtime=new CombatRuntime(()=>frame);
  return {runtime,step:(count=1)=>{for(let i=0;i<count;i++)runtime.step(++frame);},frame:()=>frame};
}
const caster:Combatant={id:'caster',team:'party',position:{x:0,y:0},bounds:{x:-4,y:-4,width:8,height:8}};
const action=():ActionPlayback=>({caster,facing:'east',basicAttack:null,skill:{id:'test',action:{requiresTarget:false,
  events:[],cooldownFrames:0,approachDistanceUnits:0,searchRadiusPx:100,transition:null}}});

test('actions and due tasks share logical time and are independent of visual completion',()=>{
  const f=fixture(),events:string[]=[];
  f.runtime.play(action(),{sourceFrames:4,frameDurationMs:60},index=>events.push(`frame:${index}`),()=>events.push('complete'));
  f.runtime.schedule('caster',2,()=>events.push('arrival'));
  f.step(4);
  assert.deepEqual(events,['frame:1','frame:2','arrival','frame:3','complete']);
  assert.equal(f.runtime.idle,true);
});

test('overlapping pause owners freeze progress until all owners release it',()=>{
  const f=fixture(),events:number[]=[];
  f.runtime.play(action(),{sourceFrames:3,frameDurationMs:60},index=>events.push(index),()=>events.push(3));
  f.runtime.setPaused('menu',true);f.runtime.setPaused('orientation',true);
  f.runtime.step(1);assert.deepEqual(events,[]);
  f.runtime.setPaused('menu',false);assert.equal(f.runtime.paused,true);
  f.runtime.setPaused('orientation',false);f.step(3);assert.deepEqual(events,[1,2,3]);
});

test('owner cancellation removes its actions and delayed hits while other owners continue',()=>{
  const f=fixture(),events:string[]=[];
  f.runtime.play(action(),{sourceFrames:2,frameDurationMs:60},()=>events.push('cast'),()=>events.push('end'));
  f.runtime.schedule('caster',1,()=>events.push('old-hit'));f.runtime.schedule('other',1,()=>events.push('other-hit'));
  f.runtime.cancel('caster');f.step();assert.deepEqual(events,['other-hit']);
});

test('reset and disposal invalidate pending work without rewinding the session clock',()=>{
  const f=fixture(),events:string[]=[];
  f.runtime.schedule('caster',2,()=>events.push('stale'));f.step();f.runtime.reset();
  f.runtime.schedule('caster',1,()=>events.push('new'));f.step();assert.deepEqual(events,['new']);
  f.runtime.schedule('caster',1,()=>events.push('closed'));f.runtime.dispose();f.step();assert.deepEqual(events,['new']);
});

test('homing flight settles at a logical boundary, with pause and cancellation owned by the caster',()=>{
  const f=fixture(),events:FlightEvent[]=[],hits:unknown[]=[];
  const target={...caster,id:'target',team:'enemy',position:{x:15,y:0}};
  f.runtime.fly({ownerId:caster.id,effect:'arrow',position:{x:0,y:0},targetId:target.id,kind:'trace',
    stepDistancePx:8,stepDurationMs:LOGIC_FRAME_MS},{actor:id=>id===target.id?target:undefined,emit:event=>events.push(event)},spot=>hits.push(spot));
  assert.equal(hits.length,0);f.step();assert.equal(hits.length,0);
  f.runtime.setPaused('menu',true);f.runtime.step(f.frame()+1);assert.equal(hits.length,0);
  f.runtime.setPaused('menu',false);f.step();assert.deepEqual(hits,[{x:15,y:0}]);
  assert.equal(events.at(-1)?.kind,'end');assert.equal(f.runtime.idle,true);
});

test('a departed homing target is discarded while a captured-position attack retains its landing',()=>{
  for(const kind of ['trace','position'] as const){
    const f=fixture();let target:Combatant|undefined={...caster,id:'target',position:{x:16,y:0}},hits=0;
    f.runtime.fly({ownerId:caster.id,effect:'orb',position:caster.position,targetId:'target',targetPosition:kind==='position'?target.position:undefined,
      kind,stepDistancePx:8,stepDurationMs:60,switchFrame:1},{actor:()=>target,emit:()=>{}},()=>hits++);
    target=undefined;f.step(2);assert.equal(hits,kind==='position'?1:0);assert.equal(f.runtime.idle,true);
  }
});

test('stationary transition and follow-up delay execute once after their switch frame',()=>{
  const f=fixture(),events:string[]=[];
  f.runtime.transition('caster',{kind:'stationary',effect:'sword',actionEffect:'impact',switchFrame:2,stepDistancePx:0,offsetX:0,offsetY:0},
    {...caster,id:'target'},caster.position,{actor:()=>caster,emit:()=>{},effect:name=>events.push(name)},()=>events.push('hit'));
  assert.deepEqual(events,['sword']);f.step();assert.deepEqual(events,['sword']);f.step(2);
  assert.deepEqual(events,['sword','impact','hit']);
});

test('a pause raised by the first action prevents later actions and tasks in the same frame',()=>{
  const f=fixture(),events:string[]=[];
  f.runtime.play(action(),{sourceFrames:3,frameDurationMs:60},()=>{events.push('first');f.runtime.setPaused('defeat',true);},()=>{});
  f.runtime.play({...action(),caster:{...caster,id:'other'}},{sourceFrames:3,frameDurationMs:60},()=>events.push('other'),()=>{});
  f.runtime.schedule('other',1,()=>events.push('task'));
  f.step();assert.deepEqual(events,['first']);
});

test('owner removal cancels an emitted flight before a stale visual completion can affect combat',()=>{
  const f=fixture();let hits=0;
  f.runtime.fly({ownerId:'caster',effect:'arrow',position:caster.position,targetId:'target',kind:'trace',stepDistancePx:8,stepDurationMs:60},
    {actor:()=>({...caster,id:'target',position:{x:100,y:0}}),emit:()=>{}},()=>hits++);
  f.runtime.removeActor('caster');f.step(20);assert.equal(hits,0);assert.equal(f.runtime.idle,true);
});
