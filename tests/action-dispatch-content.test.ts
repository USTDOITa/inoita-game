import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog,SkillAction} from '../src/domain/battle.ts';
import {parseBattle} from '../src/application/content-validation.ts';
import {skillEffectNames} from '../src/domain/skill-action.ts';
const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const units=(action:SkillAction)=>action.events.filter(event=>event.kind==='units');
const action=(id:string)=>catalog.skills[id].action!;

test('public actions carry per-dispatch stealth rules including stealth and direct-launch exceptions',()=>{
  const active=Object.values(catalog.skills).filter(skill=>skill.action);
  assert.equal(active.length,54);
  assert.equal(active.filter(skill=>units(skill.action!).some(event=>event.dispatch?.breaksStealth)).length,52);
  for(const skill of active)for(const event of units(skill.action!)){
    if(skill.id==='multiple-shot')assert.equal(event.dispatch,undefined);
    else assert.equal(event.dispatch?.breaksStealth,skill.id!=='whist');
  }
  assert.deepEqual(units(action('whist'))[0].dispatch,{breaksStealth:false,
    casterEffects:[{effect:'smoke-puff',recipient:'caster',placement:'attached'}],sound:'A_Skill_05'});
  assert.equal(action('multiple-shot').transition?.kind,'trace');
});

test('multihit tails belong to each dispatch while animation effects retain their order',()=>{
  const continuous=action('continuous-slash');
  assert.deepEqual(units(continuous).map(event=>event.frame),[1,7,11]);
  assert.deepEqual(continuous.events.slice(0,2).map(event=>event.kind),['units','swing']);
  for(const event of units(continuous))assert.deepEqual(event.dispatch,{breaksStealth:true,sound:'Wa_Anger_Rush'});
  assert.deepEqual(units(action('swirling-storm')).map(event=>event.frame),[3,6,9,12,15]);
  for(const [id,frame,vibrationMs,sound] of [['firestorm',11,150,'Bn_Flame_Storm'],['sword-of-hell',10,300,'Bn_Hell_Sword']] as const){
    assert.deepEqual(action(id).events.map(event=>[event.kind,event.frame]),[['swing',0],['units',frame]]);
    assert.deepEqual(units(action(id))[0].dispatch,{breaksStealth:true,shake:true,vibrationMs,sound});
  }
  const curse=units(action('curse-of-screams'))[0].dispatch!;
  assert.deepEqual(curse.casterEffects?.map(effect=>effect.effect),['curse-wind-ring','curse-shockwave']);
  assert.equal(curse.shake,true);assert.equal(curse.vibrationMs,150);assert.equal(curse.sound,'Bn_Curse_Yell');
  assert.ok(skillEffectNames(action('curse-of-screams')).includes('curse-shockwave'));
  assert.deepEqual(units(action('celestial-lightning'))[0].dispatch,{breaksStealth:true,sound:'Pr_Lightning'});
  assert.deepEqual(action('shield-bash').events.map(event=>event.kind),['units','impact']);
});

test('zero-unit recovery and summons retain an entry without making unreachable meteor events live',()=>{
  const wolf=catalog.enemies.find(enemy=>enemy.id==='enemy-black-wolf-1')!;
  const recovery=wolf.skills!.find(skill=>skill.id==='monster-venom-bite')!;
  assert.ok('action' in recovery);if(!('action' in recovery))throw new Error('Missing recovery action');
  assert.deepEqual(units(recovery.action)[0],{kind:'units',frame:7,cues:[],dispatch:{breaksStealth:true,
    casterEffects:[{effect:'monster-recovery-aura',recipient:'caster',placement:'attached'},
      {effect:'monster-regeneration-aura',recipient:'caster',placement:'attached'}]}});
  const summons=catalog.enemies.flatMap(enemy=>enemy.skills??[]).flatMap(skill=>'action' in skill?skill.action.events:[])
    .filter(event=>event.kind==='summon');
  assert.ok(summons.length>0);for(const summon of summons)assert.deepEqual(summon.dispatch,{breaksStealth:true});
  const shadow=catalog.enemies.find(enemy=>enemy.id==='enemy-shadow-of-darkness-1')!;
  const meteor=shadow.skills!.find(skill=>skill.id==='monster-greater-meteor')!;
  assert.ok('action' in meteor);if('action' in meteor)assert.equal(units(meteor.action).length,0);
});

test('player and monster basic profiles preserve distinct action-entry rules',()=>{
  for(const character of catalog.classes)assert.deepEqual(catalog.basicAttacks[character.basicAttack.profileId].dispatch,{breaksStealth:true});
  assert.deepEqual(catalog.basicAttacks['monster-snake-cycle-20-strike-4'].dispatch,{breaksStealth:false});
  assert.deepEqual(catalog.basicAttacks['monster-melee-cycle-15-strike-6'].dispatch,{breaksStealth:true});
  assert.equal(Object.values(catalog.basicAttacks).every(profile=>profile.dispatch!==undefined),true);
});

test('dispatch validation rejects absent stealth decisions, target recipients and missing assets',()=>{
  const malformed=structuredClone(catalog),event=units(malformed.skills['curse-of-screams'].action!)[0];
  Reflect.deleteProperty(event.dispatch!,'breaksStealth');assert.throws(()=>parseBattle(malformed),/breaksStealth/);
  event.dispatch!.breaksStealth=true;
  Reflect.set(event.dispatch!.casterEffects![0],'recipient','target');assert.throws(()=>parseBattle(malformed),/recipient/);
  event.dispatch!.casterEffects![0].recipient='caster';
  event.dispatch!.casterEffects![0].effect='missing-dispatch-effect';assert.throws(()=>parseBattle(malformed),/missing-dispatch-effect/);
  const basic=structuredClone(catalog);
  basic.basicAttacks[basic.classes[0].basicAttack.profileId].dispatch!.casterEffects=[{effect:'missing-basic-effect',recipient:'caster',placement:'attached'}];
  assert.throws(()=>parseBattle(basic),/missing-basic-effect/);
});
