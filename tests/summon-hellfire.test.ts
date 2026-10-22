import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {skillForGrowth,type BattleCatalog,type SkillGrowthProfile} from '../src/domain/battle.ts';
import {CombatCooldownStore} from '../src/domain/combat-cooldowns.ts';
import {CombatController,resolveCueTargets,type Combatant,type CombatPort,type SkillUnitHit} from '../src/domain/combat.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const skill=(growth:SkillGrowthProfile)=>skillForGrowth(catalog.skills['summon-hellfire'],growth);
const actor=(id:string,x:number,y=0,team='enemy'):Combatant=>({id,team,position:{x,y},bounds:{x:-4,y:-4,width:8,height:8}});
const unitsEvent=(growth:SkillGrowthProfile)=>{
  const event=skill(growth).action!.events.find(entry=>entry.kind==='units')!;
  if(event.kind!=='units')throw new Error('units missing');
  return event;
};

test('主角与佣兵八级火焰机会与伤害倍率取各自训练分支，动作无需目标',()=>{
  const chances={hero:[63,84,98,105,112,119,126,133],companion:[49,63,77,91,98,105,112,119]};
  const rates={hero:[2120,2360,2520,2600,2680,2760,2840,2920],companion:[1960,2120,2280,2440,2520,2600,2680,2760]};
  for(const growth of ['hero','companion'] as const){
    const action=skill(growth).action!;
    assert.equal(action.requiresTarget,false);
    assert.equal(action.approachDistanceUnits,14);assert.equal(action.searchRadiusPx,112);
    const units=action.combatUnits!;
    assert.deepEqual(units.map(unit=>unit.effect),['set-attribute','magic','clear-attribute']);
    for(let level=1;level<=8;level++){
      const chance=units[0],damage=units[1];
      if(chance.effect!=='set-attribute'||damage.effect!=='magic')throw new Error('unit shape changed');
      assert.equal(chance.attribute,'fireSplashChance');
      assert.deepEqual(chance.ranks[level-1],{kind:'add',amount:chances[growth][level-1]});
      const operation=damage.ranks[level-1].operation;
      assert.equal(operation.kind,'multiply-thousandth');
      if(operation.kind!=='multiply-thousandth')throw new Error('damage operation changed');
      assert.equal(operation.ratePerThousand,rates[growth][level-1]);
      assert.deepEqual(damage.attributeWeights,{strength:0,dexterity:0,vitality:0,intelligence:12,mentality:10});
    }
  }
});

test('空场也能起手，伤害只在第3帧按落点八方向格距结算一次',()=>{
  const action=skill('hero').action!,event=unitsEvent('hero');
  const caster=actor('caster',0,0,'party');
  const near=actor('near',119),out=actor('out',120),casterAlly=actor('ally',119,0,'party');
  const actors=new Map([caster,near,out,casterAlly].map(entry=>[entry.id,entry]));
  const hits:SkillUnitHit[]=[];let frame=(_index:number)=>{},arrive=()=>{};
  const port:CombatPort={cooldowns:new CombatCooldownStore(()=>0).forActor(caster.id),
    actor:id=>actors.get(id),candidates:()=>[...actors.values()],facing:()=> 'east',
    moveToward:()=>{},stop:()=>{},canStand:()=>true,relocate:()=>{},clearEffects:()=>{},
    play:(_action,onFrame)=>{frame=onFrame;return ()=>{};},
    frame:(_action,index,_contact,ready)=>{if(index===event.frame)arrive=()=>{ready({event,impactCenter:caster.position,selectedTargetId:caster.id});};},
    unit:hit=>{hits.push(hit);return 'success';}};
  const combat=new CombatController(caster.id,null,port);
  assert.equal(combat.request({id:'summon-hellfire',action,level:1},undefined),'started','空场没有目标也要进入动作');
  frame(event.frame-1);assert.equal(hits.length,0);
  frame(event.frame);arrive();
  assert.deepEqual(hits.filter(hit=>hit.cueIndex===1).map(hit=>hit.targetId),['near']);
  assert.deepEqual(hits.filter(hit=>hit.cueIndex===0||hit.cueIndex===2).map(hit=>hit.targetId),['caster','caster']);
  assert.equal(hits.filter(hit=>hit.targetId==='ally').length,0,'自身中心范围不含队友');
});

test('范围中心停留在施法者位置，远近敌人各自按整数格距取舍',()=>{
  const caster=actor('caster',100,100,'party');
  const targets=[actor('axis-in',219,100),actor('axis-out',220,100),actor('diagonal-in',186,186),actor('diagonal-out',187,187)];
  for(const growth of ['hero','companion'] as const){
    const cue=unitsEvent(growth).cues[1];
    assert.equal(cue.target,'area');assert.equal(cue.targetRangeMetric,'octagonal-grid');assert.equal(cue.targetRangePx,112);
    assert.deepEqual(resolveCueTargets(cue,caster,undefined,targets).map(entry=>entry.id),['axis-in','diagonal-in']);
  }
});
