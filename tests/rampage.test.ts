import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {resolveCueTargets,type Combatant} from '../src/domain/combat.ts';
import type {WardrobeCatalog} from '../src/domain/wardrobe.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const wardrobe=JSON.parse(readFileSync(new URL('../public/content/wardrobe.json',import.meta.url),'utf8')) as WardrobeCatalog;
const action=(growth:'action'|'companion')=>(growth==='action'?catalog.skills['rampage'].action:catalog.skills['rampage'].companion!.action)!;
const event=(growth:'action'|'companion')=>{
  const found=action(growth).events.find(entry=>entry.kind==='units')!;
  if(found.kind!=='units')throw new Error('units missing');
  return found;
};
const actor=(id:string,x:number,y=0,team='hostile'):Combatant=>({id,team,position:{x,y},bounds:{x:-4,y:-4,width:8,height:8}});

test('乱射的范围按整数八方向距离，主角佣兵与弩姿势一致',()=>{
  for(const growth of ['action','companion'] as const){
    assert.deepEqual(action(growth).combatUnits!.map(unit=>unit.effect),['physical','buff']);
    assert.equal(event(growth).frame,10);
    assert.deepEqual(event(growth).cues.map(cue=>[cue.target,cue.targetRangePx,cue.targetRangeMetric]),
      [['area',112,'octagonal-grid'],['self',112,undefined]]);
  }
  const crossbow=wardrobe.skillStances.ranger['crossbow:empty']!.actions.rampage as {events:{kind:string;cues:{target:string;targetRangeMetric?:string}[]}[]};
  const stance=crossbow.events.find(entry=>entry.kind==='units')!;
  assert.deepEqual(stance.cues.map(cue=>[cue.target,cue.targetRangeMetric]),[['area','octagonal-grid'],['self',undefined]]);
});

test('轴向 119 像素命中、120 排除，斜向按同一整数距离',()=>{
  const caster=actor('caster',0,0,'party');
  const targets=[actor('axis-in',119),actor('axis-out',120),actor('diagonal-in',86,86),actor('diagonal-out',87,87)];
  assert.deepEqual(resolveCueTargets(event('action').cues[0],caster,undefined,targets).map(target=>target.id),
    ['axis-in','diagonal-in']);
});
