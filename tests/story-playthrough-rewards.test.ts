import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {playthrough} from './helpers/story-playthrough.ts';
import {calculateEnemy} from '../src/domain/enemy-stats.ts';
import {DEFAULT_ENEMY_RESPAWN_MS} from '../src/domain/session.ts';
import type {EnemyDefinition} from '../src/domain/battle.ts';

const read=(name:string)=>JSON.parse(readFileSync(new URL('../public/content/'+name+'.json',import.meta.url),'utf8'));
const wolf:EnemyDefinition=read('battle').enemies.find((enemy:EnemyDefinition)=>enemy.id==='enemy-wolf-1');
const thresholds:number[]=read('character-stats').experience;
const total=(player:{level:number;experience:number})=>thresholds.slice(0,player.level-1).reduce((sum,value)=>sum+value,0)+player.experience;
const fixture=()=>{
  const h=playthrough();
  h.session.applyStoryCommands([{type:'travel',destination:{map:'shadow-forest-west',x:120,y:312,facing:'south'}}]);
  return h;
};

test('playthrough kills settle normal combat XP once per spawn and naturally cross a level boundary',async()=>{
  const h=fixture(),hero=h.session.hero!,initialLevel=hero.level;
  try{
    for(let cycle=0;cycle<6;cycle++){
      for(let kill=0;kill<3;kill++){
        const before=total(hero.player),expected=calculateEnemy(wolf,{playerLevel:hero.level,partySize:1}).experience;
        await h.defeat(wolf.id);
        assert.equal(total(hero.player)-before,expected);
      }
      const settled=total(hero.player);
      await assert.rejects(h.defeat(wolf.id),/当前地图敌人/);
      assert.equal(total(hero.player),settled,'an already defeated spawn cannot settle XP again');
      if(cycle<5)await h.wait(DEFAULT_ENEMY_RESPAWN_MS);
    }
    assert.ok(hero.level>initialLevel,'ordinary kills and natural respawns earn enough XP to level up');
  }finally{h.director.dispose();}
});

test('companion kills use living party count and the existing party XP distribution',async()=>{
  const h=fixture(),hero=h.session.hero!,party=h.session.party!;
  try{
    const caster=party.joinStory('mercenary-portia'),fallen=party.joinStory('mercenary-olaf');
    fallen.setHealth(0);assert.equal(party.activeSize,3);assert.equal(party.livingIds.length,2);
    assert.equal(party.switchControl(caster.id),true);
    const beforeHero=total(hero.player),beforeCaster=total(caster.player),beforeFallen=total(fallen.player);
    const reward=calculateEnemy(wolf,{playerLevel:hero.level,partySize:2}).experience;
    const expected=Math.floor(reward*(1000+(party.groupModifiers().experience??0))/1000);
    await h.defeat(wolf.id);
    assert.equal(total(hero.player)-beforeHero,expected);
    assert.equal(total(caster.player)-beforeCaster,expected);
    assert.equal(total(fallen.player),beforeFallen,'fallen active members do not receive combat XP');
  }finally{h.director.dispose();}
});
