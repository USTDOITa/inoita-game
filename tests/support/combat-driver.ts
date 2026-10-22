import {CombatActionDispatcher} from '../../src/domain/combat-action-dispatcher.ts';
import {CombatRuntime} from '../../src/domain/combat-runtime.ts';
import type {ActionPlayback,Combatant} from '../../src/domain/combat.ts';
import type {BattleCatalog,AttackPlacement} from '../../src/domain/battle.ts';
import {skillSequence,skillRepeatSkippedFrames} from '../../src/domain/skill-action.ts';

const get=(host:object,key:string)=>Reflect.get(host,key);
const invoke=(host:object,key:string,...args:unknown[])=>{
  const fn=get(host,key);return typeof fn==='function'?fn.call(host,...args):undefined;
};
const clocks=new WeakMap<object,CombatRuntime>();

/** 视觉桩只收集输出；动作派发来自领域入口。 */
export function dispatchFrame(presenter:object,...args:Parameters<CombatActionDispatcher['frame']>):void {
  const action=args[0];
  const runtime=clocks.get(presenter)??new CombatRuntime(()=>0);
  if(Object.hasOwn(presenter,'transition'))runtime.transition=((_owner,transition,target,position,_port,arrive)=>{
    invoke(presenter,'transition',transition,target,position,action.facing,arrive);
  }) as typeof runtime.transition;
  if(Object.hasOwn(presenter,'fly'))runtime.fly=((request,_port,arrive)=>{
    invoke(presenter,'fly',request.effect,request.position,request.targetId,action.facing,0,0,request.stepDistancePx,request.stepDurationMs,arrive,request.aboveCharacters);
  }) as typeof runtime.fly;
  const candidates=()=>invoke(presenter,'candidates') as Combatant[]??[action.caster,...action.target?[action.target]:[]];
  const actor=(id:string)=>candidates().find(actor=>actor.id===id)??(id===action.caster.id?action.caster:id===action.target?.id?action.target:undefined);
  const scene=get(presenter,'scene') as {events?:{emit(name:string,data:unknown):void};cameras?:{main:{width:number;height:number}}};
  new CombatActionDispatcher({runtime,catalog:(get(presenter,'catalog')??{enemies:action.skill?.action.events.flatMap(event=>event.kind==='summon'?event.creatures.map(creature=>({id:creature.enemyId,actor:{collision:action.caster.bounds}})):[])}) as BattleCatalog,actor,candidates,random:()=>Math.random(),
    viewport:()=>scene?.cameras?.main??{width:640,height:360},
    pose:(playback,index)=>{invoke(presenter,'pose',playback,index);},
    visualEffect:(effect,variant,actor)=>invoke(presenter,'visualEffect',effect,variant,actor),
    effect:(name,variant,position,placement?:AttackPlacement,id?:string)=>{
      if(placement)invoke(presenter,'placedEffect',name,variant,position,placement,invoke(presenter,'visual',id));
      else invoke(presenter,'effect',name,variant,position);
    },
    flight:event=>invoke(presenter,'renderFlight',event),screen:value=>invoke(presenter,'screenFill',value),
    notify:(name,data)=>{if(name!=='skill-effect')scene?.events?.emit(name,data);},
    canSummonAt:()=>true,nearestSummonSpot:(position,_bounds,preferred)=>preferred??position,beginSummons:()=>{if(Object.hasOwn(presenter,'summon'))invoke(presenter,'summon',action,action.skill?.action.events.find(event=>event.kind==='summon'),action.caster.position);},summon:()=>undefined,
  }).frame(...args);
}

/** 测试桩的动画通知只提供经过的时间，结算仍由 CombatRuntime 执行。 */
export function playCombat(presenter:object,action:ActionPlayback,frame:(index:number)=>void,complete:()=>void):()=>void {
  const visual=invoke(presenter,'visual',action.caster.id) as {actor:{clips:Record<string,{frames:number}>};layers:Array<{on(name:string,fn:(...args:unknown[])=>void):void;off(name:string,fn:(...args:unknown[])=>void):void}>};
  const name=action.skill?(action.skill.clips?.[action.facing]??`skill-${action.skill.id}-${action.facing}`):action.basicAttack?.clips[action.facing];
  const sourceFrames=name?visual.actor.clips[name].frames:1;
  let now=0,finished=false,seeking=false;const runtime=new CombatRuntime(()=>now);clocks.set(presenter,runtime);
  const cancelVisual=invoke(presenter,'play',action) as ()=>void;
  const source=visual.layers[0];
  const scene=get(presenter,'scene') as {time?:{delayedCall(ms:number,callback:()=>void):{remove():void}}};
  let timer:{remove():void}|undefined;
  const cleanup=()=>{source?.off('animationupdate',update);source?.off('animationcomplete',finish);timer?.remove();};
  const cancel=runtime.play(action,{sourceFrames,frameDurationMs:action.basicAttack?.frameDurationMs??60},index=>{
    frame(index);seeking=true;invoke(presenter,'syncActionAnimation',action,index);seeking=false;
  },()=>{
    finished=true;cleanup();cancelVisual();complete();
  });
  const advance=(index:number)=>{while(now<index&&!finished)runtime.step(++now);};
  const update=(...args:unknown[])=>{if(seeking)return;const skip=action.skill?skillRepeatSkippedFrames(action.skill.action,action.skill.level??1,action.repeatState):0;advance((args[1] as {index:number}).index-1-skip);};
  const total=action.basicAttackWait?.durationFrames??(action.skill?skillSequence(action.skill.action,action.skill.level??1,sourceFrames).length:action.basicAttack!.effectiveCycleFrames);
  const finish=()=>{if(!finished)advance(Math.max(total,now+1));};
  source?.on('animationupdate',update);source?.on('animationcomplete',finish);
  timer=scene.time?.delayedCall(total*60+(action.basicAttackWait?0:250),finish);
  return ()=>{finished=true;cancel();cleanup();cancelVisual();};
}
