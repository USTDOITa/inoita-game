import test from 'node:test';
import assert from 'node:assert/strict';
import {CombatCooldownStore,type CombatCooldownState} from '../src/domain/combat-cooldowns.ts';

test('cooldowns become ready at the absolute deadline and display only active records in milliseconds',()=>{
  let frame=100;
  const store=new CombatCooldownStore(()=>frame),actor=store.forActor('player');
  assert.equal(actor.isReady('strike'),true);
  actor.start('strike',90);
  assert.equal(actor.isReady('strike'),false);
  assert.deepEqual(actor.snapshot(),{strike:{remainingMs:5400,durationMs:5400}});
  frame=189;
  assert.equal(actor.isReady('strike'),false);
  assert.deepEqual(actor.snapshot(),{strike:{remainingMs:60,durationMs:5400}});
  frame=190;
  assert.equal(actor.isReady('strike'),true);
  assert.deepEqual(actor.snapshot(),{});
  frame=400;
  assert.equal(actor.isReady('strike'),true);
});

test('actors and skills share one externally published frame without advancing each other',()=>{
  let frame=7;
  const store=new CombatCooldownStore(()=>frame),player=store.forActor('player'),ally=store.forActor('ally');
  player.start('strike',10);ally.start('strike',10);player.start('shield',20);
  assert.deepEqual(player.snapshot().strike,ally.snapshot().strike);
  frame=17;
  assert.equal(ally.isReady('strike'),true);
  assert.equal(player.isReady('strike'),true);
  assert.equal(player.isReady('shield'),false);
  assert.deepEqual(store.forActor('player').snapshot(),{shield:{remainingMs:600,durationMs:1200}});
});

test('start replaces an existing deadline and a zero duration clears only the specified skill',()=>{
  let frame=10;
  const store=new CombatCooldownStore(()=>frame),actor=store.forActor('player');
  actor.start('strike',20);actor.start('shield',20);
  frame=15;actor.start('strike',3);
  assert.deepEqual(actor.snapshot().strike,{remainingMs:180,durationMs:180});
  actor.start('strike',0);
  assert.equal(actor.isReady('strike'),true);
  assert.deepEqual(actor.snapshot(),{shield:{remainingMs:900,durationMs:1200}});
});

test('duration applies the signed rate with a lower zero clamp and truncates the final frame result',()=>{
  const actor=new CombatCooldownStore(()=>30).forActor('player');
  for(const [rate,duration] of [[undefined,3],[500,1],[1999,5],[2500,7],[333.5,1],[-100,0],[0,0]] as const){
    actor.start('strike',3,rate);
    assert.deepEqual(actor.snapshot(),duration?{strike:{remainingMs:duration*60,durationMs:duration*60}}:{});
  }
  actor.start('strike',1,1999);
  assert.deepEqual(actor.snapshot(),{strike:{remainingMs:60,durationMs:60}});
  actor.start('strike',1,999);
  assert.equal(actor.isReady('strike'),true);
});

test('reset and removal affect one actor while existing bound ports follow the current store state',()=>{
  const store=new CombatCooldownStore(()=>0),player=store.forActor('player'),ally=store.forActor('ally');
  player.start('strike',20);player.start('shield',10);ally.start('strike',30);
  player.reset();
  assert.deepEqual(player.snapshot(),{});
  assert.deepEqual(ally.snapshot(),{strike:{remainingMs:1800,durationMs:1800}});
  player.start('strike',20);store.resetActor('player');
  assert.equal(player.isReady('strike'),true);
  player.start('strike',20);store.removeActor('player');
  assert.equal(player.isReady('strike'),true);
  store.forActor('player').start('strike',5);
  assert.deepEqual(player.snapshot(),{strike:{remainingMs:300,durationMs:300}});
  assert.equal(ally.isReady('strike'),false);
});

test('reads and clearing missing actors do not allocate cooldown records',()=>{
  const store=new CombatCooldownStore(()=>0),actor=store.forActor('unknown');
  assert.equal(actor.isReady('strike'),true);
  assert.deepEqual(actor.snapshot(),{});
  actor.reset();store.removeActor('absent');actor.start('strike',0);
  assert.deepEqual(store.captureState(),{actors:[]});
});

test('capture and restore copy every deadline and retain absolute time for already bound ports',()=>{
  let frame=10;
  const store=new CombatCooldownStore(()=>frame),actor=store.forActor('player');
  actor.start('strike',30);
  const saved=store.captureState();
  assert.deepEqual(saved,{actors:[['player',[['strike',{readyFrame:40,durationFrames:30}]]]]});
  saved.actors[0][1][0][1].readyFrame=999;
  assert.equal(store.captureState().actors[0][1][0][1].readyFrame,40);
  const restored:CombatCooldownState={actors:[['player',[['shield',{readyFrame:50,durationFrames:20}]]]]};
  frame=35;store.restoreState(restored);
  restored.actors[0][1][0][1].readyFrame=999;
  assert.equal(actor.isReady('strike'),true);
  assert.deepEqual(actor.snapshot(),{shield:{remainingMs:900,durationMs:1200}});
  const display=actor.snapshot();display.shield.remainingMs=999;
  assert.equal(actor.snapshot().shield.remainingMs,900);
  store.restoreState({actors:[]});
  assert.deepEqual(actor.snapshot(),{});
});

test('invalid frame inputs and nonfinite rates reject without replacing valid records',()=>{
  let frame=0;
  const store=new CombatCooldownStore(()=>frame),actor=store.forActor('player');
  actor.start('strike',10);
  for(const invalid of [-1,0.5,NaN,Infinity,-Infinity]){
    assert.throws(()=>actor.start('strike',invalid),RangeError);
    assert.throws(()=>store.restoreState({actors:[['player',[['strike',{readyFrame:invalid,durationFrames:10}]]]]}),RangeError);
    assert.throws(()=>store.restoreState({actors:[['player',[['strike',{readyFrame:10,durationFrames:invalid}]]]]}),RangeError);
    frame=invalid;
    assert.throws(()=>actor.isReady('strike'),RangeError);
    assert.throws(()=>actor.snapshot(),RangeError);
  }
  frame=0;
  for(const rate of [NaN,Infinity,-Infinity])assert.throws(()=>actor.start('strike',10,rate),RangeError);
  assert.deepEqual(actor.snapshot(),{strike:{remainingMs:600,durationMs:600}});
});

test('the GM no-cooldown switch keeps skills ready and writes no deadline',()=>{
  let frame=10;
  const store=new CombatCooldownStore(()=>frame),actor=store.forActor('player');
  store.setFree('player',true);
  assert.equal(store.isFree('player'),true);
  actor.start('strike',90);
  assert.equal(actor.isReady('strike'),true);
  assert.deepEqual(actor.snapshot(),{});
  assert.deepEqual(store.captureState(),{actors:[]},'调试开关不写存档');
  // 关闭后下一次施放才重新计时，不会冒出关闭前留下的截止帧。
  store.setFree('player',false);
  actor.start('strike',90);
  assert.equal(actor.isReady('strike'),false);
  assert.ok(actor.snapshot().strike);
});

test('resetActor keeps the GM switch while removeActor clears it',()=>{
  const store=new CombatCooldownStore(()=>0);
  store.setFree('player',true);
  store.resetActor('player');
  assert.equal(store.isFree('player'),true,'复活等流程不应该顺手关掉调试开关');
  store.removeActor('player');
  assert.equal(store.isFree('player'),false);
});

test('restoring a cooldown snapshot does not clear the GM switch',()=>{
  const store=new CombatCooldownStore(()=>0);
  store.setFree('player',true);
  const saved:CombatCooldownState={actors:[['player',[['strike',{readyFrame:90,durationFrames:90}]]]]};
  store.restoreState(saved);
  assert.equal(store.isFree('player'),true);
  assert.deepEqual(store.forActor('player').snapshot(),{});
  // 输入契约不因调试开关放宽。
  assert.throws(()=>store.forActor('player').start('strike',-1),RangeError);
});
