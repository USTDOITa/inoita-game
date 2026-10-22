import assert from 'node:assert/strict';
import test from 'node:test';
import {playthrough} from './helpers/story-playthrough.ts';
import {DEFAULT_ENEMY_RESPAWN_MS} from '../src/domain/session.ts';

// Isolated lawful entrance conditions; the main chapter run independently reaches this point.
const fixture=async()=>{
  const h=playthrough();
  h.session.applyStoryCommands([{type:'travel',destination:{map:'sealed-dungeon-1-3-3275afd4',x:216,y:328,facing:'north'}}]);
  h.session.accept('quest-325');await h.approach('npc-477');return h;
};
test('native event 373 ends and hands its live seal protector to actual combat; killing advances the quest',async()=>{
  const h=await fixture();let restored:ReturnType<typeof playthrough>|undefined;
  try{
    assert.ok(h.session.runtimeState.completedEvents.includes('event-373'));
    assert.equal(h.session.status('quest-326'),'active');
    const spawn=h.session.storyWorld.enemySpawns('sealed-dungeon-1-3-3275afd4').find(spawn=>spawn.enemyId==='enemy-elf-seal-protector-1')!;
    assert.ok(spawn);assert.deepEqual([spawn.x,spawn.y,spawn.respawn,spawn.mapVisit],[216,184,false,h.session.storyWorld.visit]);
    restored=playthrough(JSON.parse(JSON.stringify(h.session.captureState())));
    assert.deepEqual(restored.session.storyWorld.enemySpawns(spawn.map),[spawn]);
    await restored.defeat('enemy-elf-seal-protector-1');
    assert.equal(restored.session.status('quest-326'),'completed');
    assert.equal(restored.session.status('quest-327'),'ready');
    await restored.wait(DEFAULT_ENEMY_RESPAWN_MS);
    await assert.rejects(restored.defeat('enemy-elf-seal-protector-1'),/当前地图敌人/);
  }finally{h.director.dispose();restored?.director.dispose();}
});
test('the ordinary cinematic enemy is removed on leaving and is not rebuilt when returning',async()=>{
  const h=await fixture();
  try{
    h.session.applyStoryCommands([{type:'travel',destination:{map:'shadow-camp',x:24,y:24,facing:'south'}}]);
    h.session.applyStoryCommands([{type:'travel',destination:{map:'sealed-dungeon-1-3-3275afd4',x:216,y:328,facing:'north'}}]);
    assert.deepEqual(h.session.storyWorld.enemySpawns('sealed-dungeon-1-3-3275afd4'),[]);
    assert.ok(h.session.runtimeState.completedEvents.includes('event-373'));
  }finally{h.director.dispose();}
});
