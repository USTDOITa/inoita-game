import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleBuffEffect,BattleCatalog} from '../src/domain/battle.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {resolveCueTargets} from '../src/domain/combat.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const skill=catalog.skills['blood-curse'];
const unit=skill.action!.combatUnits!.find(unit=>unit.effect==='buff')!;
if(unit.effect!=='buff')throw new Error('missing blood curse buff');
const cues=skill.action!.events!.find(event=>event.kind==='units')!.cues!;
const caps=[90,120,150,195,210,225,240,255];
const curseRates=[230,250,270,300,310,320,330,340];

test('eight ranks run on the frame clock with a single layer and a thirty frame pulse',()=>{
  assert.equal(unit.buff,'blood-curse');
  unit.ranks.forEach((rank,index)=>{
    const effect=rank.effect;
    assert.equal(rank.chanceThreshold,1000,'没有普通命中检定');
    assert.deepEqual(effect.simulationFrames,{lastActiveFrame:caps[index],pulseIntervalFrames:30},`rank ${index+1}`);
    assert.equal(effect.durationMs,(caps[index]!+1)*60);
    assert.equal(effect.tickMs,30*60);
    assert.equal(effect.maxStacks,1);
    const tick=effect.periodic.find(tick=>tick.kind==='magic-curse');
    assert.equal(tick?.kind==='magic-curse'&&tick.ratePerThousand,curseRates[index],`rank ${index+1}`);
  });
});

test('the curse slows movement, damages on every pulse and ends on its inclusive last frame',()=>{
  const conditions=new CombatConditions();
  const effect=unit.ranks[7]!.effect;
  assert.deepEqual(effect.modifiers,[{attribute:'moveSpeed',operation:{kind:'multiply-thousandth',ratePerThousand:300}}]);
  assert.equal(conditions.attribute('hero','moveSpeed',1000),1000);
  conditions.applyBuff('target','blood-curse',unit.ranks[7]!.strength,effect,'caster');
  assert.equal(conditions.attribute('target','moveSpeed',1000),300);
  // 年龄 0 就跳一次，之后每 30 帧一次；上限是含端点的第 255 帧。
  const pulses:number[]=[];let at=0;
  for(let frame=0;frame<255;frame++){
    at+=60;conditions.update(60,tick=>{if(tick.effect.kind==='magic-curse')pulses.push(at);});
  }
  assert.equal(pulses.length,9,'第 0 帧与每 30 帧各一次');
  assert.deepEqual(pulses.slice(0,3),[60,1860,3660]);
  assert.equal(conditions.hasBuff('target','blood-curse'),true);
  conditions.update(60);assert.equal(conditions.hasBuff('target','blood-curse'),true);
  conditions.update(60);
  assert.equal(conditions.hasBuff('target','blood-curse'),false);
  assert.equal(conditions.attribute('target','moveSpeed',1000),1000,'到期后减速一起消失');
});

test('the pulse heals its caster before the target takes the same amount',()=>{
  const conditions=new CombatConditions(),events:string[]=[];
  conditions.applyBuff('ally','blood-curse',unit.ranks[0]!.strength,unit.ranks[0]!.effect,'caster');
  conditions.update(60,tick=>events.push(tick.effect.kind));
  assert.deepEqual(events,['magic-curse','visual']);
});

test('the cast is a self-centred area with the application and pulse visuals kept apart',()=>{
  assert.deepEqual(cues.map(cue=>[cue.target,cue.targetRangePx]),[['area',88]]);
  assert.deepEqual(cues[0]!.effects.map(effect=>effect.effect),['ember-sparks']);
  const pulse=unit.ranks[0]!.effect.periodic.find(tick=>tick.kind==='visual');
  assert.equal(pulse?.kind==='visual'&&pulse.effect,'blood-curse-pulse');
});

test('a stronger rank replaces a weaker curse and a weaker one is refused',()=>{
  const conditions=new CombatConditions();
  const apply=(rank:number)=>conditions.applyBuff('target','blood-curse',unit.ranks[rank]!.strength,
    unit.ranks[rank]!.effect as BattleBuffEffect,'caster');
  assert.equal(apply(0),true);
  assert.equal(conditions.snapshot('target')[0]!.strength,unit.ranks[0]!.strength);
  assert.equal(apply(3),true);
  assert.equal(conditions.snapshot('target')[0]!.strength,unit.ranks[3]!.strength);
  assert.equal(apply(0),false,'弱等级被拒');
  assert.equal(conditions.snapshot('target')[0]!.strength,unit.ranks[3]!.strength);
});

test('空场可施放，范围按整数八方向距离取敌',()=>{
  assert.equal(skill.action!.requiresTarget,false,'动作行 +2 的低字节 3 是范围搜索，不需要先选敌人');
  assert.deepEqual(cues.map(cue=>[cue.target,cue.targetRangeMetric]),[['area','octagonal-grid']]);
  const caster={id:'caster',team:'party',position:{x:0,y:0},bounds:{x:-4,y:-4,width:8,height:8}};
  const enemy=(id:string,x:number)=>({id,team:'hostile',position:{x,y:0},bounds:{x:-4,y:-4,width:8,height:8}});
  const inside=enemy('inside',95),outside=enemy('outside',96);
  assert.deepEqual(resolveCueTargets(cues[0],caster,undefined,[caster,inside,outside]).map(target=>target.id),
    ['inside'],'轴向 95 像素命中、96 像素排除');
});
