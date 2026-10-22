import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBattle } from '../src/application/content-validation.ts';
import { CombatController,resolveCueTargets } from '../src/domain/combat.ts';
import type { ActionPlayback,Combatant,CombatPort,SkillUnitHit } from '../src/domain/combat.ts';
import type { SkillAction } from '../src/domain/battle.ts';
import { CombatCooldownStore } from '../src/domain/combat-cooldowns.ts';

const catalog=parseBattle(JSON.parse(fs.readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')));
const action=catalog.skills['giant-blow'].action!;
const event=action.events.find(event=>event.kind==='units')!;
const bounds={x:-8,y:-8,width:16,height:16};
const caster:Combatant={id:'player',team:'party',position:{x:0,y:0},bounds,facing:'east'};
const enemy=(id:string,x:number,y=0):Combatant=>({id,team:'hostile',position:{x,y},bounds});
const selected=enemy('selected',32),nearby=enemy('nearby',64),byCaster=enemy('by-caster',-32);
const ids=(actors:Combatant[])=>actors.map(actor=>actor.id);

test('giant-blow centers on a reachable current target, including one outside the candidate query',()=>{
  assert.equal(event.frame,16);
  for(const cue of event.cues){
    assert.equal(cue.target,'target-area');
    assert.equal(cue.targetRangePx,40);
    assert.equal(cue.targetRangeMetric,'octagonal-grid');
    assert.deepEqual(ids(resolveCueTargets(cue,caster,selected,[caster,selected,nearby,byCaster])),['selected','nearby']);
    assert.deepEqual(ids(resolveCueTargets(cue,caster,selected,[nearby,byCaster])),['nearby']);
  }
});

test('a missing current target searches by facing and falls back to the caster when no candidate scores',()=>{
  const cue=event.cues[0];
  assert.deepEqual(ids(resolveCueTargets(cue,caster,undefined,[caster,byCaster,selected,nearby])),['selected','nearby']);
  const behind=enemy('behind',-40);
  assert.deepEqual(ids(resolveCueTargets(cue,caster,undefined,[caster,behind])),['behind']);
});

test('an unreachable current target falls back without replacing it with another reachable candidate',()=>{
  const far=enemy('current',80);
  assert.deepEqual(ids(resolveCueTargets(event.cues[0],caster,far,[caster,selected,byCaster,nearby])),['selected','by-caster']);
});

test('target-area uses grid distance, excludes hidden enemies and allies, and preserves pool order including immune targets',()=>{
  const immune:Combatant={...enemy('immune',40),states:['damage-immune']};
  const hidden:Combatant={...enemy('hidden',40),states:['stealthed']};
  const ally:Combatant={...enemy('ally',40),team:'party'};
  const edge=enemy('edge',79),outside=enemy('outside',80);
  const rest=Array.from({length:16},(_,index)=>enemy(`enemy-${index}`,40));
  const targets=resolveCueTargets(event.cues[0],caster,selected,[hidden,ally,immune,edge,outside,...rest]);
  assert.deepEqual(ids(targets),['immune','edge',...rest.slice(0,14).map(actor=>actor.id)]);
});

function fixture(skillAction:SkillAction=action){
  const actors=new Map([caster,selected,nearby,byCaster].map(actor=>[actor.id,structuredClone(actor)]));
  const hits:SkillUnitHit[]=[];
  let onHit:(hit:SkillUnitHit)=>void=()=>{};
  let frame:(index:number)=>void=()=>{};
  let playback:ActionPlayback|undefined;
  const port:CombatPort={
    cooldowns:new CombatCooldownStore(()=>0).forActor(caster.id),
    actor:id=>actors.get(id),candidates:()=>[...actors.values()],facing:()=> 'east',
    moveToward:()=>{},stop:()=>{},canStand:()=>true,relocate:()=>{},clearEffects:()=>{},
    play:(action,onFrame)=>{playback=action;frame=onFrame;return ()=>{};},
    frame:(action,index,_contact,ready)=>{
      for(const entry of action.skill!.action.events)
        if(entry.kind==='units'&&entry.frame===index)ready({event:entry,selectedTargetId:action.target?.id});
    },
    unit:hit=>{hits.push(hit);onHit(hit);return 'success';},
  };
  const controller=new CombatController(caster.id,null,port);
  const skill={id:'giant-blow',action:skillAction,level:1,manaCost:48};
  return {actors,hits,controller,
    start(){assert.equal(controller.request(skill,selected.id),'started');},
    dispatch(){frame(event.frame);},playback:()=>playback!,onHit:(callback:typeof onHit)=>{onHit=callback;},
  };
}

test('target-area reads the current target at execution while reusing the first target list for stun',()=>{
  const run=fixture();run.start();
  run.controller.setReactionTarget(byCaster.id);
  run.onHit(hit=>{
    if(hit.cueIndex===0){
      run.actors.get(byCaster.id)!.position.x=-200;
      run.controller.setReactionTarget(selected.id);
    }
  });
  run.dispatch();
  assert.equal(run.playback().target?.id,selected.id,'the playback still owns its original target');
  assert.deepEqual(run.hits.map(hit=>[hit.cueIndex,hit.targetId]),[[0,byCaster.id],[1,byCaster.id]]);
  assert.equal(run.controller.snapshot().targetId,selected.id,'reuse does not overwrite a reaction target');
});

test('reselection publishes the new current target without cancelling an accepted cast',()=>{
  const run=fixture();run.start();
  run.actors.delete(selected.id);run.controller.targetRemoved(selected.id);
  const replacement=enemy('replacement',24);run.actors.set(replacement.id,replacement);
  const changes:(string|undefined)[]=[];
  run.controller.subscribe(snapshot=>changes.push(snapshot.targetId));
  run.dispatch();
  assert.equal(run.controller.snapshot().targetId,replacement.id);
  assert.equal(run.controller.snapshot().state,'attacking');
  assert.deepEqual(changes,[undefined,replacement.id]);
  assert.deepEqual(run.hits.filter(hit=>hit.cueIndex===0).map(hit=>hit.targetId),[nearby.id,replacement.id]);
});

test('failed current-target reach preserves the pointer and executes the caster-centered area',()=>{
  const run=fixture();run.start();
  run.actors.get(selected.id)!.position.x=80;
  run.dispatch();
  assert.equal(run.controller.snapshot().targetId,selected.id);
  assert.deepEqual(run.hits.map(hit=>[hit.cueIndex,hit.targetId]),[[0,byCaster.id],[1,byCaster.id]]);
});

test('current-target cues keep the arrival target after an unrelated reaction changes selection',()=>{
  const skillAction:SkillAction={...action,events:action.events.map(entry=>entry.kind==='units'
    ?{...entry,cues:entry.cues.map(cue=>({...cue,target:'current'}))}:entry)};
  const run=fixture(skillAction);run.start();run.controller.setReactionTarget(byCaster.id);run.dispatch();
  assert.deepEqual(run.hits.map(hit=>[hit.cueIndex,hit.targetId]),[[0,selected.id],[1,selected.id]]);
  assert.equal(run.controller.snapshot().targetId,byCaster.id);
});

test('target-area checks the live caster position but retains the Direct origin for a failed search',()=>{
  const skillAction:SkillAction={...action,events:action.events.map(entry=>entry.kind==='units'
    ?{...entry,cues:entry.cues.map((cue,index)=>({...cue,target:index===0?'area':'target-area',targetSelection:'search'}))}:entry)};
  const run=fixture(skillAction);run.start();
  run.onHit(hit=>{if(hit.cueIndex===0)run.actors.get(caster.id)!.position.x=400;});
  run.dispatch();
  assert.deepEqual(run.hits.map(hit=>[hit.cueIndex,hit.targetId]),[
    [0,selected.id],[0,byCaster.id],[1,selected.id],[1,byCaster.id],
  ]);
  assert.equal(run.controller.snapshot().targetId,selected.id);
});
