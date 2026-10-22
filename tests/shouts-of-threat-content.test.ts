import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {actionDamage} from '../src/domain/action-damage.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';

const battle=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const skill=battle.skills['shouts-of-threat'],action=skill.action!,units=action.combatUnits!;
const damage=units[0],buff=units[1];
assert.ok(damage.effect==='physical'&&buff.effect==='buff');
const rates=[200,240,280,340,360,380,400,420];

test('Shouts of Threat expands eight priorities independently from its damage and speed formulas',()=>{
  assert.deepEqual(units.map(unit=>unit.effect),['physical','buff','taunt']);
  assert.equal(damage.source,'physicalAttack');
  assert.deepEqual(damage.attributeWeights,{strength:10,dexterity:0,vitality:12,intelligence:0,mentality:0});
  assert.deepEqual(damage.ranks.map(rank=>rank.operation),[1350,1470,1590,1770,1830,1890,1950,2010]
    .map(ratePerThousand=>({kind:'multiply-thousandth',ratePerThousand})));
  assert.deepEqual(damage.ranks.map((_,index)=>actionDamage(damage,index+1,{physicalAttack:100,magicAttack:999,
    bestNormalDamage:999,maxHealth:1000,primaryAttributes:{strength:11,dexterity:0,vitality:17,intelligence:0,mentality:0}})),
    [176,192,208,231,239,247,255,263]);
  assert.deepEqual(buff.ranks.map(rank=>rank.strength),[1002,1004,1006,1009,1010,1011,1012,1013]);
  for(const [index,rank]of buff.ranks.entries()){
    assert.equal(rank.chanceThreshold,1000);
    assert.deepEqual(rank.effect.modifiers,[
      {attribute:'moveSpeed',operation:{kind:'decrease-thousandth',ratePerThousand:rates[index]}},
      {attribute:'attackSpeedRate',operation:{kind:'subtract',amount:rates[index]}},
    ]);
    assert.deepEqual(rank.effect.reactions,[{kind:'physical-success-threat'}]);
    assert.deepEqual(rank.effect.appearanceColors,[{red:0,green:100,blue:200}]);
    assert.deepEqual(rank.effect.states,[]);assert.deepEqual(rank.effect.periodic,[]);
    assert.equal(rank.effect.applicationEffect,undefined);assert.equal(rank.effect.loopEffects,undefined);
  }
});

test('Shouts of Threat keeps one frame-aged layer, rejects weaker sources and refreshes equal priority',()=>{
  for(const rank of buff.ranks){
    assert.equal(rank.effect.durationMs,5460);assert.equal(rank.effect.maxStacks,1);assert.equal(rank.effect.tickMs,0);
    assert.deepEqual(rank.effect.simulationFrames,{lastActiveFrame:90});
    const conditions=new CombatConditions();conditions.applyBuff('target','shouts-of-threat',rank.strength,rank.effect,'first');
    conditions.update(91*60);assert.equal(conditions.hasBuff('target','shouts-of-threat'),true);
    conditions.update(60);assert.equal(conditions.hasBuff('target','shouts-of-threat'),false);
  }
  const conditions=new CombatConditions(),strong=buff.ranks[5],weak=buff.ranks[0];
  conditions.applyBuff('target','shouts-of-threat',strong.strength,strong.effect,'first');conditions.update(60*30);
  assert.equal(conditions.applyBuff('target','shouts-of-threat',weak.strength,weak.effect,'weak'),false);
  assert.equal(conditions.applyBuff('target','shouts-of-threat',strong.strength,strong.effect,'second'),true);
  conditions.update(91*60);assert.equal(conditions.hasBuff('target','shouts-of-threat'),true);
  assert.equal(conditions.attribute('target','moveSpeed',100),62);
  conditions.update(60);assert.equal(conditions.hasBuff('target','shouts-of-threat'),false);
});

test('Shouts of Threat releases in place and keeps its ordered area dispatch and existing effects',()=>{
  assert.equal(action.requiresTarget,false);assert.equal(action.cooldownFrames,90);
  assert.deepEqual(skill.ranks.map(rank=>rank.manaCost),Array(8).fill(40));
  assert.equal(action.events.length,1);const event=action.events[0];assert.equal(event.kind,'units');
  if(event.kind!=='units')throw new Error('Shouts of Threat needs a Direct sequence');
  assert.equal(event.frame,2);
  assert.deepEqual(event.cues.map(cue=>[cue.target,cue.targetRangePx,cue.targetRangeMetric,cue.targetSelection]),[
    ['area',72,'octagonal-grid','search'],['area',72,'octagonal-grid','reuse-previous'],['area',72,'octagonal-grid','reuse-previous'],
  ]);
  assert.deepEqual(event.dispatch,{breaksStealth:true,casterEffects:[
    {effect:'curse-wind-ring',recipient:'caster',placement:'attached'},
    {effect:'curse-shockwave',recipient:'caster',placement:'attached'},
  ],shake:true,vibrationMs:150,sound:'A_Skill_05'});
  for(const effect of event.dispatch!.casterEffects!)assert.ok(battle.attackEffects[effect.effect]);
});
