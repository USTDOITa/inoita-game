import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import test from 'node:test';
import type {BattleBuffEffect,BattleCatalog} from '../src/domain/battle.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';

const phaser=registerHooks({resolve(specifier,context,next){
  return specifier==='phaser'?{url:'data:text/javascript,export default {BlendModes:{},Scene:class{},Physics:{Arcade:{Body:class{}}}}',shortCircuit:true}:next(specifier,context);
}});
const {WorldCombat}=await import('../src/scenes/world-combat.ts');
phaser.deregister();
const method=(name:string)=>Reflect.get(WorldCombat.prototype,name);

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const skill=catalog.skills['celestial-armor'];
const unit=skill.action!.combatUnits![0] as {effect:'buff';buff:'celestial-armor';ranks:{strength:number;effect:BattleBuffEffect}[]};
const cue=skill.action!.events!.find(event=>event.kind==='units')!.cues![0];
const caps=[45,60,75,90,105,105,120,120];
const blueCycle=[140,160,180,200,180,160,140];

test('eight ranks carry the immunity state under the inclusive frame cap and keep the three-step colour cycle',()=>{
  assert.deepEqual(cue.effects,[{effect:'celestial-armor',recipient:'target',placement:'attached'}]);
  unit.ranks.forEach((rank,index)=>{
    const effect=rank.effect;
    assert.deepEqual(effect.states,['damage-immune'],`rank ${index+1}`);
    assert.equal(effect.simulationFrames?.lastActiveFrame,caps[index]);
    assert.equal(effect.durationMs,(caps[index]+1)*60);assert.equal(effect.maxStacks,1);
    assert.equal(effect.applicationEffect,undefined);assert.equal(effect.loopEffects,undefined);
    assert.deepEqual(effect.appearanceColors,blueCycle.map(blue=>({red:100,green:60,blue})));
  });
});

test('the armour blocks hostile damage without touching targeting, movement or friendly healing',()=>{
  const conditions=new CombatConditions();
  const member={player:{health:100},setHealth(value:number){this.player.health=value;}};
  const host={conditions,pendingDefeats:new Set(),fallen:new Set(),arena:[],hero:{level:10},
    memberOf:()=>member,readResourceCapacity:()=>500};
  conditions.applyBuff('ally','celestial-armor',3003,unit.ranks[0]!.effect,'caster');
  assert.equal(conditions.canReceiveDamage('ally'),false);
  assert.equal(conditions.canTarget('ally'),true);assert.equal(conditions.canMove('ally'),true);assert.equal(conditions.canAct('ally'),true);
  // 直接加血（AddLife 一路）不看免伤标记，友方治疗照常生效。
  method('restoreHealth').call(host,'ally',40);
  assert.equal(member.player.health,140);
});

test('the immunity expires with its buff after the inclusive last frame',()=>{
  const conditions=new CombatConditions();
  conditions.applyBuff('ally','celestial-armor',3003,unit.ranks[0]!.effect);
  conditions.update(45*60);
  assert.equal(conditions.hasState('ally','damage-immune'),true);
  conditions.update(60);
  assert.equal(conditions.canReceiveDamage('ally'),false);
  conditions.update(60);
  assert.equal(conditions.hasBuff('ally','celestial-armor'),false);
  assert.equal(conditions.hasState('ally','damage-immune'),false);
  assert.equal(conditions.canReceiveDamage('ally'),true);
});

test('a target with a shortening rule keeps the armour for the shortened lifetime only',()=>{
  const conditions=new CombatConditions();
  conditions.applyBuff('ally','celestial-armor',3003,unit.ranks[0]!.effect,'caster',
    state=>state==='damage-immune'?{lastActiveFrame:33}:false);
  assert.equal(conditions.canReceiveDamage('ally'),false);
  conditions.update(33*60);
  assert.equal(conditions.hasState('ally','damage-immune'),true);
  conditions.update(2*60);
  assert.equal(conditions.hasState('ally','damage-immune'),false);
});
