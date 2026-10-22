import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type { Campaign } from '../src/domain/campaign.ts';
import {Session} from '../src/domain/session.ts';
import {defaultResourceAttributes,type ResourceRecoveryActor} from '../src/domain/combat-resources.ts';

const campaign=JSON.parse(readFileSync(new URL('../public/content/campaign.json',import.meta.url),'utf8')) as Campaign;
const advance=(session:Session,delta:number,actors:ResourceRecoveryActor[])=>{
  const pulses:ReturnType<Session['recoverCombatResources']>=[];
  session.advanceCombatFrames(delta,()=>pulses.push(...session.recoverCombatResources(actors)));
  return pulses;
};
const actor=(actorId:string):ResourceRecoveryActor=>({actorId,alive:true,level:1,...defaultResourceAttributes('member',1)});

test('a session retains resource recovery phase across maps and uses the current actor roster',()=>{
  const session=new Session(campaign);
  session.enterMap('map-a');session.advanceGameTime(1800);
  assert.deepEqual(advance(session,1800,[actor('old-actor')]),[]);
  session.enterMap('map-b');session.advanceGameTime(59);
  assert.deepEqual(advance(session,59,[actor('new-actor')]),[]);
  session.advanceGameTime(1);
  assert.deepEqual(advance(session,1,[actor('new-actor')]),[
    {atMs:1860,amounts:[{actorId:'new-actor',healthAmount:99,manaAmount:8}]},
  ]);
  session.enterMap('map-c');assert.deepEqual(advance(session,1859,[]),[]);
  assert.deepEqual(advance(session,1,[]),[{atMs:3720,amounts:[]}]);
});

test('session snapshots restore the pending resource deadline separately from consumable recovery',()=>{
  const session=new Session(campaign),actors=[actor('player')];
  advance(session,2100,actors);
  const saved=session.captureState(),consumables=structuredClone(saved.recovery);
  assert.deepEqual(saved.resourceRecovery,{elapsedMs:2100,deadlineTick:61});
  advance(session,5000,actors);session.enterMap('another-map');
  session.restoreState(saved);
  saved.resourceRecovery.deadlineTick=999;saved.resourceRecovery.elapsedMs=0;
  assert.deepEqual(advance(session,1619,actors),[]);
  assert.deepEqual(advance(session,1,actors),[
    {atMs:3720,amounts:[{actorId:'player',healthAmount:99,manaAmount:8}]},
  ]);
  assert.deepEqual(session.captureState().recovery,consumables);
  assert.equal(new Session(campaign).captureState().resourceRecovery.elapsedMs,0);
});

test('capturing a resource clock never advances it or shares mutable state with the session',()=>{
  const session=new Session(campaign),actors=[actor('player')];
  advance(session,1859,actors);
  const saved=session.captureState();saved.resourceRecovery.deadlineTick=999;
  saved.resourceRecovery.elapsedMs=999999;
  assert.equal(advance(session,1,actors)[0].atMs,1860);
  const before=session.captureState().resourceRecovery;
  for(const delta of [0,-1,NaN,Infinity])assert.deepEqual(advance(session,delta,actors),[]);
  assert.deepEqual(session.captureState().resourceRecovery,before);
});

test('session cooldown deadlines survive map changes and restore together with fractional combat time',()=>{
  const session=new Session(campaign),hero=session.cooldowns.forActor('player'),ally=session.cooldowns.forActor('ally');
  hero.start('probe',40);ally.start('probe',50);
  advance(session,119,[]);session.enterMap('next-map');
  assert.equal(session.cooldowns.forActor('player').snapshot().probe.remainingMs,39*60);
  const saved=session.captureState();advance(session,5000,[]);assert.equal(hero.isReady('probe'),true);
  session.restoreState(saved);advance(session,1,[]);
  assert.equal(session.combatTick,2);assert.equal(hero.snapshot().probe.remainingMs,38*60);
  assert.equal(ally.snapshot().probe.remainingMs,48*60);
  saved.cooldowns!.actors.length=0;saved.combatClock!.frame=999;
  assert.equal(hero.isReady('probe'),false);assert.equal(session.combatTick,2);
});

test('revival resets only the revived actor and postpones the shared resource pulse without rewinding time',()=>{
  const session=new Session(campaign),hero=session.cooldowns.forActor('player'),ally=session.cooldowns.forActor('ally');
  hero.start('probe',100);ally.start('probe',100);
  advance(session,1859,[]);assert.equal(session.combatTick,30);
  session.reviveCombatActor('player');
  assert.equal(hero.isReady('probe'),true);assert.equal(ally.snapshot().probe.remainingMs,70*60);
  assert.equal(session.resourceRecoveryDelayMs,1801);
  assert.deepEqual(advance(session,1800,[actor('player')]),[]);
  assert.equal(advance(session,1,[actor('player')])[0].atMs,3660);
  assert.equal(session.combatTick,61);assert.equal(ally.snapshot().probe.remainingMs,39*60);
});
