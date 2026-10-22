import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog,SkillAction} from '../src/domain/battle.ts';
import {parseBattle} from '../src/application/content-validation.ts';
const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
// Independently checked native table durations; skill ranks do not change this action field.
const expectedFrames:Record<string,number>={
  "dark-strike": 90,
  "phantom-clash": 60,
  "curse-of-screams": 90,
  "shield-bash": 120,
  "firestorm": 60,
  "sword-of-hell": 60,
  "demon-s-shield": 450,
  "guardian-of-darkness": 450,
  "molten-armor": 450,
  "continuous-slash": 60,
  "spiritual-blade": 270,
  "poison-touch": 450,
  "assassin-s-sword": 120,
  "dark-attack": 60,
  "freeze-extreme": 90,
  "whist": 180,
  "blade-deflection": 450,
  "energy-bodhi": 450,
  "touch-of-agony": 90,
  "blood-curse": 60,
  "fire-offering": 120,
  "pain-overture": 120,
  "summon-hellfire": 60,
  "spell-redemption": 450,
  "hell-s-pawn": 270,
  "summon-bard": 450,
  "monster-s-scream": 90,
  "prayer-of-recovery": 60,
  "apostles-of-light": 450,
  "light-command": 450,
  "celestial-armor": 450,
  "blinding-flash": 180,
  "holy-sacrifice": 450,
  "divine-strike": 60,
  "hammer-of-wrath": 90,
  "celestial-lightning": 60,
  "multiple-shot": 90,
  "aimed-shot": 60,
  "ambush": 450,
  "net-shackles": 120,
  "spiritual-arrow": 120,
  "rampage": 90,
  "beast-companion": 270,
  "spirit-of-nature": 180,
  "survival-instinct": 450,
  "rush-of-anger": 60,
  "shouts-of-threat": 90,
  "armor-penetration": 270,
  "giant-blow": 120,
  "weapon-hitback": 120,
  "swirling-storm": 90,
  "blood-thirst": 450,
  "storm-of-frenzy": 450,
  "enrage": 450
};

test('all 54 public actions retain the native duration at each of their eight ranks',()=>{
  const active=Object.values(catalog.skills).filter(skill=>skill.action);
  assert.deepEqual(active.map(skill=>skill.id).sort(),Object.keys(expectedFrames).sort());
  for(const skill of active){
    assert.equal(skill.ranks.length,8,skill.id);
    assert.equal('cooldownMs' in skill.action!,false,skill.id);
    for(const rank of skill.ranks)assert.equal(skill.action!.cooldownFrames,expectedFrames[skill.id],`${skill.id} rank ${rank.level}`);
  }
  assert.equal(catalog.skills['dark-strike'].action!.cooldownFrames*60,5400);
  assert.equal(catalog.skills['sword-of-hell'].action!.cooldownFrames*60,3600);
});

test('equipment alternatives and every playable enemy action use integer frame durations',()=>{
  const wardrobe=JSON.parse(readFileSync(new URL('../public/content/wardrobe.json',import.meta.url),'utf8')) as {
    skillStances:Record<string,Record<string,{actions:Record<string,SkillAction|null>}>>};
  let alternatives=0;
  for(const stances of Object.values(wardrobe.skillStances))for(const changes of Object.values(stances)){
    for(const [id,action] of Object.entries(changes.actions))if(action){
      assert.equal(action.cooldownFrames,expectedFrames[id],id);assert.equal('cooldownMs' in action,false);alternatives++;
    }
  }
  assert.ok(alternatives>0);
  let enemies=0;
  for(const enemy of catalog.enemies)for(const skill of [...enemy.skills??[],...enemy.commandAction?[enemy.commandAction]:[]]){
    if(!('action' in skill))continue;
    assert.equal('cooldownMs' in skill.action,false,skill.id);
    assert.ok(Number.isInteger(skill.action.cooldownFrames)&&skill.action.cooldownFrames>=0,skill.id);enemies++;
  }
  assert.ok(enemies>0);
});

test('content requires a nonnegative whole frame count and accepts a zero-duration action',()=>{
  for(const value of [-1,1.5,NaN]){
    const data=structuredClone(catalog);data.skills['firestorm'].action!.cooldownFrames=value;
    assert.throws(()=>parseBattle(data),/cooldownFrames/);
  }
  const zero=structuredClone(catalog);zero.skills['firestorm'].action!.cooldownFrames=0;
  assert.doesNotThrow(()=>parseBattle(zero));
  Reflect.deleteProperty(zero.skills['firestorm'].action!,'cooldownFrames');
  Reflect.set(zero.skills['firestorm'].action!,'cooldownMs',4000);
  assert.throws(()=>parseBattle(zero),/cooldown/);
});
