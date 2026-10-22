import {CombatCooldownStore} from '../src/domain/combat-cooldowns.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBattle } from '../src/application/content-validation.ts';
import { CombatController } from '../src/domain/combat.ts';
import type { Combatant, CombatPort } from '../src/domain/combat.ts';
import { skillPlaybackEvents, skillSequence } from '../src/domain/skill-action.ts';

const catalog = parseBattle(JSON.parse(fs.readFileSync(new URL('../public/content/battle.json', import.meta.url), 'utf8')));
const action = catalog.skills['touch-of-agony'].action!;
const warlock = catalog.classes.find(character => character.id === 'warlock')!;

function setup(level: number) {
  const player: Combatant = { id: 'player', team: 'party', position: { x: 0, y: 0 }, bounds: { x: -8, y: -8, width: 16, height: 16 } };
  const enemy: Combatant = { ...player, id: 'enemy', team: 'hostile', position: { x: 24, y: 0 } };
  const actors = new Map([[player.id, player], [enemy.id, enemy]]);
  let frame!: (index: number) => void, finish!:()=>void;
  let mana = 100;
  const hits: number[] = [];
  const port: CombatPort = {cooldowns:new CombatCooldownStore(()=>0).forActor('player'),
    actor: id => actors.get(id), candidates: () => [...actors.values()], facing: () => 'east',
    moveToward: () => {}, stop: () => {}, canStand: () => true, relocate: () => {}, clearEffects: () => {},
    canSpendMana: cost => mana >= cost, spendMana: cost => { mana -= cost; return true; },
    play: (_playback, onFrame, onComplete) => { frame = onFrame; finish=onComplete; return () => {}; },
    frame: (playback,index,_contact,ready) => {
      for(const event of skillPlaybackEvents(playback.skill!.action,index,playback.skill!.level,playback.repeatState))
        if(event.kind==='units')ready({event,selectedTargetId:playback.target?.id});
    },
    unit: hit => { if (hit.cueIndex === 2) hits.push(hit.cueIndex); return 'success'; },
  };
  const combat = new CombatController('player', null, port);
  assert.equal(combat.request({ id: 'touch-of-agony', action, level, manaCost: 40 }, enemy.id), 'started');
  return { combat, hits, frame: (index: number) => frame(index), finish:()=>finish(),removeEnemy: () => actors.delete(enemy.id), mana: () => mana };
}

test('痛苦之击按原版等级连续命中，每次间隔三帧，只消耗一次魔法', () => {
  const counts = [3, 4, 5, 6, 6, 7, 7, 7];
  const clip = warlock.actor.clips['skill-touch-of-agony-east']!;
  for (let level = 1; level <= 8; level++) {
    assert.equal(action.repeat!.countByLevel[level - 1], counts[level - 1]);
    const sequence = skillSequence(action, level, clip.frames);
    const run = setup(level);
    run.frame(sequence.length - 1);
    assert.equal(run.hits.length, counts[level - 1]);
    assert.equal(run.mana(), 60);
    assert.equal(run.combat.snapshot().cooldowns['touch-of-agony'].durationMs, action.cooldownFrames*60);
    for (let hit = 1; hit <= counts[level - 1]; hit++) {
      assert.equal(skillPlaybackEvents(action, hit * 3, level).filter(event => event.kind === 'units').length, 1);
      assert.equal(sequence[hit * 3], 0);
    }
  }
});

test('痛苦之击击败当前目标后停止后续命中，但播完剩余动作', () => {
  const run = setup(8);
  run.frame(6);
  assert.equal(run.hits.length, 2);
  run.removeEnemy();
  run.combat.update();
  run.frame(21);
  assert.equal(run.hits.length, 2);
  assert.equal(run.combat.snapshot().targetId,undefined);
  assert.equal(run.combat.snapshot().state, 'attacking');
  run.finish();
  assert.equal(run.combat.snapshot().state, 'idle');
});
