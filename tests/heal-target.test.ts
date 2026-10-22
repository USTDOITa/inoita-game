import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {healTargetScore,selectHealTarget,type HealCandidate,type HealSlot} from '../src/domain/heal-target.ts';
import {rectDistance} from '../src/domain/rect-distance.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const rates=[6315,6915,7815,9015,9315,9615,9915,10215];

test('the heal unit reads best normal damage plus mentality on the rank rate',()=>{
  const unit=catalog.skills['prayer-of-recovery'].action!.combatUnits![0];
  assert.equal(unit.effect,'heal');
  assert.equal((unit as {source:string}).source,'bestNormalDamage');
  assert.deepEqual((unit as {attributeWeights:unknown}).attributeWeights,
    {strength:0,dexterity:0,vitality:0,intelligence:0,mentality:10});
  assert.deepEqual((unit as {ranks:{operation:{ratePerThousand:number}}[]}).ranks.map(rank=>rank.operation.ratePerThousand),rates);
  const cue=catalog.skills['prayer-of-recovery'].action!.events.find(event=>event.kind==='units')!.cues[0];
  assert.equal(cue.target,'ally-heal');
  assert.equal(cue.targetRangePx,88);
});

const rect=(width=16,height=16)=>({x:-width/2,y:-height/2,width,height});
const actor=(id:string,x:number,extra:Partial<HealCandidate>={}):HealCandidate=>
  ({id,team:'party',position:{x,y:0},bounds:rect(),...extra});
const caster=actor('caster',0);

test('the score is the health percentage, raised by thirteen tenths for a character that dealt damage',()=>{
  assert.equal(healTargetScore(500,1000,false),50);
  assert.equal(healTargetScore(500,1000,true),65);
  assert.equal(healTargetScore(1,1000,false),0,'不足一个百分点截断为 0');
  assert.equal(healTargetScore(500,0,false),0,'最大生命为 0 时评分为 0');
  assert.equal(healTargetScore(1500,1000,false),150,'超过上限不截断');
});

const slots=(...entries:(HealSlot<HealCandidate>|undefined)[])=>entries;

test('the lowest score wins and an equal score keeps the earlier slot',()=>{
  const hurt=actor('hurt',16),full=actor('full',16);
  assert.equal(selectHealTarget(caster,slots(
    {actor:full,active:true,hasDisplay:true,score:100},
    {actor:hurt,active:true,hasDisplay:true,score:20}),11),hurt);
  const first=actor('first',16),second=actor('second',16);
  assert.equal(selectHealTarget(caster,slots(
    {actor:first,active:true,hasDisplay:true,score:40},
    {actor:second,active:true,hasDisplay:true,score:40}),11),first);
});

test('inactive, displayless, foreign and out-of-range slots are skipped',()=>{
  const candidates=slots(
    {actor:actor('inactive',16),active:false,hasDisplay:true,score:1},
    {actor:actor('displayless',16),active:true,hasDisplay:false,score:1},
    {actor:actor('foreign',16,{team:'hostile'}),active:true,hasDisplay:true,score:1},
    {actor:actor('far',16),active:true,hasDisplay:true,score:1});
  (candidates[3] as HealSlot<HealCandidate>).actor.position={x:200,y:0};
  assert.equal(selectHealTarget(caster,candidates,11),caster,'都被排除时回到施法者自己');
  const ok=actor('ok',40);
  assert.equal(selectHealTarget(caster,slots({actor:ok,active:true,hasDisplay:true,score:30},...candidates.slice(0,3) as []),11),ok);
});

test('the rectangular grid distance decides the range, with the plus two counted in grid units',()=>{
  // 16 宽的两人相距 95 像素时间隙 79，正好 9 格；9+2 等于范围 11。
  const edge=actor('edge',95);
  assert.equal(rectDistance(caster,edge),9);
  assert.equal(selectHealTarget(caster,slots({actor:edge,active:true,hasDisplay:true,score:1}),11),edge);
  // 间隙 80 像素是 10 格，10+2 超过 11。
  const far=actor('far',96);
  assert.equal(rectDistance(caster,far),10);
  assert.equal(selectHealTarget(caster,slots({actor:far,active:true,hasDisplay:true,score:1}),11),caster);
});

test('the pool is scanned past the three party slots, so a hurt summon can win',()=>{
  const first=actor('first',16),second=actor('second',16),third=actor('third',16),summon=actor('summon',16);
  const pool=slots(
    {actor:first,active:true,hasDisplay:true,score:90},
    {actor:second,active:true,hasDisplay:true,score:80},
    {actor:third,active:true,hasDisplay:true,score:70},
    {actor:summon,active:true,hasDisplay:true,score:5});
  assert.equal(selectHealTarget(caster,pool,11),summon);
  assert.equal(selectHealTarget(caster,pool.slice(0,3),11),third,'只给三槽时仍取槽内最低分');
});

test('a slot without a score never becomes the target',()=>{
  const unscored=actor('unscored',16);
  assert.equal(selectHealTarget(caster,slots({actor:unscored,active:true,hasDisplay:true}),11),caster);
});
