import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { GAME_FRAME_TIMING, installFrameLimitClock } from '../src/application/game-timing.ts';

const require = createRequire(import.meta.url);
const TimeStep = require('../node_modules/phaser/src/core/TimeStep.js') as typeof Phaser.Core.TimeStep;

function fixture(t: test.TestContext, smoothStep = false) {
  let now = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { performance: { now: () => now }, cancelAnimationFrame() {} } });
  const loop = new TimeStep({} as Phaser.Game, { ...GAME_FRAME_TIMING, smoothStep });
  loop.raf.start = () => {};
  const restore = installFrameLimitClock(loop);
  const steps: { time: number; delta: number }[] = [];
  loop.start((time, delta) => steps.push({ time, delta }));
  const step = (delta: number) => { now += delta; loop.stepLimitFPS(now); };
  t.after(() => {
    restore(); loop.destroy();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  return { loop, steps, step, restore, skip: (delta: number) => { now += delta; } };
}

test('limited real TimeStep counts each millisecond once across refresh changes and long frames', t => {
  const f = fixture(t);
  for (const hz of [144, 90, 30, 120, 59.94, 60]) {
    for (let i = 0; i < hz * 2; i++) f.step(1000 / hz);
    f.step(80);
    f.step(600);
    const last = f.steps.at(-1)!;
    const elapsed = f.steps.reduce((sum, step) => sum + step.delta, 0);
    assert.ok(Math.abs(elapsed - last.time) < 1e-7, `${hz} Hz clock drift: ${elapsed} / ${last.time}`);
    assert.ok(f.steps.every(step => step.delta > 0), 'every delivered interval must advance time');
  }
});

test('focus and background recovery clear already-counted limiter remainder', t => {
  const f = fixture(t);
  f.step(20);
  f.skip(2000); f.loop.pause();
  f.skip(3000); f.loop.resume();
  f.step(20);
  f.skip(1000); f.loop.focus(); f.step(20);
  assert.deepEqual(f.steps.map(step => step.delta), [20, 20, 20]);
});

test('low refresh startup keeps real elapsed time while Phaser smooths its scheduling delta', t => {
  const f = fixture(t, true);
  for (let i = 0; i < 60; i++) f.step(1000 / 30);
  const last = f.steps.at(-1)!;
  assert.ok(Math.abs(f.steps.reduce((sum, step) => sum + step.delta, 0) - last.time) < 1e-7);
  assert.ok(last.time >= 1900, 'startup must advance approximately two real seconds');
});

test('restoring the adapter restores instance methods without changing other game loops', t => {
  const f = fixture(t), untouched = new TimeStep({} as Phaser.Game, GAME_FRAME_TIMING);
  assert.notEqual(f.loop.start, untouched.start);
  assert.notEqual(f.loop.resetDelta, untouched.resetDelta);
  f.restore();
  assert.equal(f.loop.start, untouched.start);
  assert.equal(f.loop.resetDelta, untouched.resetDelta);
  untouched.destroy();
});
