import {CombatCooldownStore} from '../src/domain/combat-cooldowns.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareActionDamage,resolvePreparedActionDamage} from '../src/domain/action-damage.ts';
import type {NumericCombatUnit,SkillAction,SkillEffectCue} from '../src/domain/battle.ts';
import {CombatController} from '../src/domain/combat.ts';
import type {ActionPlayback,Combatant,CombatPort,SkillUnitHit,SkillUnitStart,SkillUnitsArrival,SkillUnitsReady} from '../src/domain/combat.ts';

const cue=(target:SkillEffectCue['target'],selection:SkillEffectCue['targetSelection']='search'):SkillEffectCue=>({
  target,targetSelection:selection,targetRangePx:40,targetRangeMetric:'octagonal-grid',effects:[],
});
const numeric=():NumericCombatUnit=>({effect:'magic',source:'bestNormalDamage',
  attributeWeights:{strength:10,dexterity:0,vitality:0,intelligence:12,mentality:0},
  ranks:[{fixedAddition:2,operation:{kind:'keep'}},{fixedAddition:20,operation:{kind:'multiply',factor:2}}],
});
function fixture(cues:SkillEffectCue[]){
  const caster:Combatant={id:'caster',team:'party',position:{x:0,y:0},bounds:{x:-4,y:-4,width:8,height:8}};
  const first:Combatant={...caster,id:'first',team:'enemy',position:{x:16,y:0}};
  const second:Combatant={...first,id:'second',position:{x:24,y:0}};
  const actors=new Map([caster,first,second].map(actor=>[actor.id,actor]));
  const event:SkillUnitsArrival['event']={kind:'units',frame:1,cues};
  const action:SkillAction={requiresTarget:false,cooldownFrames:0,approachDistanceUnits:4,searchRadiusPx:100,
    transition:null,combatUnits:cues.map(numeric),events:[event]};
  const skill:NonNullable<ActionPlayback['skill']>={id:'tested-skill',action,level:1};
  const primary={strength:10,dexterity:0,vitality:0,intelligence:5,mentality:0};
  const prepared:SkillUnitStart[]=[],hits:SkillUnitHit[]=[],damage:number[]=[];
  let source=100,frame:((index:number)=>void)=()=>{},dispatch:SkillUnitsReady=()=>[];
  let onHit:(hit:SkillUnitHit)=>void=()=>{};
  let onTargets:()=>void=()=>{};
  const port:CombatPort={cooldowns:new CombatCooldownStore(()=>0).forActor(caster.id),
    actor:id=>actors.get(id),candidates:()=>{onTargets();return [...actors.values()];},facing:()=> 'east',
    moveToward:()=>{},stop:()=>{},canStand:()=>true,relocate:()=>{},clearEffects:()=>{},
    play:(_playback,onFrame)=>{frame=onFrame;return ()=>{};},
    frame:(_playback,index,_contact,ready)=>{if(index===1)dispatch=ready;},
    prepareUnit:start=>{
      prepared.push(start);
      const unit=start.skill.action.combatUnits![start.cueIndex];
      return 'source' in unit?prepareActionDamage(unit,start.skill.level??1,primary):undefined;
    },
    unit:hit=>{
      hits.push(hit);
      damage.push(resolvePreparedActionDamage(hit.preparedDamage!,source));
      onHit(hit);return 'success';
    },
  };
  const controller=new CombatController(caster.id,null,port);
  return {actors,caster,first,second,skill,primary,prepared,hits,damage,
    start(){assert.equal(controller.request(skill),'started');frame(1);},
    arrival:():SkillUnitsArrival=>({event,selectedTargetId:first.id}),
    dispatch:(arrival:SkillUnitsArrival)=>dispatch(arrival),
    onHit:(fn:typeof onHit)=>{onHit=fn;},onTargets:(fn:typeof onTargets)=>{onTargets=fn;},
    source:(value:number)=>{source=value;},
  };
}

test('a Direct captures rank, prepares per unit, and reads source damage per target',()=>{
  const run=fixture([cue('area'),cue('area','reuse-previous')]);run.start();
  run.onTargets(()=>{run.primary.strength=20;});
  run.onHit(hit=>{
    if(hit.cueIndex===0&&hit.targetId==='first'){
      run.primary.strength=30;run.source(200);run.skill.level=2;
    }
  });
  const arrival=run.arrival();run.dispatch(arrival);
  assert.deepEqual(run.damage,[128,228,238,238]);
  assert.deepEqual(run.prepared.map(start=>start.skill.level),[1,1]);
  assert.equal(run.hits[0].preparedDamage,run.hits[1].preparedDamage);
  assert.notEqual(run.hits[1].preparedDamage,run.hits[2].preparedDamage);
  run.dispatch(arrival);
  assert.equal(run.prepared.length,2,'the same arrival executes once');
  run.onTargets(()=>{});run.onHit(()=>{});run.dispatch(run.arrival());
  assert.deepEqual(run.prepared.map(start=>start.skill.level),[1,1,2,2]);
  assert.deepEqual(run.damage.slice(4),[512,512,512,512]);
});

test('all searches in a Direct keep its caster origin while checking current candidates',()=>{
  const run=fixture([cue('area'),cue('area')]);run.start();
  run.onHit(hit=>{
    if(hit.cueIndex===0&&hit.targetId==='first'){
      run.caster.position.x=400;
      run.second.states=['stealthed'];
    }
  });
  run.dispatch(run.arrival());
  assert.deepEqual(run.hits.map(hit=>[hit.cueIndex,hit.targetId]),[
    [0,'first'],[0,'second'],[1,'first'],
  ]);
});

test('arrival center and selected target are copied before the first unit has side effects',()=>{
  const run=fixture([cue('area'),cue('area'),cue('current')]);run.start();
  run.first.position.x=416;run.second.position.x=424;
  const arrival={...run.arrival(),impactCenter:{x:400,y:0}};
  run.onHit(hit=>{
    if(hit.cueIndex===0&&hit.targetId==='first'){
      arrival.impactCenter.x=800;arrival.selectedTargetId='second';
      run.caster.position.x=1200;
    }
  });
  run.dispatch(arrival);
  assert.deepEqual(run.hits.map(hit=>[hit.cueIndex,hit.targetId]),[
    [0,'first'],[0,'second'],[1,'first'],[1,'second'],[2,'first'],
  ]);
});

test('an empty target search and its reuse still prepare each unit',()=>{
  const run=fixture([cue('area'),cue('area','reuse-previous')]);run.start();
  run.actors.delete('first');run.actors.delete('second');
  run.dispatch(run.arrival());
  assert.deepEqual(run.prepared.map(start=>start.cueIndex),[0,1]);
  assert.deepEqual(run.hits,[]);
});
