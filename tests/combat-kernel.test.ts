import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {CombatRuntime} from '../src/domain/combat-runtime.ts';
import {CombatController,type CombatPort,type Combatant} from '../src/domain/combat.ts';
import {CombatActionDispatcher} from '../src/domain/combat-action-dispatcher.ts';
import {CombatCooldownStore} from '../src/domain/combat-cooldowns.ts';
import {resolveBasicAttack} from '../src/domain/basic-attack.ts';
const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;

for(const character of catalog.classes)test(`${character.id}: real starter skill runs through the kernel without Phaser`,()=>{
  let frame=0,mana=10000,outputs=0,units=0,summons=0;
  const runtime=new CombatRuntime(()=>frame),cooldowns=new CombatCooldownStore(()=>frame);
  const caster:Combatant={id:'player',team:'party',position:{x:100,y:100},bounds:character.actor.collision!};
  const target:Combatant={...caster,id:'enemy',team:'hostile',position:{x:108,y:100}};
  const actors=new Map([caster,target].map(actor=>[actor.id,actor]));
  const dispatcher=new CombatActionDispatcher({runtime,catalog,actor:id=>actors.get(id),candidates:()=>[...actors.values()],random:()=>0.5,
    viewport:()=>({width:800,height:480}),pose:()=>{},effect:()=>outputs++,flight:()=>outputs++,screen:()=>outputs++,notify:()=>outputs++,
    canSummonAt:()=>true,nearestSummonSpot:(position,_bounds,preferred)=>preferred??position,beginSummons:()=>{},summon:()=>`summon-${++summons}`});
  const skill=catalog.skills[character.skills[0]];assert.ok(skill.action);
  const port:CombatPort={cooldowns:cooldowns.forActor(caster.id),isPaused:()=>runtime.paused,
    actor:id=>actors.get(id),candidates:()=>[...actors.values()],facing:()=> 'south',canStand:()=>true,
    stop:()=>{},moveToward:()=>{},relocate:position=>{caster.position=position;},clearEffects:()=>runtime.cancel(caster.id),
    canSelectSkill:()=>true,canSpendMana:cost=>mana>=cost,spendMana:cost=>{mana-=cost;return true;},
    play:(action,onFrame,complete)=>runtime.play(action,{sourceFrames:character.actor.clips[action.skill?.clips?.south??`skill-${skill.id}-south`]?.frames??8,frameDurationMs:60},onFrame,complete),
    frame:(action,index,contact,ready,area)=>dispatcher.frame(action,index,contact,ready,()=>{},undefined,area),unit:()=>{units++;return 'success';}};
  const controller=new CombatController(caster.id,resolveBasicAttack(catalog,character),port);runtime.registerActor(caster.id,controller);
  const request={actorId:caster.id,skill:{id:skill.id,action:skill.action!,level:1,manaCost:10},targetId:target.id,mode:'manual' as const};
  assert.equal(runtime.request(request).kind,'started');assert.equal(mana,9990);
  const before={outputs,units};runtime.setPaused('menu',true);assert.equal(runtime.request(request).kind,'rejected');runtime.step(1);
  assert.deepEqual({outputs,units},before);runtime.setPaused('menu',false);
  for(let count=0;count<300&&!runtime.idle;count++)runtime.step(++frame);
  assert.equal(runtime.idle,true);assert.equal(controller.snapshot().state,'idle');assert.ok(outputs+units+summons>0);
  runtime.dispose();assert.equal(runtime.request(request).kind,'rejected');
});

const {combatFollowUp}=await import('../src/domain/combat-follow-ups.ts');
const followUpCases:Array<['lightning-of-hell'|'god-of-justice',string,Record<string,number>]>=[
  ['lightning-of-hell','warlock',{'lightning-of-hell':8}],
  ['god-of-justice','priest',{'god-of-justice':8,'celestial-lightning':1}],
];
for(const [kind,classId,levels] of followUpCases)test(`${kind}: private follow-up timing and pause work with empty visual sinks`,()=>{
  let frame=0,hits=0;const runtime=new CombatRuntime(()=>frame);
  const caster:Combatant={id:'player',team:'party',position:{x:0,y:0},bounds:{x:0,y:0,width:8,height:8}};
  const target:Combatant={...caster,id:'enemy',team:'hostile',position:{x:20,y:0}};
  const actors=new Map([caster,target].map(actor=>[actor.id,actor]));
  const port={catalog,runtime,loadout:()=>({classId,skills:{levels}}),random:()=>0,active:()=>true,actor:(id:string)=>actors.get(id),
    casterStrikes:()=>{},flight:{actor:(id:string)=>actors.get(id),emit:()=>{},effect:()=>{}},execute:()=>hits++};
  combatFollowUp(kind,'player','enemy',port);assert.equal(hits,0);
  runtime.setPaused('menu',true);runtime.step(1);assert.equal(hits,0);runtime.setPaused('menu',false);
  while(!runtime.idle&&frame<30)runtime.step(++frame);assert.equal(hits,1);
  combatFollowUp(kind,'player','enemy',port);runtime.cancel('player');runtime.step(++frame);assert.equal(hits,1);
});
