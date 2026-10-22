import assert from 'node:assert/strict';
import test from 'node:test';
import {SavedGameLoader,type SavedGameLoadPort} from '../src/application/saved-game-loader.ts';
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};}

test('candidate installation waits for every old-scene cleanup before binding the new lifetime',async()=>{
  const loader=new SavedGameLoader(),events:string[]=[],stopped=deferred<void>(),source=new AbortController();let lifetime:AbortSignal|undefined;
  const port:SavedGameLoadPort<string>={prepare:async()=>{events.push('prepare');return 'saved';},isCurrent:()=>true,
    stopCurrent:async()=>{events.push('shutdown');source.abort();await stopped.promise;events.push('cleanup');},
    install:(candidate,request)=>{assert.equal(candidate,'saved');lifetime=request.signal;events.push('install');}};
  const loading=loader.load(2,port,source.signal);await new Promise<void>(resolve=>setImmediate(resolve));assert.deepEqual(events,['prepare','shutdown']);
  assert.equal(loader.busy,true);stopped.resolve();await loading;
  assert.deepEqual(events,['prepare','shutdown','cleanup','install']);assert.equal(lifetime?.aborted,false);assert.equal(loader.busy,false);
});

test('a rejected candidate never stops or mutates the current game',async()=>{
  const loader=new SavedGameLoader();let stopped=false,installed=false;
  await assert.rejects(loader.load(0,{prepare:async()=>{throw new Error('broken save');},isCurrent:()=>true,
    stopCurrent:async()=>{stopped=true;},install:()=>{installed=true;}}),/broken save/);
  assert.equal(stopped,false);assert.equal(installed,false);assert.equal(loader.busy,false);
});

test('closing the entry discards late preparation, including a producer that ignores abort',async()=>{
  for(const cancelled of ['caller','loader','origin'] as const){
    const loader=new SavedGameLoader(),source=new AbortController(),candidate=deferred<string>();let installed=false,current=true;
    const loading=loader.load(0,{prepare:async()=>candidate.promise,isCurrent:()=>current,
      stopCurrent:async()=>assert.fail('stale request cannot stop the scene'),install:()=>{installed=true;}},source.signal);
    if(cancelled==='caller')source.abort();else if(cancelled==='loader')loader.cancel();else current=false;
    candidate.resolve('late');await assert.rejects(loading,{name:'AbortError'});assert.equal(installed,false);
  }
});

test('a second load is rejected while preparation is active',async()=>{
  const loader=new SavedGameLoader(),candidate=deferred<string>();
  const port:SavedGameLoadPort<string>={prepare:async()=>candidate.promise,isCurrent:()=>true,stopCurrent:async()=>{},install:()=>{}};
  const first=loader.load(0,port);await assert.rejects(loader.load(1,port),/正在读取存档/);
  candidate.resolve('saved');await first;
});

test('an old cancelled request cannot clear a newer active request',async()=>{
  const loader=new SavedGameLoader(),old=deferred<string>(),fresh=deferred<string>();let installs=0;
  const port:SavedGameLoadPort<string>={prepare:async slot=>slot===0?old.promise:fresh.promise,isCurrent:()=>true,stopCurrent:async()=>{},install:()=>installs++};
  const first=loader.load(0,port);loader.cancel();const second=loader.load(1,port);
  old.resolve('old');await assert.rejects(first,{name:'AbortError'});assert.equal(loader.busy,true);
  fresh.resolve('fresh');await second;assert.equal(installs,1);assert.equal(loader.busy,false);
});

test('a late network failure after cancellation remains a cancellation result',async()=>{
  const loader=new SavedGameLoader(),source=new AbortController();let fail!:(error:Error)=>void;
  const loading=loader.load(0,{prepare:async()=>new Promise<void>((_done,reject)=>fail=reject),isCurrent:()=>true,
    stopCurrent:async()=>assert.fail('cancelled preparation cannot stop the scene'),install:()=>assert.fail('cancelled preparation cannot install')},source.signal);
  source.abort();fail(new Error('late network error'));await assert.rejects(loading,{name:'AbortError'});
});

test('cancellation immediately releases the entry even when preparation has not settled',{timeout:1000},async()=>{
  const loader=new SavedGameLoader(),source=new AbortController(),candidate=deferred<string>();let installs=0;
  const loading=loader.load(0,{prepare:async()=>candidate.promise,isCurrent:()=>true,stopCurrent:async()=>{},install:()=>installs++},source.signal);
  source.abort();await assert.rejects(loading,{name:'AbortError'});assert.equal(loader.busy,false);
  candidate.resolve('late');await Promise.resolve();assert.equal(installs,0);
});
