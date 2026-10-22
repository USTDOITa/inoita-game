import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parseBattle} from '../src/application/content-validation.ts';
import type {BattleBuffEffect,BattleCatalog} from '../src/domain/battle.ts';
import {buffEffectNames} from '../src/domain/buff-effects.ts';
import {resolveBuffReactions,type BuffReaction,type BuffReactionEvent} from '../src/domain/buff-reactions.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';

const reaction:BuffReaction={kind:'physical-success-threat'};
const event:Extract<BuffReactionEvent,{kind:'physical-success-threat'}>={
  kind:'physical-success-threat',ownerId:'attacker',opponentId:'defender',damageKind:'physical',outcome:'hit',hitDamage:37,
};
const effect:BattleBuffEffect={durationMs:5460,tickMs:0,maxStacks:1,simulationFrames:{lastActiveFrame:90},
  modifiers:[],states:[],periodic:[],reactions:[reaction]};

test('threat redistribution accepts every physical success including zero damage without a random draw',t=>{
  t.mock.method(Math,'random',()=>{throw new Error('threat redistribution does not draw random');});
  const child:BuffReaction={kind:'physical-avoidance',buff:{key:'mana-recovery',rankPriority:1,
    effect:{...effect,reactions:undefined}}};
  const reactions=[child,reaction],before=structuredClone(reactions);
  for(const damageKind of ['physical','magic'] as const)
    for(const outcome of ['miss','hit','critical','weapon-block','shield-block'] as const)
      for(const hitDamage of [0,37]){
        assert.deepEqual(resolveBuffReactions(reactions,{...event,damageKind,outcome,hitDamage}),
          damageKind==='physical'&&outcome!=='miss'
            ?[{kind:'redistribute-threat',sourceId:'attacker',targetId:'defender',damage:hitDamage}]:[]);
      }
  assert.deepEqual(resolveBuffReactions([reaction],{kind:'physical-avoidance',ownerId:'defender',
    damageKind:'physical',outcome:'weapon-block'}),[]);
  assert.deepEqual(resolveBuffReactions([reaction],{kind:'physical-success-party',ownerId:'attacker',
    damageKind:'physical',outcome:'hit',partyIds:['attacker']}),[]);
  assert.deepEqual(resolveBuffReactions([],event),[]);
  assert.deepEqual(reactions,before);
});

test('only the currently active parent enables redistribution and the source is its attacking owner',()=>{
  const conditions=new CombatConditions();
  conditions.applyBuff('attacker','shouts-of-threat',1,effect,'original-caster');
  const commands=()=>resolveBuffReactions(conditions.buffReactions('attacker'),event);
  const expected=[{kind:'redistribute-threat',sourceId:'attacker',targetId:'defender',damage:37}];
  assert.deepEqual(commands(),expected);
  conditions.update(91*60);
  assert.deepEqual(commands(),expected);
  conditions.update(60);
  assert.deepEqual(commands(),[]);
  conditions.applyBuff('attacker','shouts-of-threat',1,effect,'original-caster');
  conditions.removeBuff('attacker','shouts-of-threat');
  assert.deepEqual(commands(),[]);
});

test('the no-child reaction validates without assets while mixed nested reactions still validate their children',()=>{
  const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
  const unit=catalog.skills['shouts-of-threat'].action!.combatUnits!.find(unit=>unit.effect==='buff');
  assert.ok(unit?.effect==='buff');
  const active=structuredClone(effect);
  unit.ranks[0].effect=active;
  assert.doesNotThrow(()=>parseBattle(catalog));
  assert.deepEqual(buffEffectNames(active),[]);
  active.reactions!.push({kind:'physical-avoidance',buff:{key:'mana-recovery',rankPriority:1,
    effect:{...effect,reactions:undefined,applicationEffect:'life-drain'}}});
  assert.deepEqual(buffEffectNames(active),['life-drain']);
  assert.doesNotThrow(()=>parseBattle(catalog));
  const malformed=active.reactions![0] as unknown as Record<string,unknown>;
  malformed.buff={};
  assert.throws(()=>parseBattle(catalog),/reactions\[0\]\.buff.*未定义字段/);
  delete malformed.buff;
  malformed.kind='physical-success-unknown';
  assert.throws(()=>parseBattle(catalog),/reactions\[0\].*未知 kind/);
});
