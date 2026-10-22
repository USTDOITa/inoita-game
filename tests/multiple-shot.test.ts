import {CombatCooldownStore} from '../src/domain/combat-cooldowns.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBattle } from '../src/application/content-validation.ts';
import { LOGIC_FRAME_MS } from '../src/domain/battle.ts';
import { resolveBasicAttack } from '../src/domain/basic-attack.ts';
import { CombatController } from '../src/domain/combat.ts';
import type { ActionPlayback, Combatant, CombatPort } from '../src/domain/combat.ts';
import { skillPlaybackEvents, skillSequence } from '../src/domain/skill-action.ts';
import type {Facing} from '../src/domain/content.ts';
import type {WardrobeCatalog} from '../src/domain/wardrobe.ts';

const catalog = parseBattle(JSON.parse(fs.readFileSync(new URL('../public/content/battle.json', import.meta.url), 'utf8')));
const ranger = catalog.classes.find(character => character.id === 'ranger')!;
const action = catalog.skills['multiple-shot'].action!;
const counts = [4, 5, 6, 7, 8, 8, 8, 9];
const wardrobe=JSON.parse(fs.readFileSync(new URL('../public/content/wardrobe.json',import.meta.url),'utf8')) as WardrobeCatalog;

function setup(casterId='player') {
  let nowFrame=0;const cooldowns=new CombatCooldownStore(()=>nowFrame);
  const caster: Combatant = { id: casterId, team: 'party', position: { x: 0, y: 0 }, bounds: { x: -8, y: -8, width: 16, height: 16 } };
  const enemy: Combatant = { ...caster, id: 'target', team: 'hostile', position: { x: 40, y: 0 } };
  let actors = [caster, enemy, { ...enemy, id: 'other', position: { x: 0, y: 40 } }];
  let frame: (index: number) => void, finish: () => void;
  let playback: ActionPlayback;
  let releases = 0, clears = 0;
  const shots: { frame: number; target: string; facing:Facing }[] = [];
  const directions:Facing[]=[];
  const arrivals: (() => void)[] = [];
  const contacts: string[] = [];
  const port: CombatPort = {
    cooldowns:cooldowns.forActor(caster.id),
    actor: id => actors.find(actor => actor.id === id), candidates: () => actors,
    facing: () => 'east', moveToward: () => {}, stop: () => {}, canStand: () => true, relocate: () => {},
    face:direction=>directions.push(direction),
    clearEffects: () => { clears++; }, contact: event => { contacts.push(event.targetId); },
    play: (current, onFrame, onComplete) => { playback = current; frame = onFrame; finish = onComplete; return () => { releases++; }; },
    unit:()=> 'success',
    frame: (current, index, _contact, ready) => {
      for (const event of skillPlaybackEvents(current.skill!.action, index, current.skill!.level)) if (event.kind === 'units') {
        const id = current.target?.id;
        if(!id)continue;
        const arrival={event,selectedTargetId:id};
        shots.push({ frame: index, target: id, facing:current.facing }); arrivals.push(() => {ready(arrival);});
      }
    },
  };
  const combat = new CombatController(casterId, resolveBasicAttack(catalog, ranger), port);
  return { combat, shots, arrivals, contacts,directions,moveTarget:(x:number,y:number)=>{enemy.position={x,y};},advanceFrames:(frames:number)=>{nowFrame+=frames;combat.update();}, frame: (index: number) => frame(index), finish: () => finish(),
    playback: () => playback, callbacks: () => ({ frame, finish }), releases: () => releases, clears: () => clears,
    removeTarget: () => { actors = actors.filter(actor => actor.id !== 'target'); } };
}

test('multiple shot uses native rank counts and a 180ms firing interval in all four directions', () => {
  for (let level = 1; level <= 8; level++) for (const facing of ['south', 'west', 'north', 'east'] as const) {
    const clip = ranger.actor.clips[`skill-multiple-shot-${facing}`]!;
    const sequence = skillSequence(action, level, clip.frames);
    const run = setup();
    assert.equal(run.combat.request({ id: 'multiple-shot', action, level }, 'target'), 'started');
    // Deliberately skip intermediate callbacks and repeat one: each arrow still fires exactly once.
    run.frame(6); run.frame(6); run.frame(sequence.length - 1);
    assert.deepEqual(run.shots.map(shot => shot.frame * LOGIC_FRAME_MS), Array.from({ length: counts[level - 1] }, (_, i) => (i + 1) * 180));
    assert.ok(run.shots.every(shot => shot.target === 'target'));
    for (const shot of run.shots) assert.equal(sequence[shot.frame], 0, 'firing resets the visible pose immediately');
    assert.deepEqual(sequence.slice(-clip.frames), [0, 1, 2, 3, 4, 5, 6], 'final reset plays the full recovery without firing');
    assert.equal(sequence.length, counts[level - 1] * 3 + 7);
    assert.equal(run.combat.snapshot().cooldowns['multiple-shot'].durationMs, action.cooldownFrames*LOGIC_FRAME_MS);
    run.finish(); assert.equal(run.combat.snapshot().state, 'idle'); assert.equal(run.releases(), 1);
  }
});

test('movement interruption stops later arrows but preserves in-flight contacts and cooldown', () => {
  const run = setup(); run.combat.request({ id: 'multiple-shot', action, level: 8 }, 'target');
  run.frame(6); run.advanceFrames(6); const old = run.callbacks(); run.combat.cancel();
  old.frame(30); old.finish();
  assert.equal(run.shots.length, 2); assert.equal(run.clears(), 0);
  run.arrivals.forEach(arrive => { arrive(); arrive(); });
  assert.deepEqual(run.contacts, ['target', 'target']);
  assert.equal(run.combat.snapshot().cooldowns['multiple-shot'].remainingMs, (action.cooldownFrames-6)*LOGIC_FRAME_MS);
});

test('removing the selected enemy ends the action at the next release, preserving cooldown and emitted arrows', () => {
  for (const notify of ['scene', 'update', 'frame']) {
    const run = setup(); run.combat.request({ id: 'multiple-shot', action, level: 8 }, 'target'); run.frame(3);
    run.removeTarget();
    if(notify==='scene')run.combat.targetRemoved('target');
    else if (notify === 'update') run.combat.update();
    else run.frame(4);
    assert.equal(run.combat.snapshot().targetId,undefined);
    assert.equal(run.combat.snapshot().state, 'attacking');
    assert.equal(run.releases(),0);assert.equal(run.clears(),0);
    run.frame(5);assert.equal(run.combat.snapshot().state,'attacking');
    run.frame(6);assert.equal(run.combat.snapshot().state,'idle');
    assert.equal(run.releases(),1);assert.equal(run.clears(),0);
    assert.equal(run.combat.snapshot().cooldowns['multiple-shot'].durationMs,action.cooldownFrames*LOGIC_FRAME_MS);
    run.frame(27);run.arrivals[0]();
    assert.equal(run.shots.length, 1); assert.deepEqual(run.contacts, []);
    run.finish();assert.equal(run.combat.snapshot().state, 'idle');assert.equal(run.releases(),1);
  }
});

test('each new cast uses its own level and ignores stale callbacks from the previous cast', () => {
  const run = setup();
  for (const level of [undefined, 8, 1]) {
    run.shots.length = 0;
    run.advanceFrames(action.cooldownFrames);
    run.combat.request({ id: 'multiple-shot', action, level }, 'target');
    const active = run.playback(); assert.equal(active.skill!.level, level);
    const sequence = skillSequence(action, level ?? 1, 7);
    run.frame(sequence.length - 1); const old = run.callbacks(); run.finish();
    assert.equal(run.shots.length, counts[(level ?? 1) - 1]);
    run.advanceFrames(action.cooldownFrames);
    run.combat.request({ id: 'multiple-shot', action, level: 1 }, 'target');
    old.frame(27); old.finish(); assert.equal(run.combat.snapshot().state, 'attacking'); run.combat.cancel();
  }
});

test('both growth profiles preserve all eight native shot counts and bow/crossbow release boundaries',()=>{
  // ACT96 kind4/attribute76, trunc((b+13)/3); training60 uses u01/u03 separately.
  for(const [casterId,profile,expected]of [['player',catalog.skills['multiple-shot'],counts],
    ['companion',catalog.skills['multiple-shot'].companion!,[5,5,6,7,7,7,8,8]]] as const){
    for(const weapon of ['bow','crossbow'])for(let level=1;level<=8;level++){
      const selected=weapon==='bow'?profile.action!:wardrobe.skillStances.ranger['crossbow:empty'].actions['multiple-shot']!;
      const current={...selected,repeat:{...profile.action!.repeat!,restartAfterFrame:selected.repeat!.restartAfterFrame}};
      const interval=weapon==='bow'?3:2;
      assert.equal(current.repeat.restartAfterFrame,interval);assert.equal(current.repeat.endsWithoutTarget,true);
      assert.equal(current.repeat.facesTargetOnRelease,true);assert.equal(current.repeat.countByLevel[level-1],expected[level-1]);
      const run=setup(casterId);run.combat.request({id:'multiple-shot',action:current,level},'target');
      run.frame(interval*expected[level-1]+6);
      assert.deepEqual(run.shots.map(shot=>shot.frame),Array.from({length:expected[level-1]},(_,index)=>(index+1)*interval));
      const lost=setup(casterId);lost.combat.request({id:'multiple-shot',action:current,level},'target');lost.frame(interval);
      lost.removeTarget();lost.combat.targetRemoved('target');lost.frame(2*interval-1);
      assert.equal(lost.combat.snapshot().state,'attacking');lost.frame(2*interval);
      assert.equal(lost.combat.snapshot().state,'idle');assert.equal(lost.shots.length,1);assert.equal(lost.clears(),0);
    }
  }
});

test('every arrow turns toward the current position without restarting release timing or switching targets',()=>{
  const run=setup();run.combat.request({id:'multiple-shot',action,level:1},'target');
  run.frame(3);run.moveTarget(0,-40);run.frame(5);assert.equal(run.playback().facing,'east');
  run.frame(6);run.frame(6);run.moveTarget(-40,0);run.frame(9);run.moveTarget(0,40);run.frame(18);
  assert.deepEqual(run.shots.map(shot=>shot.frame),[3,6,9,12]);
  assert.deepEqual(run.shots.map(shot=>shot.facing),['east','north','west','south']);
  assert.deepEqual(run.directions,['east','north','west','south']);assert.ok(run.shots.every(shot=>shot.target==='target'));
});

test('target disappearance after the last arrow retains the complete recovery animation',()=>{
  const run=setup();run.combat.request({id:'multiple-shot',action,level:1},'target');run.frame(12);
  run.removeTarget();run.combat.targetRemoved('target');run.frame(18);
  assert.equal(run.combat.snapshot().state,'attacking');assert.equal(run.shots.length,4);
  run.finish();assert.equal(run.combat.snapshot().state,'idle');
});

test('repeat content rejects incomplete counts, non-integer counts and invalid reset frames', () => {
  for (const repeat of [
    { restartAfterFrame: 3, countByLevel: [4] },
    { restartAfterFrame: 0, countByLevel: counts },
    { restartAfterFrame: 2, countByLevel: counts },
    { restartAfterFrame: 3, countByLevel: [0, ...counts.slice(1)] },
    { restartAfterFrame: 3, countByLevel: [4.5, ...counts.slice(1)] },
  ]) {
    const invalid = structuredClone(catalog); invalid.skills['multiple-shot'].action!.repeat = repeat;
    assert.throws(() => parseBattle(invalid));
  }
  assert.throws(() => skillSequence(action, 9, 7), /等级/);
});
