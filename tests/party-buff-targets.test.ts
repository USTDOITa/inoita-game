import assert from 'node:assert/strict';
import test from 'node:test';
import {partyBuffTargets,type PartyBuffSlot} from '../src/domain/party-buff-targets.ts';
import type {Combatant} from '../src/domain/combat.ts';

const actor=(id:string,x=0,y=0):Combatant=>({id,team:'party',position:{x,y},bounds:{x:0,y:0,width:8,height:8}});
const slot=(actor:Combatant,options:Partial<PartyBuffSlot<Combatant>>={}):PartyBuffSlot<Combatant>=>
  ({actor,active:true,hasDisplay:true,...options});

test('party buffs preserve the first three slots and include a stealthed caster in its own slot order',()=>{
  const hero=actor('hero'),companion=actor('caster'),third=actor('third'),summon=actor('summon');
  companion.states=['stealthed'];
  const slots=[slot(hero),slot(companion),slot(third),slot(summon)];
  assert.deepEqual(partyBuffTargets(companion,slots,11).map(value=>value.id),['hero','caster','third']);
  assert.deepEqual(partyBuffTargets(companion,[undefined,slot(companion),slot(third)],11),[companion,third]);
  assert.equal(partyBuffTargets(companion,slots,11)[1],companion);
});

test('party buffs require an active same-team member with a display independently of invisibility',()=>{
  const caster=actor('caster'),other=actor('other');
  for(const excluded of [slot(other,{active:false}),slot(other,{hasDisplay:false}),slot({...other,team:'hostile'})])
    assert.deepEqual(partyBuffTargets(caster,[slot(caster),excluded],11),[caster]);
  assert.deepEqual(partyBuffTargets(caster,[slot({...other,states:['stealthed']})],11).map(value=>value.id),['other']);
});

test('party range reads the caster current feet and uses the existing integer octagonal metric',()=>{
  const caster=actor('caster');
  for(const [x,y,eligible] of [[95,0,true],[96,0,false],[66,66,true],[70,70,false],[95.9,0,true],[-96,0,false]] as const){
    const target=actor('target',x,y);
    assert.equal(partyBuffTargets(caster,[slot(target)],11).length,eligible?1:0,`${x},${y}`);
  }
  const target=actor('target',96);
  assert.deepEqual(partyBuffTargets(caster,[slot(target)],11),[]);
  caster.position.x=1;
  assert.deepEqual(partyBuffTargets(caster,[slot(target)],11),[target]);
  assert.deepEqual(partyBuffTargets(caster,[slot(actor('far',1000))],0).map(value=>value.id),['far']);
});
