import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import test from 'node:test';
import type {CombatActorAttributes} from '../src/domain/combat-damage-source.ts';
import type {PeriodicTick} from '../src/domain/combat-conditions.ts';
const hooks=registerHooks({resolve(specifier,context,next){return specifier==='phaser'?
  {url:'data:text/javascript,export default {BlendModes:{},Scene:class{},Physics:{Arcade:{Body:class{}}}}',shortCircuit:true}:next(specifier,context);}});
const {WorldCombat}=await import('../src/scenes/world-combat.ts');
hooks.deregister();
const periodic=Reflect.get(WorldCombat.prototype,'periodicTick');
const attributes:CombatActorAttributes={physicalAttack:100,magicAttack:80,maxHealth:1000,physicalDamageRate:500,
  magicDamageRate:1000,stealthDamageRate:0,primaryAttributes:{strength:0,dexterity:0,vitality:0,intelligence:20,mentality:25}};
function fixture(classId='warlock'){
  const commands:unknown[]=[];
  const host={pendingDefeats:new Set(),arena:[],hero:{},activeParty:['source','ally'],
    actorAttributes:(id:string)=>id==='source'?attributes:undefined,
    actorAttribute:(id:string,key:string):number=>key==='healingPowerRate'?id==='target'?500:1000:key==='lifeFeastRate'?0:160,
    activePartySlots:()=>['source','ally'],
    memberOf:(id:string)=>id==='source'?{classId}:undefined,
    restoreHealth:(id:string,amount:number)=>commands.push(['heal',id,amount]),
    settleHit:(_event:unknown,hit:{damage:number})=>commands.push(['damage',hit.damage]),
    presenter:{showEffects:(id:string,effects:unknown)=>commands.push(['visual',id,effects])}};
  const run=(effect:PeriodicTick['effect'],buffId:PeriodicTick['buffId']='blood-curse',stackCount=1)=>periodic.call(host,{sourceId:'source',targetId:'target',buffId,stackCount,effect});
  return {host,commands,run};
}
test('periodic curse heals its own source before damaging and applies stack operands',()=>{
  const {commands,run}=fixture();
  run({kind:'magic-curse',ratePerThousand:200},'blood-curse',2);
  assert.deepEqual(commands,[['heal','source',52],['damage',52]]);
});
test('periodic normal damage chooses the source class instead of party membership',()=>{
  for(const [classId,expected] of [['warlock',160],['priest',160],['dark-knight',150]] as const){
    const {commands,run}=fixture(classId);run({kind:'normal-damage',operation:{kind:'keep'}});
    assert.deepEqual(commands,[['damage',expected]]);
  }
});
test('light command reads the recipient healing rate and caster mentality',()=>{
  const {commands,run}=fixture();
  run({kind:'healing',attribute:'bestNormalDamage',operation:{kind:'multiply-thousandth',ratePerThousand:500}},'light-command');
  assert.deepEqual(commands,[['heal','target',41]]);
});
test('source-independent visuals continue when the source actor is no longer available',()=>{
  const {host,commands,run}=fixture();host.actorAttributes=()=>undefined;
  run({kind:'visual',effect:'life-drain'});
  run({kind:'magic-curse',ratePerThousand:100});
  assert.equal(commands.length,1);assert.equal((commands[0] as string[])[0],'visual');
});

test('periodic healing multiplies a zero recipient rate instead of skipping it like ordinary healing',()=>{
  const {host,commands,run}=fixture();
  host.actorAttribute=(_id:string,key:string)=>key==='healingPowerRate'?0:160;
  run({kind:'healing',attribute:'bestNormalDamage',operation:{kind:'keep'}},'fire-offering');
  assert.deepEqual(commands,[]);
});
