import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog} from '../src/domain/battle.ts';
import {passiveModifiers} from '../src/domain/passive-skills.ts';
import {CombatConditions} from '../src/domain/combat-conditions.ts';
import {calculateEffectiveDefense} from '../src/domain/physical-hit.ts';
const catalog=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const modifiers=(level:number,weapon='unarmed')=>passiveModifiers(catalog,'dark-knight',
  {levels:{'improved-defense':level}},weapon);

test('all eight learned ranks increase raw defense and add evasion without a cast or weapon gate',()=>{
  const defense=[61,101,161,241,261,281,301,321],evasion=[15,25,40,60,65,70,75,80];
  for(let rank=1;rank<=8;rank++)for(const weapon of ['unarmed','dagger','longsword','axe','mace','two-handed','orb','staff','bow','crossbow']){
    const passive=modifiers(rank,weapon),conditions=new CombatConditions();
    assert.deepEqual(passive,[{attribute:'defense',operation:{kind:'increase-thousandth',ratePerThousand:defense[rank-1]}},
      {attribute:'evasionBonus',operation:{kind:'add',amount:evasion[rank-1]}}]);
    assert.equal(conditions.attribute('knight','defense',100,passive),Math.trunc(100*(1000+defense[rank-1])/1000));
    assert.equal(conditions.attribute('knight','evasionBonus',100,passive),100+evasion[rank-1]);
    assert.deepEqual(conditions.snapshot('knight'),[]);
  }
});

test('learning changes the owner next calculation and each defense stage truncates separately',()=>{
  const conditions=new CombatConditions();
  assert.deepEqual(modifiers(0),[]);
  assert.equal(conditions.attribute('knight','defense',100,modifiers(1)),106);
  assert.equal(conditions.attribute('knight','defense',100,modifiers(8)),132);
  assert.equal(conditions.attribute('other','defense',100,modifiers(0)),100);
  const unit=catalog.skills['guardian-of-darkness'].action!.combatUnits![0];
  assert.equal(unit.effect,'buff');if(unit.effect!=='buff')return;
  conditions.applyBuff('knight',unit.buff,unit.ranks[0].strength,unit.ranks[0].effect,'other');
  const raw=conditions.attribute('knight','defense',100,modifiers(1));
  assert.equal(raw,174);assert.equal(calculateEffectiveDefense(raw,500),261);
  assert.equal(conditions.attribute('other','defense',100,modifiers(0)),100);
});
