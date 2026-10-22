import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import test from 'node:test';
import type {BattleBuffEffect,BattleCatalog} from '../src/domain/battle.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {ownerRateFrames,scaledBuffEffect,summonLifetimeFrames} from '../src/domain/summon-stats.ts';

const phaser=registerHooks({resolve(specifier,context,next){
  return specifier==='phaser'?{url:'data:text/javascript,export default {BlendModes:{},Scene:class{},Physics:{Arcade:{Body:class{}}}}',shortCircuit:true}:next(specifier,context);
}});
const {WorldCombat}=await import('../src/scenes/world-combat.ts');
phaser.deregister();
const method=(name:string)=>Reflect.get(WorldCombat.prototype,name);

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const passive=catalog.skills['spiritual-affinity'].passiveUnits![0] as {attribute:string;ranks:{kind:string;amount:number}[]};
const beast=catalog.skills['beast-companion'].action!.combatUnits![0] as {
  effect:string;lifetimeFromOwner:{attribute:string;perPoint:number;base:number}};
const nature=catalog.skills['spirit-of-nature'].action!.combatUnits![1] as {ranks:{effect:BattleBuffEffect}[]};
const rates=[300,500,700,900,1000,1100,1200,1300];

test('eight ranks feed one thousandth rate to both the beast and the nature spirit',()=>{
  assert.deepEqual(passive.ranks,rates.map(amount=>({kind:'add',amount})));
  // 两条链读的是同一个属性，只是各自换算；属性名对不上就会静默失效。
  assert.equal(beast.lifetimeFromOwner.attribute,passive.attribute);
  assert.deepEqual(beast.lifetimeFromOwner,{attribute:'summonDurationBonus',perPoint:150,base:150000});
  for(const rank of nature.ranks)assert.deepEqual(rank.effect.durationRateFromOwner,
    {attribute:'summonDurationBonus',baseFrames:90});
});

test('the beast chain rounds twice and the nature chain rounds once',()=>{
  // 兽：先把比例折进 150 的寿命输入，再乘 15/10 成帧。
  assert.equal(summonLifetimeFrames(beast.lifetimeFromOwner,0),225);
  assert.equal(summonLifetimeFrames(beast.lifetimeFromOwner,rates[0]!),292);
  assert.equal(summonLifetimeFrames(beast.lifetimeFromOwner,rates[7]!),517);
  // 自然之精灵：直接在上限帧上乘比例，只取整一次。
  assert.equal(ownerRateFrames(90,0),90);
  assert.equal(ownerRateFrames(90,rates[0]!),117);
  assert.equal(ownerRateFrames(90,rates[7]!),207);
  // 非整值：90×1297/1000=116.73 截断成 116；兽同值 194.55→194 再 ×1.5=291。
  assert.equal(ownerRateFrames(90,297),116);
  assert.equal(summonLifetimeFrames(beast.lifetimeFromOwner,297),291);
});

test('scaling copies the effect and leaves the shared content untouched',()=>{
  const effect=nature.ranks[0]!.effect,scaled=scaledBuffEffect(effect,rates[7]!);
  assert.deepEqual(scaled.modifiers,effect.modifiers);
  assert.equal(scaled.simulationFrames?.lastActiveFrame,207);
  assert.equal(scaled.durationMs,208*60);
  assert.equal(effect.simulationFrames?.lastActiveFrame,90,'原内容不被改写');
  const ruleless={...effect,durationRateFromOwner:undefined};
  assert.equal(scaledBuffEffect(ruleless,1300),ruleless,'没有换算规则的 Buff 原样返回');
});

test('the caster attribute decides the applied lifetime and its end frame',()=>{
  const effect=nature.ranks[0]!.effect,buff='spirit-of-nature' as const;
  const conditions=new CombatConditions();
  const host=Object.setPrototypeOf({arena:[],conditions,memberOf:()=>undefined,
    actorAttribute:(id:string,key:string)=>id==='ranger'&&key==='summonDurationBonus'?1300:0,
    applyStateConsequences:()=>{}},WorldCombat.prototype);
  method('applyActorBuff').call(host,'ally',buff,0,effect,'ranger');
  conditions.update(207*60);assert.equal(conditions.hasBuff('ally',buff),true);
  conditions.update(60);assert.equal(conditions.hasBuff('ally',buff),true);
  conditions.update(60);assert.equal(conditions.hasBuff('ally',buff),false);
  // 没学亲和精灵时回到 90 帧上限；别人的加成不影响，来源自己算。
  const plain=new CombatConditions();
  Object.assign(host,{conditions:plain,actorAttribute:()=>0});
  method('applyActorBuff').call(host,'ally',buff,0,effect,'ally');
  plain.update(90*60);assert.equal(plain.hasBuff('ally',buff),true);
  plain.update(60);assert.equal(plain.hasBuff('ally',buff),true);
  plain.update(60);assert.equal(plain.hasBuff('ally',buff),false);
});
