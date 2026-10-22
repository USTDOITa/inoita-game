import test from 'node:test';
import assert from 'node:assert/strict';
import {CombatThreatSystem,type CombatThreatActor,type CombatThreatPort} from '../src/domain/combat-threat-system.ts';

const actor=(id:string,team='party',values:Partial<CombatThreatActor>={}):CombatThreatActor=>({
  id,team,position:{x:0,y:0},bounds:{x:-8,y:-8,width:16,height:16},
  active:true,level:5,sightRangeUnits:8,tracksThreat:team==='hostile',...values,
});

function fixture(roster:CombatThreatActor[]){
  const actors=new Map(roster.map(value=>[value.id,value]));
  const current=new Map<string,string>(),taunts=new Map<string,string>();
  const generation=new Map<string,number>(),reduction=new Map<string,number>();
  const normal=new Map<string,{physical:number;magic:number}>();
  const events:string[]=[];
  let tick=1;
  const port:CombatThreatPort={
    actor:id=>actors.get(id),actors:()=>[...actors.values()],currentTarget:id=>current.get(id),
    logicTick:()=>{events.push('tick');return tick;},
    generationRate:id=>{events.push(`generation:${id}`);return generation.get(id)??1000;},
    reductionRate:id=>{events.push(`reduction:${id}`);return reduction.get(id)??0;},
    normalDamage:id=>{events.push(`normal:${id}`);return normal.get(id)??{physical:17,magic:23};},
    tauntSource:id=>taunts.get(id),
    applyTaunt:(source,target)=>{events.push(`taunt:${source}:${target}`);taunts.set(target,source);},
    combatStarted:id=>events.push(`combat:${id}`),
  };
  const system=new CombatThreatSystem(port);
  const score=(owner:string,source:string)=>system.captureState().entries.find(entry=>entry.ownerId===owner&&entry.sourceId===source)?.score;
  return {system,actors,current,taunts,generation,reduction,normal,events,port,score,setTick:(value:number)=>{tick=value;}};
}

test('positive damage uses rectangle gaps before source rates and retains explicit reflected or periodic sources',()=>{
  const f=fixture([actor('hero'),actor('near','hostile',{position:{x:256,y:0}}),actor('far','hostile',{position:{x:264,y:0}})]);
  f.generation.set('hero',1500);f.reduction.set('hero',500);
  f.system.damage('hero','near',7);f.system.damage('hero','far',7);
  assert.equal(f.score('near','hero'),5);assert.equal(f.score('far','hero'),4);
  // 己方主动伤害与同阵营追加伤害均保留传入的source，不凭team重新归属。
  f.system.damage('near','far',20);
  assert.equal(f.score('far','near'),20);
  assert.equal(f.system.has('near','far'),false);
});

test('damage ignores zero, negative and immune results, but inactivity alone does not reject AddDamage',()=>{
  const f=fixture([actor('hero'),actor('enemy','hostile')]);
  for(const damage of [0,-1])f.system.damage('hero','enemy',damage);
  f.actors.get('enemy')!.states=['damage-immune'];f.system.damage('hero','enemy',100);
  f.system.damage('missing','enemy',100);f.system.damage('hero','missing',100);
  f.system.damage('enemy','hero',100);
  assert.deepEqual(f.system.captureState(),{entries:[]});
  f.actors.get('enemy')!.states=[];f.actors.get('enemy')!.active=false;f.actors.get('hero')!.active=false;
  f.system.damage('hero','enemy',100);
  assert.equal(f.score('enemy','hero'),100);
});

test('healing adds only to active enemies currently targeting the recipient and measures each healer-to-owner distance',()=>{
  const f=fixture([actor('healer'),actor('recipient','party',{states:['stealthed']}),
    actor('near','hostile',{position:{x:256,y:0},states:['stealthed']}),actor('far','hostile',{position:{x:264,y:0}}),
    actor('inactive','hostile',{active:false}),actor('other','hostile'),actor('friend')]);
  for(const id of ['near','far','inactive','friend'])f.current.set(id,'recipient');
  f.current.set('other','healer');
  f.system.notice('other','recipient');const previous=f.score('other','recipient');
  f.generation.set('healer',1500);f.reduction.set('healer',500);f.events.length=0;
  f.system.heal('healer','recipient',101);
  assert.equal(f.score('near','healer'),2);assert.equal(f.score('far','healer'),1);
  assert.equal(f.system.has('inactive','healer'),false);assert.equal(f.system.has('other','healer'),false);
  assert.equal(f.system.has('friend','healer'),false);assert.equal(f.score('other','recipient'),previous);
  assert.equal(f.events.filter(event=>event==='generation:healer').length,1);
  assert.deepEqual(f.events.filter(event=>event.startsWith('combat:')),['combat:near','combat:far']);
});

test('zero actual healing still creates an entry and starts combat; same ledger gate applies to later healing',()=>{
  const f=fixture([actor('healer'),actor('recipient'),actor('enemy','hostile')]);f.current.set('enemy','recipient');
  f.system.heal('healer','recipient',0);
  assert.equal(f.system.has('enemy','healer'),true);assert.equal(f.score('enemy','healer'),0);
  assert.ok(f.events.includes('combat:enemy'));
  f.taunts.set('enemy','recipient');f.events.length=0;const before=f.system.captureState();
  f.system.heal('healer','recipient',1000);
  assert.deepEqual(f.system.captureState(),before);
  assert.equal(f.events.some(event=>event.startsWith('reduction:')||event.startsWith('combat:')),false);
});

test('successful direct state uses source level and rates only for opposing teams',()=>{
  const f=fixture([actor('hero','party',{level:7}),actor('friend'),actor('enemy','hostile')]);
  f.generation.set('hero',2000);f.reduction.set('hero',250);
  f.system.state('hero','enemy');f.system.state('hero','friend');f.system.state('missing','enemy');
  assert.equal(f.score('enemy','hero'),21);assert.equal(f.system.has('friend','hero'),false);
  assert.deepEqual(f.events.filter(event=>event.startsWith('combat:')),['combat:enemy']);
});

test('taunt creates its caster entry from both normal damages, clamps same-team competitors, then attempts state',()=>{
  const f=fixture([actor('caster','party',{active:false,states:['stealthed']}),actor('competitor'),actor('low'),
    actor('neutral-to-caster','hostile'),actor('enemy','hostile',{active:false})]);
  f.system.restoreState({entries:[
    {ownerId:'enemy',sourceId:'competitor',score:100,updatedTick:1},
    {ownerId:'enemy',sourceId:'low',score:3,updatedTick:1},
    {ownerId:'enemy',sourceId:'neutral-to-caster',score:100,updatedTick:1},
  ]});
  f.generation.set('caster',3000);f.reduction.set('caster',500);f.setTick(5);
  let scoreAtState:number|undefined;
  f.port.applyTaunt=(source,target)=>{scoreAtState=f.score(target,'competitor');f.events.push(`taunt:${source}:${target}`);};
  f.system.taunt('caster','enemy');
  assert.equal(f.score('enemy','caster'),20);assert.equal(scoreAtState,16);
  assert.equal(f.score('enemy','low'),3);assert.equal(f.score('enemy','neutral-to-caster'),100);
  assert.deepEqual(f.events,['normal:caster','reduction:caster','tick','combat:enemy','taunt:caster:enemy']);
  assert.equal(f.system.captureState().entries[0].updatedTick,1);
});

test('zero taunt scores are valid and a refused state callback does not undo the preceding clamp',()=>{
  const f=fixture([actor('caster'),actor('competitor'),actor('enemy','hostile')]);
  f.system.damage('competitor','enemy',100);f.normal.set('caster',{physical:0,magic:0});
  f.port.applyTaunt=()=>f.events.push('state-rejected');
  f.system.taunt('caster','enemy');
  assert.equal(f.score('enemy','caster'),0);assert.equal(f.score('enemy','competitor'),0);
  assert.equal(f.events.at(-1),'state-rejected');
  const saved=f.system.captureState();
  f.system.taunt('caster','caster');f.system.taunt('missing','enemy');f.system.taunt('enemy','caster');
  assert.deepEqual(f.system.captureState(),saved);
});

test('an old taunt blocks creating a new caster entry while an existing competitor can replace the source',()=>{
  const f=fixture([actor('first'),actor('second'),actor('new'),actor('enemy','hostile')]);
  f.system.damage('first','enemy',100);f.system.damage('second','enemy',80);f.taunts.set('enemy','first');
  f.events.length=0;const saved=f.system.captureState();
  f.system.taunt('new','enemy');
  assert.deepEqual(f.system.captureState(),saved);assert.deepEqual(f.events,['normal:new']);
  f.events.length=0;f.system.taunt('second','enemy');
  assert.equal(f.score('enemy','first'),64);assert.equal(f.taunts.get('enemy'),'second');
  assert.deepEqual(f.events,['taunt:second:enemy']);
  f.system.damage('first','enemy',20);assert.equal(f.score('enemy','first'),64);
  f.system.damage('second','enemy',20);assert.equal(f.score('enemy','second'),100);
});

test('notice uses owner level plus ten with source reduction and does not consult generation or mutate target pointers',()=>{
  const f=fixture([actor('hero'),actor('enemy','hostile',{level:5})]);f.reduction.set('hero',500);
  f.current.set('enemy','old-target');f.system.notice('enemy','hero');
  assert.equal(f.score('enemy','hero'),8);assert.equal(f.current.get('enemy'),'old-target');
  assert.equal(f.events.some(event=>event.startsWith('generation:')),false);
});

test('presence threat is weighted by role: player ten, member six, summon fifteen',()=>{
  const f=fixture([actor('hero'),actor('member'),actor('summon'),actor('enemy','hostile',{level:5})]);
  f.actors.get('member')!.role='member';f.actors.get('summon')!.role='summon';
  f.system.notice('enemy','hero');f.system.notice('enemy','member');f.system.notice('enemy','summon');
  assert.equal(f.score('enemy','hero'),15);
  assert.equal(f.score('enemy','member'),9);
  assert.equal(f.score('enemy','summon'),22);
});

test('repeated notice keeps one presence entry per source',()=>{
  const f=fixture([actor('hero'),actor('enemy','hostile',{level:5})]);f.events.length=0;
  f.system.notice('enemy','hero');f.system.notice('enemy','hero');
  assert.equal(f.score('enemy','hero'),15);
  assert.deepEqual(f.events.filter(event=>event.startsWith('combat:')),['combat:enemy']);
});

test('with no current target a summon outranks the player by presence',()=>{
  const f=fixture([actor('hero'),actor('summon'),actor('enemy','hostile',{level:5})]);
  f.actors.get('summon')!.role='summon';
  f.system.notice('enemy','hero');f.system.notice('enemy','summon');
  assert.equal(f.system.select('enemy',undefined),'summon');
});

test('a summon noticed before the first selection outranks accumulated player threat',()=>{
  const f=fixture([actor('hero'),actor('summon'),actor('enemy','hostile',{level:5})]);
  f.actors.get('summon')!.role='summon';
  f.system.restoreState({entries:[{ownerId:'enemy',sourceId:'hero',score:100,updatedTick:1}]});
  f.system.notice('enemy','summon');
  assert.equal(f.score('enemy','summon'),120);
  assert.equal(f.current.size,0,'没有当前目标也要抬分');
  assert.equal(f.system.select('enemy',undefined),'summon');
});

test('a summon arriving mid-fight is raised above the current highest score',()=>{
  const f=fixture([actor('hero'),actor('summon'),actor('enemy','hostile',{level:5})]);
  f.actors.get('summon')!.role='summon';f.current.set('enemy','hero');
  f.system.restoreState({entries:[{ownerId:'enemy',sourceId:'hero',score:100,updatedTick:1}]});
  f.system.notice('enemy','summon');
  assert.equal(f.score('enemy','hero'),100);
  assert.equal(f.score('enemy','summon'),120);
  assert.equal(f.system.select('enemy','hero'),'summon');
});

test('a taunt blocks summon presence until it ends, then the next notice raises it',()=>{
  const f=fixture([actor('hero'),actor('summon'),actor('enemy','hostile',{level:5})]);
  f.actors.get('summon')!.role='summon';f.current.set('enemy','hero');
  f.system.restoreState({entries:[{ownerId:'enemy',sourceId:'hero',score:100,updatedTick:1}]});
  f.taunts.set('enemy','hero');
  f.system.notice('enemy','summon');
  assert.equal(f.system.has('enemy','summon'),false);
  f.taunts.delete('enemy');
  f.system.notice('enemy','summon');
  assert.equal(f.score('enemy','summon'),120);
});

test('the current target never decays while other out-of-sight entries still do',()=>{
  const f=fixture([actor('danger','party',{position:{x:72,y:0}}),actor('other','party',{position:{x:72,y:0}}),
    actor('enemy','hostile',{sightRangeUnits:8})]);
  f.system.restoreState({entries:[{ownerId:'enemy',sourceId:'danger',score:100,updatedTick:1},
    {ownerId:'enemy',sourceId:'other',score:43,updatedTick:2}]});
  f.current.set('enemy','danger');
  f.system.decay();
  assert.equal(f.score('enemy','danger'),100);
  assert.equal(f.score('enemy','other'),11);
});

test('selection filters inactive, same-team and hidden candidates without clearing scores or enforcing sight range',()=>{
  const f=fixture([actor('hero'),actor('hidden','party',{states:['stealthed']}),actor('inactive','party',{active:false}),
    actor('far','party',{position:{x:10000,y:0}}),actor('friend','hostile'),actor('enemy','hostile')]);
  for(const [id,damage] of [['hero',100],['hidden',200],['inactive',300],['far',110],['friend',400]] as const)
    f.system.restoreState({entries:[...f.system.captureState().entries,{ownerId:'enemy',sourceId:id,score:damage,updatedTick:1}]});
  const before=f.system.captureState();
  assert.equal(f.system.select('enemy','hero'),'far');
  assert.deepEqual(f.system.captureState(),before);assert.equal(f.current.size,0);
  f.actors.get('hidden')!.states=[];assert.equal(f.system.select('enemy','far'),'hidden');
  assert.equal(f.system.select('hero','enemy'),'enemy');assert.equal(f.system.select('missing','hero'),undefined);
});

test('external recovery pulses decay by actor rectangle distance plus two and retain inactive or hidden entries in sight',()=>{
  const f=fixture([actor('near','party',{active:false,states:['stealthed'],position:{x:64,y:0}}),
    actor('far','party',{position:{x:72,y:0}}),actor('enemy','hostile',{sightRangeUnits:8})]);
  f.system.restoreState({entries:[{ownerId:'enemy',sourceId:'near',score:100,updatedTick:1},
    {ownerId:'enemy',sourceId:'far',score:43,updatedTick:2}]});
  f.setTick(1000);assert.equal(f.score('enemy','far'),43);
  f.system.decay();assert.equal(f.score('enemy','near'),100);assert.equal(f.score('enemy','far'),11);
  f.system.decay();assert.equal(f.system.has('enemy','far'),false);
  assert.deepEqual(f.events,[]);
});

test('owner cleanup, actor departure and map reset have distinct effects and restored snapshots remain detached',()=>{
  const f=fixture([actor('hero'),actor('enemy','hostile'),actor('other','hostile')]);
  f.system.notice('enemy','hero');f.system.notice('other','enemy');f.system.notice('other','hero');
  const saved=f.system.captureState(),restored=new CombatThreatSystem(f.port);restored.restoreState(saved);
  saved.entries[0].score=999;assert.notDeepEqual(restored.captureState(),saved);
  restored.clearOwner('enemy');assert.equal(restored.has('other','enemy'),true);
  restored.removeActor('enemy');assert.equal(restored.has('other','enemy'),false);
  assert.equal(restored.has('other','hero'),true);assert.equal(f.system.has('enemy','hero'),true);
  restored.clear();assert.deepEqual(restored.captureState(),{entries:[]});
});
