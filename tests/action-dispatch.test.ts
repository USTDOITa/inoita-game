import assert from 'node:assert/strict';
import test from 'node:test';
import { runActionDispatch } from '../src/domain/action-dispatch.ts';
import { CombatHitResolution } from '../src/domain/combat-hit-resolution.ts';

test('all direct targets and caster feedback finish while entry stealth remains active',()=>{
  const order:string[]=[];
  let stealthed=true;
  runActionDispatch(true,{
    isStealthed:()=>stealthed,
    work(){
      for(const target of ['first','second']){
        assert.equal(stealthed,true);
        order.push(`damage:${target}`);
      }
      order.push('caster-effects','shake','vibration');
    },
    removeStealth(){stealthed=false;order.push('remove-stealth');},
    afterStealthBreak(){assert.equal(stealthed,false);order.push('reaction');},
    sound:()=>order.push('sound'),
  });
  assert.deepEqual(order,[
    'damage:first','damage:second','caster-effects','shake','vibration',
    'remove-stealth','reaction','sound',
  ]);
});

test('a visible caster keeps stealth gained during the dispatch',()=>{
  let stealthed=false;
  const order:string[]=[];
  runActionDispatch(true,{
    isStealthed:()=>stealthed,
    work(){stealthed=true;},
    removeStealth(){stealthed=false;order.push('remove');},
    afterStealthBreak:()=>order.push('reaction'),
    sound:()=>order.push('sound'),
  });
  assert.equal(stealthed,true);
  assert.deepEqual(order,['sound']);
});

for(const duringWork of ['refresh','remove'] as const){
  test(`entry stealth still triggers the tail after work performs a ${duringWork}`,()=>{
    let stealthed=true;
    let reads=0;
    const order:string[]=[];
    runActionDispatch(true,{
      isStealthed(){reads++;return stealthed;},
      work(){stealthed=duringWork==='refresh';order.push(duringWork);},
      removeStealth(){stealthed=false;order.push('tail-remove');},
      afterStealthBreak:()=>order.push('reaction'),
    });
    assert.equal(reads,1);
    assert.equal(stealthed,false);
    assert.deepEqual(order,[duringWork,'tail-remove','reaction']);
  });
}

test('a nonbreaking dispatch keeps stealth and still runs its work and sound',()=>{
  const order:string[]=[];
  runActionDispatch(false,{
    isStealthed(){assert.fail('this dispatch does not inspect stealth');},
    work:()=>order.push('work'),
    removeStealth(){assert.fail('this dispatch keeps stealth');},
    afterStealthBreak(){assert.fail('this dispatch has no break reaction');},
    sound:()=>order.push('sound'),
  });
  assert.deepEqual(order,['work','sound']);
});

test('an empty dispatch still removes entry stealth without optional feedback callbacks',()=>{
  let stealthed=true;
  runActionDispatch(true,{
    isStealthed:()=>stealthed,
    work(){},
    removeStealth(){stealthed=false;},
  });
  assert.equal(stealthed,false);
});

test('successive dispatches take separate snapshots',()=>{
  let stealthed=true;
  const workStealth:boolean[]=[];
  let reactions=0;
  for(let hit=0;hit<2;hit++)runActionDispatch(true,{
    isStealthed:()=>stealthed,
    work:()=>{workStealth.push(stealthed);},
    removeStealth(){stealthed=false;},
    afterStealthBreak(){reactions++;},
  });
  assert.deepEqual(workStealth,[true,false]);
  assert.equal(reactions,1);
});

test('cancelling an action inside synchronous work still completes its dispatch tail',()=>{
  let cancelled=false;
  const order:string[]=[];
  runActionDispatch(true,{
    isStealthed:()=>true,
    work(){cancelled=true;order.push('cancel');},
    removeStealth:()=>order.push('remove'),
    afterStealthBreak:()=>order.push('reaction'),
    sound:()=>order.push('sound'),
  });
  assert.equal(cancelled,true);
  assert.deepEqual(order,['cancel','remove','reaction','sound']);
});

for(const saveCaster of [false,true]){
  test(`an outer hit scope runs the zero-health tail before ${saveCaster?'rescue':'defeat'}`,()=>{
    const resolution=new CombatHitResolution();
    const order:string[]=[];
    let health=10;
    resolution.run(()=>runActionDispatch(true,{
      isStealthed:()=>true,
      work(){
        resolution.run(()=>{
          health=0;
          order.push('lethal-reflection');
          resolution.deferDefeat('caster',()=>order.push(health>0?'saved':'defeated'));
        });
        assert.equal(resolution.isAwaitingDefeat('caster'),true);
        order.push('remaining-direct-work');
      },
      removeStealth(){assert.equal(health,0);order.push('remove');},
      afterStealthBreak(){
        assert.equal(resolution.isAwaitingDefeat('caster'),true);
        order.push('reaction');
        if(saveCaster)health=10;
      },
      sound:()=>order.push('sound'),
    }));
    assert.deepEqual(order,[
      'lethal-reflection','remaining-direct-work','remove','reaction','sound',
      saveCaster?'saved':'defeated',
    ]);
    assert.equal(resolution.isAwaitingDefeat('caster'),false);
  });
}

test('work errors propagate without a completion tail while the outer scope finalizes defeat',()=>{
  const resolution=new CombatHitResolution();
  const error=new Error('dispatch failed');
  const order:string[]=[];
  assert.throws(()=>resolution.run(()=>runActionDispatch(true,{
    isStealthed:()=>true,
    work(){
      resolution.deferDefeat('caster',()=>order.push('defeated'));
      throw error;
    },
    removeStealth:()=>order.push('remove'),
    afterStealthBreak:()=>order.push('reaction'),
    sound:()=>order.push('sound'),
  })),caught=>caught===error);
  assert.deepEqual(order,['defeated']);
  assert.equal(resolution.isAwaitingDefeat('caster'),false);
});

test('a tail error propagates before sound',()=>{
  const error=new Error('reaction failed');
  const order:string[]=[];
  assert.throws(()=>runActionDispatch(true,{
    isStealthed:()=>true,
    work:()=>order.push('work'),
    removeStealth:()=>order.push('remove'),
    afterStealthBreak(){throw error;},
    sound:()=>order.push('sound'),
  }),caught=>caught===error);
  assert.deepEqual(order,['work','remove']);
});
