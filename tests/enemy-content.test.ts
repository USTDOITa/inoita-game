import { feedbackEffects } from '../src/domain/combat-feedback.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { BattleCatalog, BasicAttackBinding } from '../src/domain/battle.ts';
import { parseBattle } from '../src/application/content-validation.ts';
import { COMBAT_OUTCOME_EFFECTS } from '../src/domain/combat-outcomes.ts';

function fixture():BattleCatalog {
  const catalog:BattleCatalog=JSON.parse(fs.readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8'));
  const enemy=structuredClone(catalog.enemies[0]);
  enemy.behavior={aggression:'active',awarenessRangeUnits:12,moveSpeedPxPerSecond:100,canMove:true,canTurn:true};
  const clips:BasicAttackBinding['clips']={north:'attack-north',south:'attack-south',east:'attack-east',west:'attack-west'};
  const idle=enemy.actor.clips['idle-south']!;
  for(const facing of ['north','south','east','west'] as const)
    for(const kind of ['idle','walk','attack'] as const)enemy.actor.clips[`${kind}-${facing}`]=idle;
  enemy.basicAttack={profileId:'enemy-test',clips};delete enemy.displayOnlyReason;
  const profile={...catalog.basicAttacks[catalog.classes[0].basicAttack.profileId],swings:[],impacts:[],projectile:null};
  delete profile.targetEffects;delete profile.transition;
  const attackEffects=Object.fromEntries([...COMBAT_OUTCOME_EFFECTS,...feedbackEffects(catalog.feedback)].map(name=>[name,catalog.attackEffects[name]]));
  return {...catalog,classes:[],skills:{},enemies:[enemy],basicAttacks:{'enemy-test':profile},attackEffects};
}

test('missing death and level-up resources are rejected before entering a scene',()=>{
  for(const name of COMBAT_OUTCOME_EFFECTS){
    const catalog=fixture();delete catalog.attackEffects[name];
    assert.throws(()=>parseBattle(catalog),new RegExp(`effects.${name}.default`));
  }
});

test('enemy content validates movement, directional attacks and effects before the scene starts',()=>{
  const catalog=fixture();assert.doesNotThrow(()=>parseBattle(catalog),'an enemy can have no generic impact effect');
  const missingWalk=structuredClone(catalog);delete missingWalk.enemies[0].actor.clips['walk-east'];assert.throws(()=>parseBattle(missingWalk),/行走动画缺失 east/);
  const missingAttack=structuredClone(catalog);delete missingAttack.enemies[0].actor.clips['attack-west'];assert.throws(()=>parseBattle(missingAttack),/普攻动画缺失/);
  const invalidSpeed=structuredClone(catalog);invalidSpeed.enemies[0].behavior.moveSpeedPxPerSecond=0;assert.throws(()=>parseBattle(invalidSpeed),/正的移动速度/);
  const missingEffect=structuredClone(catalog);missingEffect.basicAttacks['enemy-test'].targetEffects=[{effect:'missing',recipient:'target',placement:'attached'}];assert.throws(()=>parseBattle(missingEffect),/特效变体缺失/);
});

test('display-only records explain why they cannot attack, while fixed attackers need no walking clip',()=>{
  const catalog=fixture(),enemy=catalog.enemies[0];
  enemy.behavior.canMove=false;enemy.behavior.moveSpeedPxPerSecond=0;
  for(const facing of ['north','south','east','west'] as const)delete enemy.actor.clips[`walk-${facing}`];
  assert.doesNotThrow(()=>parseBattle(catalog));
  enemy.basicAttack=null;assert.throws(()=>parseBattle(catalog),/需要普攻/);
  enemy.behavior.aggression='none';assert.throws(()=>parseBattle(catalog),/说明原因/);
  enemy.displayOnlyReason='原版只提供场景物待机动作';assert.doesNotThrow(()=>parseBattle(catalog));
});

test('skill-only enemies validate explicit clips, event frames and unavailable bindings',()=>{
  const catalog=fixture(),enemy=catalog.enemies[0];enemy.basicAttack=null;
  enemy.skills=[{id:'storm',name:'落雷',clips:{north:'idle-north',south:'idle-south',east:'idle-east',west:'idle-west'},
    action:{requiresTarget:true,cooldownFrames:10,approachDistanceUnits:5,searchRadiusPx:100,transition:null,events:[{kind:'units',frame:0,cues:[]}]}}];
  assert.doesNotThrow(()=>parseBattle(catalog));
  const missing=structuredClone(catalog);delete missing.enemies[0].actor.clips['idle-east'];assert.throws(()=>parseBattle(missing),/动画缺失 east/);
  const invalid=structuredClone(catalog),skill=invalid.enemies[0].skills![0];
  if('action' in skill)skill.action.events[0].frame=999;
  assert.throws(()=>parseBattle(invalid),/触发帧越界/);
  enemy.skills.push({id:'absent',name:'缺失的动作',unavailableReason:'原版未匹配到动画'});
  assert.doesNotThrow(()=>parseBattle(catalog));
});

test('wander timing requires a whole native logic frame and a movable combat actor',()=>{
  const catalog=fixture(),enemy=catalog.enemies[0];
  enemy.behavior.wander={idleDurationMs:780};assert.doesNotThrow(()=>parseBattle(catalog));
  enemy.behavior.wander.idleDurationMs=781;assert.throws(()=>parseBattle(catalog),/完整逻辑帧/);
  enemy.behavior.wander.idleDurationMs=0;assert.throws(()=>parseBattle(catalog));
  enemy.behavior.wander.idleDurationMs=780;enemy.behavior.canMove=false;
  assert.throws(()=>parseBattle(catalog),/闲逛需要可移动/);
});

test('map-wide engagement requires an active enemy with an executable attack',()=>{
  const catalog=fixture(),enemy=catalog.enemies[0];
  enemy.behavior.engagement='map-wide';assert.doesNotThrow(()=>parseBattle(catalog));
  enemy.behavior.aggression='passive';assert.throws(()=>parseBattle(catalog),/全图参战需要主动型/);
  enemy.behavior.aggression='none';enemy.basicAttack=null;enemy.displayOnlyReason='展示角色';
  assert.throws(()=>parseBattle(catalog),/全图参战需要主动型/);
});

test('the hell pawn idle clips loop the seven source frames without a cut seam',()=>{
  const catalog:BattleCatalog=JSON.parse(fs.readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8'));
  const actor=catalog.enemies.find(enemy=>enemy.id==='enemy-hell-s-pawn-1')!.actor;
  for(const facing of ['north','south','east','west'] as const){
    const clip=actor.clips[`idle-${facing}`]!;
    assert.equal(clip.frames%7,0,`${facing} 待机帧数必须是 7 帧源循环的整数倍`);
    assert.deepEqual(clip.layers.map(layer=>layer.blend),['multiply','add']);
  }
});

test('the released catalog marks only the two existing combat Bosses for map-wide engagement',()=>{
  const catalog:BattleCatalog=JSON.parse(fs.readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8'));
  assert.deepEqual(catalog.enemies.filter(enemy=>enemy.behavior.engagement==='map-wide').map(enemy=>enemy.id).sort(),
    ['enemy-boss-skeleton-1','enemy-starving-boss-wolf-1']);
  for(const id of ['enemy-wolf-1','enemy-bat-1']){
    const enemy=catalog.enemies.find(enemy=>enemy.id===id)!;
    assert.equal(enemy.behavior.aggression,'passive');assert.equal(enemy.behavior.engagement,undefined);
  }
});
