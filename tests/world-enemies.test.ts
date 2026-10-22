import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Session, DEFAULT_ENEMY_RESPAWN_MS } from '../src/domain/session.ts';
import { WorldEnemyRoster, encounterSpawnId } from '../src/domain/world-enemies.ts';
import type { WorldMap } from '../src/domain/content.ts';
import type { Campaign } from '../src/domain/campaign.ts';

const content=(name:string)=>JSON.parse(fs.readFileSync(new URL(`../public/content/${name}`,import.meta.url),'utf8'));
const campaign=content('campaign.json') as Campaign;

test('map enemy dies, remains absent across map visits, then respawns after game time',()=>{
  const session=new Session(campaign);
  const map=content('maps/shadow-forest-west.json') as WorldMap;
  const first=new WorldEnemyRoster(session,map,[],1);
  const spawn=first.spawns[0];
  assert.ok(spawn);
  session.setEnemyVitals(spawn.id,1,0);
  session.enemyDefeated(spawn);
  assert.deepEqual(first.refresh().removed,[spawn.id]);
  assert.equal(new WorldEnemyRoster(session,map,[],1).source(spawn.id)?.id,spawn.id);
  assert.equal(new WorldEnemyRoster(session,map,[],1).enemies.some(enemy=>enemy.key===spawn.id),false);
  session.advanceGameTime(DEFAULT_ENEMY_RESPAWN_MS-1);
  assert.equal(first.refresh().added.length,0);
  session.advanceGameTime(1);
  assert.deepEqual(first.refresh().added.map(enemy=>enemy.key),[spawn.id]);
  assert.deepEqual(session.enemyVitals(spawn.id),{});
});

test('mixed-level source map activates only the tier closest to the hero',()=>{
  const map=content('maps/shadow-training-dungeon1-5e8c19b4.json') as WorldMap;
  const session=new Session(campaign);
  for(const [level,expected] of [[1,3],[45,41],[90,103]]){
    const roster=new WorldEnemyRoster(session,map,[],level);
    assert.ok(roster.spawns.some(spawn=>spawn.tierLevel===expected));
    assert.ok(roster.spawns.every(spawn=>spawn.tierLevel===undefined||spawn.tierLevel===expected));
  }
});

test('native quest spirits use ordinary map spawns and deaths alone do not grant material',()=>{
  const quest={...campaign.quests.find(quest=>quest.id==='knight-uniform')!,availableWhen:{type:'always' as const,value:true}};
  const session=new Session({...campaign,quests:[quest],questGroups:[],events:[]});
  assert.equal(session.accept('knight-uniform'),true);
  const map=content('maps/shadow-training-dungeon-2-a6b8293b.json') as WorldMap;
  const roster=new WorldEnemyRoster(session,map,[],4);
  const spirits=roster.spawns.filter(spawn=>spawn.enemyId==='enemy-reagents-1');
  assert.equal(spirits.length,5);
  for(const spawn of spirits){
    session.enemyDefeated(spawn);
    assert.equal(session.canSpawnEnemy(spawn),false);
    assert.equal(session.enemyDefeated(spawn),false);
    assert.equal(roster.refresh().removed.includes(spawn.id),true);
  }
  assert.equal(session.itemCount('ectoplasm'),0,'death callbacks leave task material to actual drop and pickup');
  assert.equal(session.status('knight-uniform'),'active');
  session.advanceGameTime(DEFAULT_ENEMY_RESPAWN_MS);
  const returned=roster.refresh().added.map(enemy=>enemy.key);
  assert.ok(spirits.every(spawn=>returned.includes(spawn.id)));
});


test('map resources survive scene rebuilds while summoned instances stay local to the roster',()=>{
  const session=new Session(campaign),map=content('maps/shadow-forest-west.json') as WorldMap;
  const definitions=content('battle.json').enemies as import('../src/domain/battle.ts').EnemyDefinition[];
  const roster=new WorldEnemyRoster(session,map,[],1),spawn=roster.enemies[0];
  const definition=definitions.find(enemy=>enemy.id===spawn.enemyId)!;
  roster.setEnemyHealth(spawn.key,Math.trunc(definition.maxHealth/2),definition);
  roster.setEnemyMana(spawn.key,0,definition);
  const saved=roster.enemySnapshot(spawn.key,definition)!;
  const summon=roster.placeEnemy(definition.id,32,40);summon.summonedBy=spawn.key;
  roster.moveEnemy(summon.key,40,48);roster.setEnemyHealth(summon.key,1,definition);
  assert.deepEqual([summon.x,summon.y],[40,48]);
  assert.equal(roster.enemySnapshot(spawn.key,definition)!.health,saved.health);
  const restored=new WorldEnemyRoster(session,map,[],1);
  assert.deepEqual(restored.enemySnapshot(spawn.key,definition),saved);
  assert.equal(restored.enemies.some(enemy=>enemy.key===summon.key),false);
  roster.removeEnemy(summon.key);
  assert.equal(roster.enemySnapshot(summon.key,definition),undefined);
  assert.deepEqual(roster.enemySnapshot(spawn.key,definition),saved);
});

test('story encounter instances appear after a node commit, require every settled death and survive restoration',()=>{
  const session=new Session(campaign),map=content('maps/shadow-forest-west.json') as WorldMap;
  const roster=new WorldEnemyRoster(session,map,[],1),enemyId=roster.spawns[0].enemyId;
  const encounter={id:'earl-battle:run-1',map:map.id,status:'active' as const,spawns:[
    {id:'earl',enemyId,x:128,y:128},{id:'guard',enemyId,x:160,y:128}
  ]};
  session.applyStoryCommands([{type:'encounter',encounter}]);
  assert.deepEqual(roster.refresh().added.map(enemy=>enemy.key),encounter.spawns.map(spawn=>encounterSpawnId(encounter.id,spawn.id)));
  const earl=roster.source(encounterSpawnId(encounter.id,'earl'))!,guard=roster.source(encounterSpawnId(encounter.id,'guard'))!;
  session.setEnemyVitals(earl.id,0,0);
  assert.equal(roster.completedEncounters().length,0,'zero HP alone does not imply settled rewards');
  session.enemyDefeated(earl);
  assert.equal(roster.completedEncounters().length,0,'a surviving guard keeps the encounter active');
  session.enemyDefeated(guard);
  assert.deepEqual(roster.completedEncounters().map(encounter=>encounter.id),[encounter.id]);
  const state=session.captureState();session.restoreState(state);
  const restored=new WorldEnemyRoster(session,map,[],1);
  assert.equal(restored.enemies.some(enemy=>enemy.key===earl.id||enemy.key===guard.id),false);
  assert.equal(restored.completedEncounters()[0].id,encounter.id);
  session.applyStoryCommands([{type:'world',command:{kind:'encounter-result',id:encounter.id,result:'won'}}]);
  restored.refresh();assert.equal(restored.completedEncounters().length,0);
  session.advanceGameTime(DEFAULT_ENEMY_RESPAWN_MS*10);
  assert.equal(restored.refresh().added.some(enemy=>enemy.key===earl.id||enemy.key===guard.id),false);
});

test('a second encounter occurrence with the same cast owns fresh enemy resources',()=>{
  const session=new Session(campaign),map=content('maps/shadow-forest-west.json') as WorldMap;
  const roster=new WorldEnemyRoster(session,map,[],1),enemyId=roster.spawns[0].enemyId;
  const add=(id:string)=>session.applyStoryCommands([{type:'encounter',encounter:{id,map:map.id,status:'active',spawns:[{id:'earl',enemyId,x:128,y:128}]}}]);
  add('run-1');roster.refresh();session.enemyDefeated(roster.source(encounterSpawnId('run-1','earl'))!);
  session.applyStoryCommands([{type:'world',command:{kind:'encounter-result',id:'run-1',result:'won'}}]);
  add('run-2');
  assert.deepEqual(roster.refresh().added.map(enemy=>enemy.key),[encounterSpawnId('run-2','earl')]);
});
