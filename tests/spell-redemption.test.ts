import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleBuffEffect,BattleCatalog} from '../src/domain/battle.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {calculateManaCost} from '../src/domain/combat-resources.ts';

const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const skill=catalog.skills['spell-redemption'];
const unit=skill.action!.combatUnits![0] as {effect:'buff';buff:'spell-redemption';ranks:{strength:number;effect:BattleBuffEffect}[]};
const magicRates=[500,566,633,700,733,766,800,833];
const redCycle=[100,120,140,160,140,120,100];

test('eight ranks add the mana cost rate once and keep the red cycle under a 180 frame cap',()=>{
  assert.equal(skill.action!.usesSkillDamageBuff,true);
  unit.ranks.forEach((rank,index)=>{
    const effect=rank.effect;
    assert.deepEqual(effect.modifiers,[
      {attribute:'manaCostRate',operation:{kind:'add',amount:400}},
      {attribute:'conditionalMagicDamageRate',operation:{kind:'add',amount:magicRates[index]}}],`rank ${index+1}`);
    assert.equal(effect.simulationFrames?.lastActiveFrame,180);
    assert.equal(effect.durationMs,181*60);assert.equal(effect.maxStacks,1);
    assert.deepEqual(effect.appearanceColors,redCycle.map(red=>({red,green:0,blue:0})));
  });
});

test('the buff raises the shared mana cost rate and expires after the inclusive last frame',()=>{
  const conditions=new CombatConditions();
  assert.equal(calculateManaCost(10,conditions.attribute('hero','manaCostRate',1000),0),10);
  conditions.applyBuff('hero','spell-redemption',4003,unit.ranks[0]!.effect);
  assert.equal(conditions.attribute('hero','manaCostRate',1000),1400);
  assert.equal(calculateManaCost(10,conditions.attribute('hero','manaCostRate',1000),0),14);
  assert.equal(calculateManaCost(10,conditions.attribute('hero','manaCostRate',1000),250),11);
  conditions.update(180*60);
  assert.equal(conditions.hasBuff('hero','spell-redemption'),true);
  assert.equal(calculateManaCost(10,conditions.attribute('hero','manaCostRate',1000),0),14);
  // 上限是含端点的第 180 帧：第 181 步仍有效，第 182 步处理时才移除。
  conditions.update(60);
  assert.equal(conditions.hasBuff('hero','spell-redemption'),true);
  assert.equal(calculateManaCost(10,conditions.attribute('hero','manaCostRate',1000),0),14);
  conditions.update(60);
  assert.equal(conditions.hasBuff('hero','spell-redemption'),false);
  assert.equal(conditions.attribute('hero','manaCostRate',1000),1000);
  assert.equal(conditions.attribute('hero','conditionalMagicDamageRate',0),0);
});
