import {CombatCooldownStore} from '../src/domain/combat-cooldowns.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { BattleCatalog } from '../src/domain/battle.ts';
import { CombatConditions } from '../src/domain/combat-conditions.ts';
import { CombatController, type Combatant, type CombatPort } from '../src/domain/combat.ts';
import { resolveBasicAttack } from '../src/domain/basic-attack.ts';
import { EnemyRoster } from '../src/domain/enemy-roster.ts';

const battle=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;

test('conditions resume periodic damage, expiry and temporary attributes at the saved times',()=>{
  const conditions=new CombatConditions(),unit=battle.skills['blood-curse'].action!.combatUnits!.filter(unit=>unit.effect==='buff').find(unit=>unit.buff==='blood-curse')!;
  conditions.applyBuff('enemy',unit.buff!,1,unit.ranks[0].effect,'player');
  conditions.applyState('player','stun',3000);conditions.setTemporaryAttribute('enemy','criticalRate',150);
  conditions.update(1250);const saved=conditions.captureState();
  conditions.update(5000);assert.equal(conditions.hasState('player','stun'),false);
  conditions.restoreState(saved);let ticks=0;
  // 保存点是第 20 帧结束、余 50ms：下一帧在 10ms 后，再过 9 帧到第 29 帧，第 30 帧才跳脉冲。
  conditions.update(9+10*60,()=>ticks++);assert.equal(ticks,0);
  conditions.update(60,()=>ticks++);assert.equal(ticks,unit.ranks[0].effect.periodic.length);
  assert.equal(conditions.attribute('enemy','criticalRate',100),150);
  // 眩晕按保存时剩余的 1750ms 继续计时；到此已过 669ms。
  conditions.update(1080);assert.equal(conditions.hasState('player','stun'),true);
  conditions.update(1);assert.equal(conditions.hasState('player','stun'),false);
  saved.buffs[0][1][0].remainingMs=0;
  assert.ok(conditions.snapshot('enemy')[0].remainingMs>0);
});

test('combat restore cancels old callbacks while session restores absolute cooldown deadlines',()=>{
  let frame=100;const cooldowns=new CombatCooldownStore(()=>frame);
  const caster:Combatant={id:'player',team:'party',position:{x:0,y:0},bounds:{x:-8,y:-8,width:16,height:16}};
  const enemy:Combatant={...caster,id:'enemy',team:'enemy',position:{x:16,y:0}};
  let oldFrame:((frame:number)=>void)|undefined,oldFinish:(()=>void)|undefined,cancelled=0,hits=0;
  const port:CombatPort={cooldowns:cooldowns.forActor('player'),actor:id=>[caster,enemy].find(actor=>actor.id===id),candidates:()=>[caster,enemy],facing:()=> 'east',
    moveToward(){},stop(){},canStand:()=>true,relocate(){},clearEffects(){},
    play:(_action,frame,finish)=>{oldFrame=frame;oldFinish=finish;return()=>{cancelled++;};},frame(){},contact(){hits++;}};
  const combat=new CombatController('player',resolveBasicAttack(battle,battle.classes[0]),port);
  port.cooldowns.start('dark-strike',15);const savedCooldowns=cooldowns.captureState();
  const saved={state:'idle' as const,targetId:'enemy',cooldowns:{'dark-strike':{remainingMs:900,durationMs:900}}};
  combat.request();assert.equal(combat.snapshot().state,'attacking');
  frame=120;port.cooldowns.reset();
  frame=100;cooldowns.restoreState(savedCooldowns);
  combat.restoreState(saved);assert.equal(cancelled,1);oldFrame!(100);oldFinish!();
  assert.equal(hits,0);assert.deepEqual(combat.snapshot(),saved);
  saved.cooldowns['dark-strike'].remainingMs=0;combat.restoreState(saved);
  assert.equal(combat.snapshot().cooldowns['dark-strike'].remainingMs,900,'display snapshots cannot overwrite session deadlines');
  frame=114;combat.update();assert.equal(combat.snapshot().cooldowns['dark-strike'].remainingMs,60);
  frame=115;assert.equal(combat.snapshot().cooldowns['dark-strike'],undefined);
});

test('enemy roster rollback preserves summoned resources and the next instance identity',()=>{
  const roster=new EnemyRoster(),definition=battle.enemies.find(enemy=>enemy.maxHealth>10)!;
  roster.setPartySize(3,[]);const first=roster.placeEnemy(definition.id,100,120);first.summonedBy='player';
  roster.setEnemyHealth(first.key,7,definition);roster.setEnemyMana(first.key,0,definition);
  const saved=roster.captureState();roster.removeEnemy(first.key);roster.placeEnemy(definition.id,1,2);
  roster.restoreState(saved);assert.equal(roster.partySize,3);
  assert.equal(roster.enemySnapshot(first.key,definition)!.health,7);
  assert.equal(roster.enemies[0].summonedBy,'player');assert.equal(roster.enemies[0].x,100);
  assert.equal(roster.placeEnemy(definition.id,16,24).key,'enemy-2');
  saved.enemies[0].health=999;assert.equal(roster.enemySnapshot(first.key,definition)!.health,7);
});

test('older temporary-operation snapshots resolve once against the restored attribute',()=>{
  const conditions=new CombatConditions();
  conditions.restoreState({buffs:[],states:[],temporary:[['actor',[['physicalAttack',{operation:{kind:'add',amount:50}}]]]]});
  assert.equal(conditions.attribute('actor','physicalAttack',100),150);
  assert.equal(conditions.attribute('actor','physicalAttack',300),150);
  assert.equal(conditions.captureState().temporary[0][1][0][1],150);
});
