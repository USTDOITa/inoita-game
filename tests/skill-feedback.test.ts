import {dispatchFrame} from './support/combat-driver.ts';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {ActionPlayback} from '../src/domain/combat.ts';
import type {SkillFeedbackEvent,BattleCatalog,SkillAction} from '../src/domain/battle.ts';
import {skillEffectNames,skillSoundNames} from '../src/domain/skill-action.ts';
import {CombatCooldownStore} from '../src/domain/combat-cooldowns.ts';
const hook=registerHooks({resolve(specifier,context,next){return specifier==='phaser'
  ?{url:'data:text/javascript,export default {BlendModes:{},Scene:class{},Physics:{Arcade:{Body:class{}}}}',shortCircuit:true}
  :next(specifier,context);}});
const {WorldCombat}=await import('../src/scenes/world-combat.ts');
const {CombatFeedback}=await import('../src/rendering/combat-feedback.ts');hook.deregister();
const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;

test('the real party frame port leaves explicit sound to the ordered feedback event after units',()=>{
  const order:string[]=[],event:SkillFeedbackEvent={kind:'feedback',frame:10,shake:true,vibrationMs:300,sound:'Bn_Hell_Sword'};
  const action:ActionPlayback={caster:{id:'player',team:'party',position:{x:0,y:0},bounds:{x:0,y:0,width:8,height:8}},
    facing:'south',basicAttack:null,skill:{id:'sword-of-hell',action:{...catalog.skills['sword-of-hell'].action!,
      events:[{kind:'units',frame:10,cues:[]},event]}}};
  const host=Object.setPrototypeOf({presentActionFrame:(presenter:object,...args:Parameters<typeof dispatchFrame> extends [object,...infer Rest]?Rest:never)=>dispatchFrame(presenter,...args),scene:{refreshCombatTarget:()=>{},refreshSkillCooldowns:()=>{}},
    app:{session:{cooldowns:new CombatCooldownStore(()=>0)},audio:{playerSkill:()=>order.push('automatic-sound'),effect:(name:string)=>order.push(name)}},
    feedback:{startShake:()=>order.push('shake'),vibrate:(ms:number)=>order.push(`vibrate:${ms}`)},partyControllers:new Map(),soundedSkills:new WeakSet(),
  },WorldCombat.prototype);
  const presenter={pose:()=>{}};
  const {port}=Reflect.get(WorldCombat.prototype,'createPartyController').call(host,'player',{},presenter,null);
  port.frame(action,10,()=>{},()=>{order.push('units');return [];});
  assert.deepEqual(order,['units','shake','vibrate:300','Bn_Hell_Sword']);
  assert.deepEqual(skillEffectNames(action.skill!.action),[]);
  order.length=0;action.caster.id='companion';port.frame(action,10,()=>{},()=>{order.push('units');return [];});
  assert.deepEqual(order,['units','shake','vibrate:300']);
});

test('skill camera feedback reuses all six native world-pixel offsets and resets cleanly on restart',()=>{
  const offsets=catalog.feedback.shakeOffsets,values:{x:number;y:number}[]=[];
  const camera={followOffset:{x:2,y:3},setFollowOffset(x:number,y:number){this.followOffset={x,y};values.push({x,y});}};
  let tween:{targets:{step:number};step:number;duration:number;onUpdate:()=>void;onComplete:()=>void}|undefined,stops=0;
  const feedback=Object.setPrototypeOf({catalog,visible:true,paused:false,scene:{cameras:{main:camera},tweens:{add:(config:typeof tween)=>{
    tween=config;return {stop:()=>stops++};
  }}}},CombatFeedback.prototype);
  feedback.startShake();assert.equal(tween!.duration,360);
  for(let step=1;step<6;step++){tween!.targets.step=step;tween!.onUpdate();}
  assert.deepEqual(values,offsets.map(offset=>({x:2-offset.x,y:3-offset.y})));
  tween!.onComplete();assert.deepEqual(camera.followOffset,{x:2,y:3});
  feedback.startShake();feedback.startShake();assert.deepEqual(camera.followOffset,{x:8,y:9});
  feedback.cancelShake();assert.deepEqual(camera.followOffset,{x:2,y:3});assert.equal(stops,3);
});

test('device vibration respects the native disabled default and tolerates unsupported browsers',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator'),calls:number[]=[];
  try{
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{vibrate:(ms:number)=>{calls.push(ms);return true;}}});
    const feedback=Object.setPrototypeOf({visible:true,vibrationEnabled:false},CombatFeedback.prototype);
    feedback.vibrate(300);assert.deepEqual(calls,[]);
    feedback.vibrationEnabled=true;feedback.vibrate(300);assert.deepEqual(calls,[300]);
    feedback.visible=false;feedback.vibrate(300);assert.deepEqual(calls,[300]);
    feedback.visible=true;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
    assert.doesNotThrow(()=>feedback.vibrate(300));
  }finally{
    if(original)Object.defineProperty(globalThis,'navigator',original);else Reflect.deleteProperty(globalThis,'navigator');
  }
});

test('技能动作音效遍历取到动作单元与派发收尾两类触发点',()=>{
  assert.deepEqual(skillSoundNames(catalog.skills['divine-strike'].action!),['A_Skill_Attack01','A_Skill_05']);
  assert.deepEqual(skillSoundNames(catalog.skills['dark-strike'].action!),['Wa_Titan_Attack']);
  const feedback:SkillAction={...catalog.skills['divine-strike'].action!,
    events:[{kind:'feedback',frame:4,sound:'Bn_Hell_Sword'}]};
  assert.deepEqual(skillSoundNames(feedback),['Bn_Hell_Sword']);
  assert.deepEqual(skillSoundNames({...feedback,events:[]}),[]);
});
