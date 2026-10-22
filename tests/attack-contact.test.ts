import {CombatCooldownStore} from '../src/domain/combat-cooldowns.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CombatController } from '../src/domain/combat.ts';
import type { ActionPlayback, AttackContact, Combatant, CombatPort } from '../src/domain/combat.ts';
import type { BattleCatalog, SkillAction } from '../src/domain/battle.ts';
import { projectileStep, resolveBasicAttack } from '../src/domain/basic-attack.ts';
import { skillPlaybackEvents } from '../src/domain/skill-action.ts';
const catalog:BattleCatalog=JSON.parse(fs.readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8'));

function setup(ranged=false){
  const caster:Combatant={id:'player',team:'party',position:{x:32,y:32},bounds:{x:-8,y:-8,width:16,height:16}};
  const target:Combatant={...caster,id:'enemy',team:'enemy',position:{x:48,y:32}};
  const ally:Combatant={...target,id:'ally',team:'party'};
  const actors=new Map([caster,target,ally].map(actor=>[actor.id,actor]));
  const basic=resolveBasicAttack(catalog,catalog.classes.find(c=>c.id===(ranged?'ranger':'dark-knight'))!);
  const contacts:AttackContact[]=[],actions:ActionPlayback[]=[];
  let frame:(index:number)=>void=()=>{},finish=()=>{},arrival:(id:string)=>void=()=>{};
  const port:CombatPort={cooldowns:new CombatCooldownStore(()=>0).forActor(caster.id),actor:id=>actors.get(id),candidates:()=>[...actors.values()],facing:()=> 'south',moveToward:()=>{},stop:()=>{},canStand:()=>true,relocate:()=>{},
    play:(_action,onFrame,onFinish)=>{frame=onFrame;finish=onFinish;return ()=>{};},
    frame:(action,index,onContact,ready)=>{
      actions.push(structuredClone(action));arrival=onContact;
      if(!action.skill&&index===basic.strikeFrame&&!basic.projectile&&!basic.transition&&action.target)onContact(action.target.id);
      if(action.skill&&!action.skill.action.transition)for(const event of skillPlaybackEvents(action.skill.action,index,action.skill.level))
        if(event.kind==='units')ready({event,selectedTargetId:action.target?.id});
    },unit:()=> 'success',contact:event=>contacts.push(event),clearEffects:()=>{}};
  const combat=new CombatController(caster.id,basic,port);
  return {combat,port,basic,actors,contacts,actions,frame:(index:number)=>frame(index),finish:()=>finish(),arrival:(id:string)=>arrival(id)};
}

test('melee contact occurs once at strike and keeps the locked target after it moves out of reach',()=>{
  const run=setup();run.combat.requestTarget('enemy');run.actors.get('enemy')!.position={x:800,y:200};
  run.frame(run.basic.strikeFrame);run.frame(run.basic.strikeFrame);
  assert.deepEqual(run.contacts,[{casterId:'player',targetId:'enemy'}]);
  assert.deepEqual(run.actions.at(-1)!.target!.position,{x:800,y:200});assert.equal(run.actions.at(-1)!.facing,'east');
});

test('flight contact waits for arrival, survives action completion, and ignores missing or friendly recipients',()=>{
  const run=setup(true);run.combat.requestTarget('enemy');run.frame(run.basic.strikeFrame);
  assert.deepEqual(run.contacts,[]);run.finish();run.arrival('ally');run.arrival('player');run.arrival('missing');
  assert.deepEqual(run.contacts,[]);run.arrival('enemy');run.arrival('enemy');
  assert.deepEqual(run.contacts,[{casterId:'player',targetId:'enemy'}]);
  const removed=setup(true);removed.combat.requestTarget('enemy');removed.frame(removed.basic.strikeFrame);removed.actors.delete('enemy');removed.arrival('enemy');assert.deepEqual(removed.contacts,[]);
});

test('an emitted basic projectile survives manual skill takeover and hits only once',()=>{
  const run=setup(true);
  let arrival:((id:string)=>void)|undefined;
  run.port.frame=(action,index,contact)=>{if(!action.skill&&index===run.basic.strikeFrame)arrival=contact;};
  run.port.clearEffects=()=>assert.fail('skill takeover cleared the emitted projectile');
  run.combat.requestTarget('enemy');run.frame(run.basic.strikeFrame);
  assert.ok(arrival);assert.deepEqual(run.contacts,[]);
  assert.equal(run.combat.requestManualSkill({id:'demon-s-shield',action:catalog.skills['demon-s-shield'].action!}),'started');
  arrival('enemy');arrival('enemy');
  assert.deepEqual(run.contacts,[{casterId:'player',targetId:'enemy'}]);
  assert.equal(run.combat.snapshot().state,'attacking');
});

test('direct skill units report only opposing contacts from current positions',()=>{
  const run=setup();
  const action:SkillAction={requiresTarget:false,cooldownFrames:0,approachDistanceUnits:4,searchRadiusPx:100,transition:null,
    events:[{kind:'units',frame:1,cues:[{target:'area',targetRangePx:30,effects:[]},{target:'self',targetRangePx:0,effects:[]}]}]};
  run.combat.request({id:'contact-test',action});run.actors.get('enemy')!.position={x:500,y:500};run.frame(1);assert.deepEqual(run.contacts,[]);
  run.finish();run.combat.request({id:'contact-test',action});run.actors.get('enemy')!.position={x:48,y:32};run.frame(1);
  assert.deepEqual(run.contacts,[{casterId:'player',targetId:'enemy',skillId:'contact-test'}]);
});

test('tracking projectile steps use the latest target and retain the original arrival boundary',()=>{
  assert.deepEqual(projectileStep({x:0,y:0},{x:16,y:0},16),{position:{x:16,y:0},arrived:false});
  assert.deepEqual(projectileStep({x:16,y:0},{x:16,y:0},16),{position:{x:16,y:0},arrived:true});
  const first=projectileStep({x:0,y:0},{x:80,y:0},16);
  const turned=projectileStep(first.position,{x:16,y:80},16);assert.deepEqual(turned.position,{x:16,y:16});
  assert.throws(()=>projectileStep({x:0,y:0},{x:10,y:0},0),/步长/);
});
