import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatClock} from '../src/domain/combat-clock.ts';

test('a long update and split updates publish the same shared frames and preserve the fractional remainder',()=>{
  const run=(deltas:number[])=>{
    const clock=new CombatClock(),observed:[number,number][]=[];
    for(const delta of deltas)clock.advance(delta,frame=>observed.push([frame,clock.currentFrame]));
    return {observed,state:clock.captureState()};
  };
  assert.deepEqual(run([239]),run([59,1,30,90,59]));
  assert.deepEqual(run([239]),{observed:[[1,1],[2,2],[3,3]],state:{frame:3,remainderMs:59}});
});

test('clock restore preserves the next shared boundary without retaining mutable snapshot references',()=>{
  const clock=new CombatClock();clock.advance(119,()=>{});
  const state=clock.captureState();clock.advance(600,()=>{});clock.restoreState(state);
  state.frame=100;state.remainderMs=0;
  const frames:number[]=[];clock.advance(1,frame=>frames.push(frame));
  assert.deepEqual(frames,[2]);assert.equal(clock.currentFrame,2);
  for(const delta of [0,-1,NaN,Infinity])clock.advance(delta,()=>assert.fail());
  assert.equal(clock.currentFrame,2);
  assert.throws(()=>clock.restoreState({frame:2,remainderMs:60}));
  assert.throws(()=>clock.restoreState({frame:-1,remainderMs:0}));
});

test('snapshots taken inside a long update describe the published frame without unprocessed future time',()=>{
  const clock=new CombatClock(),saved:ReturnType<CombatClock['captureState']>[]=[];
  clock.advance(239,()=>saved.push(clock.captureState()));
  assert.deepEqual(saved,[{frame:1,remainderMs:0},{frame:2,remainderMs:0},{frame:3,remainderMs:0}]);
  for(const state of saved){const restored=new CombatClock();restored.restoreState(state);assert.deepEqual(restored.captureState(),state);}
});
