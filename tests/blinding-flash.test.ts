import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {skillForGrowth,type BattleCatalog,type SkillGrowthProfile} from '../src/domain/battle.ts';
import {resolveCueTargets,type Combatant} from '../src/domain/combat.ts';
import {healTargetScore,type HealSlot} from '../src/domain/heal-target.ts';
import type {PartyBuffSlot} from '../src/domain/party-buff-targets.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const skill=(growth:SkillGrowthProfile)=>skillForGrowth(catalog.skills['blinding-flash'],growth);
const unitsEvent=(growth:SkillGrowthProfile)=>{
  const event=skill(growth).action!.events.find(entry=>entry.kind==='units')!;
  if(event.kind!=='units')throw new Error('units missing');
  return event;
};
const actor=(id:string,x:number,y=0,team='party'):Combatant=>({id,team,position:{x,y},bounds:{x:-4,y:-4,width:8,height:8}});

test('六个单元保留第四个纯表现单元，治疗落三队伍槽，伤害与睡眠走整数格距',()=>{
  for(const growth of ['hero','companion'] as const){
    const action=skill(growth).action!;
    assert.deepEqual(action.combatUnits!.map(unit=>unit.effect),
      ['set-attribute','magic','heal','visual','clear-attribute','state']);
    const event=unitsEvent(growth);
    assert.equal(event.frame,8);
    assert.deepEqual(event.cues.map(cue=>cue.target),['self','area','party','party-ally','self','area']);
    assert.deepEqual(event.cues.map(cue=>cue.targetRangePx),[112,112,112,112,112,112]);
    assert.equal(event.cues[1].targetRangeMetric,'octagonal-grid');
    assert.equal(event.cues[2].targetRangeMetric,'octagonal-grid');
    assert.equal(event.cues[3].targetRangeMetric,'octagonal-grid');
    assert.equal(event.cues[5].targetRangeMetric,'octagonal-grid');
    assert.equal(event.cues[3].targetSelection,'search');
    assert.deepEqual(event.cues[3].effects,[{effect:'energy-column',recipient:'target',placement:'attached'}]);
    assert.deepEqual(event.cues[2].effects,[{effect:'sparks-red',recipient:'target',placement:'attached'}]);
  }
});

test('主角与佣兵八级的神圣概率、魔伤与治疗倍率取各自训练分支',()=>{
  const chances={hero:[40,50,60,70,75,80,85,90],companion:[35,45,55,65,70,75,80,85]};
  const magic={hero:[1000,1080,1160,1240,1280,1320,1360,1400],companion:[960,1040,1120,1200,1240,1280,1320,1360]};
  const heal={hero:[5000,5400,5800,6200,6400,6600,6800,7000],companion:[4800,5200,5600,6000,6200,6400,6600,6800]};
  for(const growth of ['hero','companion'] as const){
    const units=skill(growth).action!.combatUnits!;
    for(let level=1;level<=8;level++){
      const chance=units[0],damage=units[1],healing=units[2],state=units[5];
      if(chance.effect!=='set-attribute'||damage.effect!=='magic'||healing.effect!=='heal'||state.effect!=='state')throw new Error('unit shape changed');
      assert.deepEqual(chance.ranks[level-1],{kind:'add',amount:chances[growth][level-1]});
      const rate=(operation:{kind:string;ratePerThousand?:number})=>{
        if(operation.kind!=='multiply-thousandth')throw new Error('operation kind changed');
        return operation.ratePerThousand;
      };
      assert.equal(rate(damage.ranks[level-1].operation),magic[growth][level-1]);
      assert.equal(rate(healing.ranks[level-1].operation),heal[growth][level-1]);
      assert.deepEqual(healing.attributeWeights,{strength:0,dexterity:0,vitality:0,intelligence:0,mentality:10});
      assert.equal(state.ranks[level-1].chanceThreshold,1000);
      assert.deepEqual(state.ranks[level-1].stateDurationProfile,{normal:{lastActiveFrame:90},targetShortened:{lastActiveFrame:45}});
    }
  }
});

test('闪光只治疗三个队伍槽，同阵营召唤物留给按角色池选人的恢复术',()=>{
  const caster=actor('caster',0);
  const member=actor('member',16);
  const summon=actor('summon',24);
  const partySlots:PartyBuffSlot<Combatant>[]=[{actor:member,active:true,hasDisplay:true}];
  const slots:HealSlot<Combatant>[]=[{actor:member,active:true,hasDisplay:true,score:healTargetScore(10,100,false)},
    {actor:summon,active:true,hasDisplay:true,score:healTargetScore(1,100,false)}];
  assert.deepEqual(resolveCueTargets(unitsEvent('hero').cues[2],caster,undefined,[member,summon],partySlots).map(entry=>entry.id),
    ['member'],'队伍槽治疗不把召唤物算进候选');
  assert.deepEqual(resolveCueTargets({target:'ally-heal',targetRangePx:112},caster,undefined,[member,summon],[],
    0,id=>slots.find(slot=>slot.actor.id===id)?.score,slots).map(entry=>entry.id),
    ['summon'],'恢复术的角色池按评分选中更危险的召唤物');
});
