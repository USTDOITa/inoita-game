import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {resolveCueTargets,type Combatant} from '../src/domain/combat.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const action=(growth:'action'|'companion')=>(growth==='action'?catalog.skills['spiritual-arrow'].action:catalog.skills['spiritual-arrow'].companion!.action)!;
const cues=(growth:'action'|'companion')=>{
  const event=action(growth).events.find(entry=>entry.kind==='units')!;
  if(event.kind!=='units')throw new Error('units missing');
  return event;
};
const actor=(id:string,x:number,y=0,team='hostile'):Combatant=>({id,team,position:{x,y},bounds:{x:-4,y:-4,width:8,height:8}});

test('追踪箭保留伤害、吸蓝与施法者自身的第三表现单元',()=>{
  for(const growth of ['action','companion'] as const){
    assert.deepEqual(action(growth).combatUnits!.map(unit=>unit.effect),['physical','drain','visual']);
    const cues0=cues(growth).cues;
    assert.equal(cues(growth).frame,10);
    assert.deepEqual(cues0.map(cue=>cue.target),['current','current','self']);
    assert.deepEqual(cues0.map(cue=>cue.targetSelection),['search','reuse-previous','search']);
    assert.deepEqual(cues0[2].effects,[{effect:'orb-blue',recipient:'target',placement:'attached'}]);
  }
});

test('自身的表现单元落在施法者身上，不跟随被吸蓝的敌人',()=>{
  const caster=actor('caster',0,0,'party'),enemy=actor('enemy',64);
  const cue=cues('action').cues[2];
  assert.deepEqual(resolveCueTargets(cue,caster,enemy,[caster,enemy],[]).map(target=>target.id),['caster']);
});
