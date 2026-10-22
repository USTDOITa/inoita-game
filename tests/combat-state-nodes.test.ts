import assert from 'node:assert/strict';
import test from 'node:test';
import type {BattleBuffEffect} from '../src/domain/battle.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';

const effect=(age=30,states:BattleBuffEffect['states']=['stun']):BattleBuffEffect=>({
  durationMs:(age+1)*60,tickMs:0,simulationFrames:{lastActiveFrame:age},states,periodic:[],
  modifiers:[{attribute:'physicalAttack',operation:{kind:'add',amount:7}}],
});
const state=(conditions:CombatConditions,actor='target')=>conditions.snapshot(actor).find(entry=>entry.kind==='state');

test('successful same-name refresh replaces one node and leaves its previous mother buff active',()=>{
  const conditions=new CombatConditions();
  conditions.applyBuff('target','attack-stun',1,effect(),'first',()=>({lastActiveFrame:22}));
  conditions.update(125);
  assert.equal(conditions.applyStateFrames('target','stun',2,'second'),true);
  assert.equal(conditions.snapshot('target').filter(entry=>entry.kind==='state').length,1);
  assert.equal(state(conditions)?.sourceId,'second');assert.equal(state(conditions)?.ownerBuff,undefined);
  assert.equal(state(conditions)?.remainingMs,235);
  assert.equal(conditions.hasBuff('target','attack-stun'),true);
  assert.equal(conditions.attribute('target','physicalAttack',100),107);
  conditions.update(235);
  assert.equal(conditions.hasState('target','stun'),false);
  assert.equal(conditions.hasBuff('target','attack-stun'),true);
});

test('accepted buffs decide each state after mounting and rejected states rebind the existing node without resetting it',()=>{
  const conditions=new CombatConditions();
  conditions.applyStateFrames('target','stun',22,'old-source');conditions.update(125);
  const before=state(conditions)!;const seen:string[]=[];
  assert.equal(conditions.applyBuff('target','attack-stun',5,effect(30,['stun','sleep']),'new-source',id=>{
    seen.push(id);
    assert.equal(conditions.hasBuff('target','attack-stun'),true);
    assert.equal(conditions.attribute('target','physicalAttack',100),107);
    return id==='stun'?false:{lastActiveFrame:3};
  }),true);
  assert.deepEqual(seen,['stun','sleep']);
  const rebound=conditions.snapshot('target').find(entry=>entry.id==='stun')!;
  assert.deepEqual(rebound,{...before,ownerBuff:'attack-stun'});
  assert.equal(conditions.snapshot('target').find(entry=>entry.id==='sleep')?.sourceId,'new-source');
  const saved=conditions.captureState();
  assert.equal(conditions.applyBuff('target','attack-stun',4,effect(),'weak',()=>assert.fail('weak buffs never initialize states')),false);
  assert.deepEqual(conditions.captureState(),saved);
});

test('state rejection without an old node keeps the buff and its non-state effects',()=>{
  const conditions=new CombatConditions();
  assert.equal(conditions.applyBuff('target','attack-stun',1,effect(),'caster',()=>false),true);
  assert.equal(conditions.hasState('target','stun'),false);
  assert.equal(conditions.attribute('target','physicalAttack',100),107);
  conditions.applyBuff('ordinary','attack-stun',1,{...effect(),stateDurationProfiles:{stun:{normal:{lastActiveFrame:22}}}});
  assert.equal(state(conditions,'ordinary')?.remainingMs,1440);
});

test('short state age expires independently while a longer state is removed when its mother buff expires',()=>{
  for(const [stateAge,firstExpiry,remainingBuff] of [[22,1440,true],[45,1920,false]] as const){
    const conditions=new CombatConditions();
    conditions.applyBuff('target','attack-stun',1,effect(30),'caster',()=>({lastActiveFrame:stateAge}));
    assert.equal(state(conditions)?.remainingMs,(stateAge+2)*60);
    conditions.update(firstExpiry-1);assert.equal(conditions.hasState('target','stun'),true);
    conditions.update(1);assert.equal(conditions.hasState('target','stun'),false);
    assert.equal(conditions.hasBuff('target','attack-stun'),remainingBuff);
    assert.equal(conditions.attribute('target','physicalAttack',100),remainingBuff?107:100);
  }
});

test('buff expiry removes its declared current state even when another buff owns the replacement',()=>{
  const conditions=new CombatConditions();
  conditions.applyBuff('target','attack-stun',1,effect(0),'first',()=>({lastActiveFrame:45}));
  conditions.applyBuff('target','critical-hit-stun',1,effect(30),'second',()=>({lastActiveFrame:45}));
  assert.equal(state(conditions)?.ownerBuff,'critical-hit-stun');
  conditions.update(120);
  assert.equal(conditions.hasState('target','stun'),false);
  assert.equal(conditions.hasBuff('target','attack-stun'),false);
  assert.equal(conditions.hasBuff('target','critical-hit-stun'),true);
  assert.equal(conditions.attribute('target','physicalAttack',100),107);
});

test('explicit removal follows the current owner while direct removal leaves older mothers in place',()=>{
  const conditions=new CombatConditions();
  conditions.applyBuff('target','attack-stun',1,effect(),'first',()=>({lastActiveFrame:22}));
  conditions.applyBuff('target','critical-hit-stun',1,effect(),'second',()=>({lastActiveFrame:22}));
  conditions.removeState('target','stun','first');assert.equal(conditions.hasState('target','stun'),true);
  conditions.removeState('target','stun');
  assert.equal(conditions.hasBuff('target','critical-hit-stun'),false);
  assert.equal(conditions.hasBuff('target','attack-stun'),true);
  conditions.applyStateFrames('target','stun',22,'third');
  conditions.removeState('target','stun');assert.equal(conditions.hasBuff('target','attack-stun'),true);
  assert.equal(conditions.hasState('target','stun'),false);
});

test('the shared 128-node capacity includes every actor and timing mode and frees a replaced node before allocation',()=>{
  const conditions=new CombatConditions();
  for(let index=0;index<64;index++){
    assert.equal(conditions.applyStateFrames(String(index),'stun',1000,'first'),true);
    assert.equal(conditions.applyState(String(index),'sleep',10000,'first'),true);
  }
  assert.equal(conditions.applyStateFrames('overflow','stun',10),false);
  assert.equal(conditions.applyState('overflow','sleep',10000),false);
  assert.equal(conditions.applyStateFrames('0','stun',1000,'refreshed'),true);
  assert.equal(conditions.snapshot('0').find(entry=>entry.id==='stun')?.sourceId,'refreshed');
  assert.equal(conditions.applyBuff('overflow','attack-stun',1,effect(),'caster',()=>({lastActiveFrame:22})),true);
  assert.equal(conditions.hasState('overflow','stun'),false);
  assert.equal(conditions.hasBuff('overflow','attack-stun'),true);
  const restored=new CombatConditions();restored.restoreState(conditions.captureState());
  assert.equal(restored.applyStateFrames('overflow','stun',10),false);
  conditions.removeState('0','sleep');
  assert.equal(conditions.applyStateFrames('overflow','stun',0),true);
  conditions.update(120);
  assert.equal(conditions.applyState('new','sleep',10000),true);
  conditions.remove('1');assert.equal(conditions.applyStateFrames('new','stun',10),true);
});
