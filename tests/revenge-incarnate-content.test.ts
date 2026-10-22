import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {BattleCatalog,SkillLoadout} from '../src/domain/battle.ts';
import {passiveModifiers} from '../src/domain/passive-skills.ts';

const battle=JSON.parse(readFileSync(new URL('../public/content/battle.json',import.meta.url),'utf8')) as BattleCatalog;
const damageRates=[65,85,105,125,135,145,155,165];

test('Revenge Incarnate keeps its constant chance separate from eight learned buff definitions',()=>{
  const skill=battle.skills['revenge-incarnate'];
  assert.deepEqual(skill.passiveUnits,[{attribute:'revengeChance',condition:'always',
    ranks:Array.from({length:8},()=>({kind:'add',amount:100}))}]);
  assert.deepEqual(skill.reactionsByRank,damageRates.map((amount,index)=>[{
    kind:'revenge-incarnate',buff:{key:'revenge-incarnate',rankPriority:[3003,3005,3007,3009,3010,3011,3012,3013][index],effect:{
      durationMs:5460,tickMs:0,maxStacks:5,simulationFrames:{lastActiveFrame:90},
      modifiers:[{attribute:'physicalDamageRate',operation:{kind:'add',amount}}],states:[],periodic:[],
    }},
  }]));
});

test('Revenge Incarnate chance comes only from the learned owners unconditional passive',()=>{
  for(let rank=1;rank<=8;rank++)for(const weapon of ['','dagger','longsword','axe','mace','shield','two-handed','bow','staff']){
    const loadout:SkillLoadout={levels:{'revenge-incarnate':rank}};
    assert.deepEqual(passiveModifiers(battle,'warrior',loadout,weapon),[
      {attribute:'revengeChance',operation:{kind:'add',amount:100}},
    ]);
  }
  assert.deepEqual(passiveModifiers(battle,'warrior',{levels:{}},'two-handed'),[]);
  assert.deepEqual(passiveModifiers(battle,'assassin',{levels:{'revenge-incarnate':8}},'two-handed'),[]);
});
