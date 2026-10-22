import test from 'node:test';
import assert from 'node:assert/strict';
import {AttackProcExecutor,type AttackProcChanceKey,type AttackProcPort} from '../src/domain/attack-proc.ts';

const keys:AttackProcChanceKey[]=['windStrikeChance','fireSplashChance','frostStrikeChance',
  'divineStrikeChance','darknessStrikeChance','poisonStrikeChance'];
function fixture(chances:Partial<Record<AttackProcChanceKey,number>>={}) {
  const events:string[]=[];
  const port:AttackProcPort={
    readChance(key){events.push(`read:${key}`);return chances[key]??0;},
    random(){events.push('roll');return 0;},
    applyDamage(amount){events.push(`damage:${amount}`);},
    applyBuff(key){events.push(`buff:${key}`);},
    fireSplash(amount){events.push(`fire:${amount}`);return 1;},
  };
  return {events,port};
}
const allChances=()=>Object.fromEntries(keys.map(key=>[key,1000])) as Record<AttackProcChanceKey,number>;
const effects=(events:string[])=>events.filter(value=>!value.startsWith('read:')&&value!=='roll');

test('six stages settle damage and child buffs in order, with poison applying only its buff',()=>{
  const {events,port}=fixture(allChances());
  assert.deepEqual(new AttackProcExecutor().execute(17,port),{status:'completed',stagesExecuted:6});
  assert.deepEqual(effects(events),['damage:11','buff:attack-stun','fire:8','damage:11','buff:attack-slow',
    'damage:11','buff:divine-defense-break','damage:51','buff:darkness-strike-impact','buff:poisoned']);
  assert.deepEqual(events.filter(value=>value.startsWith('read:')),keys.map(key=>`read:${key}`));
  assert.equal(events.filter(value=>value==='roll').length,6);
});

test('nonpositive thresholds skip randomness; positive thresholds consume a strict 1..999 roll',()=>{
  for(const [chance,roll,success,draws] of [[-2,0,false,0],[0,0,false,0],[1,0,false,1],[2,0,true,1],
    [999,998/999,false,1],[1000,998/999,true,1]] as const){
    const {events,port}=fixture({poisonStrikeChance:chance});
    let count=0;port.random=()=>{count++;return roll;};
    new AttackProcExecutor().execute(17,port);
    assert.equal(count,draws,`chance ${chance}`);
    assert.equal(events.includes('buff:poisoned'),success,`chance ${chance}`);
  }
});

test('successful zero damage retains child buffs and fire collection',()=>{
  const {events,port}=fixture(allChances());
  new AttackProcExecutor().execute(0,port);
  assert.deepEqual(effects(events),['damage:0','buff:attack-stun','fire:0','damage:0','buff:attack-slow',
    'damage:0','buff:divine-defense-break','damage:0','buff:darkness-strike-impact','buff:poisoned']);
});

test('entry damage stays captured while subsequent stage chances see completed callback mutations',()=>{
  let normalDamage=17;
  const chances:Partial<Record<AttackProcChanceKey,number>>={windStrikeChance:1000};
  const {events,port}=fixture(chances);
  const applyDamage=port.applyDamage;
  port.applyDamage=amount=>{applyDamage(amount);normalDamage=1000;chances.frostStrikeChance=1000;};
  new AttackProcExecutor().execute(normalDamage,port);
  assert.equal(normalDamage,1000);
  assert.deepEqual(effects(events),['damage:11','buff:attack-stun','damage:11','buff:attack-slow']);
});

test('feedback and state randomness from callbacks occurs before the next stage roll',()=>{
  const {events,port}=fixture({windStrikeChance:1000,frostStrikeChance:500});
  const rolls=[0,.9,.1];
  port.random=()=>{const value=rolls.shift();assert.notEqual(value,undefined);events.push(`roll:${value}`);return value!;};
  const applyDamage=port.applyDamage;
  port.applyDamage=amount=>{applyDamage(amount);if(events.filter(value=>value.startsWith('damage:')).length===1)port.random!();};
  new AttackProcExecutor().execute(17,port);
  assert.deepEqual(events.slice(0,8),['read:windStrikeChance','roll:0','damage:11','roll:0.9','buff:attack-stun',
    'read:fireSplashChance','read:frostStrikeChance','roll:0.1']);
  assert.ok(events.includes('buff:attack-slow'));
  assert.deepEqual(rolls,[]);
});

test('fire collection count chooses the next stage, including skipped branches and the 16 target limit',()=>{
  for(const count of [1,2,3,4,5,6,16]){
    const {events,port}=fixture(allChances());
    port.fireSplash=amount=>{events.push(`fire:${amount}`);return count;};
    const result=new AttackProcExecutor().execute(17,port);
    assert.equal(result.status,'completed');
    assert.deepEqual(events.filter(value=>value.startsWith('read:')),
      [...keys.slice(0,2),...keys.slice(count+1)].map(key=>`read:${key}`),`count ${count}`);
  }
});

test('an empty splash rereads its chance and rerolls before later stages, even when rounded damage is zero',()=>{
  const {events,port}=fixture({fireSplashChance:56});
  const rolls=[0,998/999];
  port.random=()=>rolls.shift()!;
  port.fireSplash=amount=>{events.push(`fire:${amount}`);return 0;};
  assert.deepEqual(new AttackProcExecutor().execute(1,port),{status:'completed',stagesExecuted:7});
  assert.deepEqual(events.filter(value=>value.startsWith('read:')),
    [keys[0],keys[1],keys[1],...keys.slice(2)].map(key=>`read:${key}`));
  assert.deepEqual(effects(events),['fire:0']);
  assert.deepEqual(rolls,[]);
});

test('empty splash callbacks can change the next chance instead of triggering a premature shortcut',()=>{
  const chances={fireSplashChance:1000};
  const {events,port}=fixture(chances);
  port.fireSplash=()=>{chances.fireSplashChance=0;return 0;};
  assert.equal(new AttackProcExecutor().execute(17,port).status,'completed');
  assert.equal(events.filter(value=>value==='roll').length,1);
  assert.equal(events.filter(value=>value==='read:fireSplashChance').length,2);
});

test('a permanently successful empty splash ends at the explicit 4096 stage adaptation budget',()=>{
  const {events,port}=fixture({fireSplashChance:1000});
  let splashes=0;port.fireSplash=()=>{splashes++;return 0;};
  assert.deepEqual(new AttackProcExecutor().execute(17,port),{status:'budget-exhausted',stagesExecuted:4096});
  assert.equal(splashes,4095);
  assert.equal(events.filter(value=>value==='roll').length,4095);
  assert.ok(!events.includes('read:frostStrikeChance'));
});

test('one executor rejects synchronous reentry and recovers after a callback throws',()=>{
  const executor=new AttackProcExecutor(),{events,port}=fixture({windStrikeChance:1000});
  port.applyDamage=()=>assert.deepEqual(executor.execute(17,port),{status:'reentrant',stagesExecuted:0});
  assert.equal(executor.execute(17,port).status,'completed');
  assert.equal(events.filter(value=>value==='buff:attack-stun').length,1);
  port.applyBuff=()=>{throw new Error('host failure');};
  assert.throws(()=>executor.execute(17,port),/host failure/);
  const next=fixture({poisonStrikeChance:1000});
  assert.equal(executor.execute(17,next.port).status,'completed');
  assert.ok(next.events.includes('buff:poisoned'));
});
