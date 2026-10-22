import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type Phaser from 'phaser';
import type { CharacterVisual } from '../src/rendering/characters.ts';

// `setCharacterClip` 只在需要 Phaser 的显示对象，替身足够。
const hook = registerHooks({ resolve(specifier, context, next) { return specifier === 'phaser'
  ? { url: 'data:text/javascript,export default {BlendModes:{NORMAL:0,SCREEN:1,ADD:2,MULTIPLY:3}}', shortCircuit: true }
  : next(specifier, context); } });
const { setCharacterClip } = await import('../src/rendering/characters.ts');
hook.deregister();

const clip = (key: string) => ({ frameWidth: 1, frameHeight: 1, frames: 3, originX: 0, originY: 0, frameRate: 10,
  mirrorX: false, layers: [{ key, file: 'unused.png', blend: 'normal' }] });

test('story poses play once so the completion event can settle them', () => {
  const created: { key: string; repeat: number }[] = [];
  const scene = {
    anims: {
      exists: () => false,
      create: (definition: { key: string; repeat: number }) => { created.push({ key: definition.key, repeat: definition.repeat }); return definition; },
      generateFrameNumbers: () => [],
    },
    add: { sprite: () => ({ anims: { timeScale: 1 }, setOrigin() { return this; }, setBlendMode() { return this; },
      setScale() { return this; }, play() {}, destroy() {} }) },
  } as unknown as Phaser.Scene;
  const visual = {
    entity: { actor: 'kiyan', flip: false },
    actor: { clips: { 'cry-south': clip('cry-south'), 'look-around-south': clip('look-around-south'),
      'idle-south': clip('idle-south'), 'walk-south': clip('walk-south') } },
    container: { addAt() {} }, layers: [], clipName: null,
  } as unknown as CharacterVisual;
  for (const name of ['cry-south', 'look-around-south', 'idle-south', 'walk-south'] as const) setCharacterClip(scene, visual, name, true);
  // 剧情姿态和其它动作类动画一样播一次（`repeat: 0`），这样播完才会来 `animationcomplete`——
  // 呈现端按演出动作的 `hold` 决定那时停在末帧还是回待机。待机与行走继续循环。
  assert.deepEqual(created, [
    { key: 'cry-south', repeat: 0 }, { key: 'look-around-south', repeat: 0 },
    { key: 'idle-south', repeat: -1 }, { key: 'walk-south', repeat: -1 },
  ]);
});
