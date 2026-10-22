import assert from 'node:assert/strict';
import test from 'node:test';
import { playthrough } from './helpers/story-playthrough.ts';

test('travel routes around the closed fortress shortcut without removing its gate',async()=>{
  const h=playthrough();try{
    h.session.applyStoryCommands([{type:'travel',destination:{map:'drow-fortress-1-b648f447',x:552,y:472,facing:'north'}}]);
    await h.travel('drow-fortress-3-ed91ddeb');
    assert.equal(h.session.storyWorld.currentLocation?.map,'drow-fortress-3-ed91ddeb');
    assert(h.entities().some(e=>e.characterId==='npc-120'));
    await h.travel('drow-fortress-1-b648f447');
    assert(h.entities().some(e=>e.characterId==='npc-120'));
  }finally{h.director.dispose();}
});

/**
 * 开场门口的竞争：事件 1 的原版矩形与营地去丛林西的四个出口格完全重合（findings 96），
 * 走位时两种判定必须同粒度、且区域先判，否则玩家会在门口被直接传送走，
 * 演出和它接取的「刺杀格里普顿伯爵」一起被跳过（复核报告 F-01）。
 *
 * 这条用例的价值在于它走的是真实触发层：`region()` 只负责把玩家走到位，
 * 触发出 `world-scene` 的 `afterMovement` 决定。
 */
test('walking out of the camp plays Darius orders before the doorway teleports the player', async () => {
  const h = playthrough();
  try {
    assert.equal(h.session.storyWorld.currentLocation?.map, 'shadow-camp', '新游戏从营地开始');
    assert.notEqual(h.session.status('grafton-mission'), 'active', '伯爵任务还没接');

    await h.region('event-1');

    assert.notEqual(h.director.runtime.eventStatus('event-1'), 'idle', '演出由场景上报');
    assert.equal(h.session.status('grafton-mission'), 'active', '演出接下了「刺杀格里普顿伯爵」');
  } finally {
    h.director.dispose();
  }
});
