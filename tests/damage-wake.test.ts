import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import test from 'node:test';
import {CombatConditions} from '../src/domain/combat-conditions.ts';

const phaser=registerHooks({resolve(specifier,context,next){
  return specifier==='phaser'?{url:'data:text/javascript,export default {BlendModes:{},Scene:class{},Physics:{Arcade:{Body:class{}}}}',shortCircuit:true}:next(specifier,context);
}});
const {WorldCombat}=await import('../src/scenes/world-combat.ts');phaser.deregister();

test('periodic and reflected direct damage wake sleeping targets only when damage is accepted',()=>{
  const conditions=new CombatConditions();
  const member={player:{health:100},setHealth(value:number){this.player.health=value;}};
  let shown=0;
  const host={readResourceCapacity:()=>100,conditions,pendingDefeats:new Set(),memberOf:()=>member,showHit:()=>shown++};
  const settle=Reflect.get(WorldCombat.prototype,'settleHit');
  const sleep=()=>conditions.applyBuff('target','monster-sleep',1,{durationMs:5000,tickMs:0,
    modifiers:[],states:['sleep'],periodic:[]},'caster');
  for(const presentation of [{periodic:true},{}]){
    sleep();settle.call(host,{casterId:'source',targetId:'target'},{kind:'hit',damage:1},{},undefined,presentation);
    assert.equal(conditions.hasState('target','sleep'),false);
    assert.equal(conditions.hasBuff('target','monster-sleep'),false);
  }
  assert.equal(member.player.health,98);assert.equal(shown,2);
  sleep();conditions.applyState('target','damage-immune',5000);
  settle.call(host,{casterId:'source',targetId:'target'},{kind:'hit',damage:1},{},undefined,{periodic:true});
  assert.equal(conditions.hasState('target','sleep'),true);
  assert.equal(member.player.health,98);assert.equal(shown,2);
  conditions.removeState('target','damage-immune');
  settle.call(host,{casterId:'source',targetId:'target'},{kind:'hit',damage:0},{},undefined,{periodic:true});
  assert.equal(conditions.hasState('target','sleep'),true);
});
