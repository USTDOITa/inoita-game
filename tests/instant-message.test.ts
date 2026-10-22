import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTANT_MESSAGE_MS, InstantMessage, instantMessageAlpha, instantMessagePoint } from '../src/ui/instant-message.ts';

test('instant message keeps the original 30-frame life and fades in three steps',()=>{
  assert.equal(INSTANT_MESSAGE_MS,1800);
  assert.equal(instantMessageAlpha(INSTANT_MESSAGE_MS),1);
  assert.equal(instantMessageAlpha(240),1);
  assert.equal(instantMessageAlpha(180),.75);
  assert.equal(instantMessageAlpha(120),.5);
  assert.equal(instantMessageAlpha(60),.25);
  assert.equal(instantMessageAlpha(1),.25);
  assert.equal(instantMessageAlpha(0),0);
  assert.equal(instantMessageAlpha(-60),0);
});

test('instant message sits at the horizontal centre and three tenths down the screen',()=>{
  assert.deepEqual(instantMessagePoint(960,640),{x:480,y:192});
  assert.deepEqual(instantMessagePoint(844,390),{x:422,y:117});
});

test('instant message expires on its own and a later one restarts the clock',()=>{
  const message=new InstantMessage();
  assert.equal(message.text,'');assert.equal(message.alpha,0);
  message.show('生命值正在缓慢的恢复。');
  assert.equal(message.text,'生命值正在缓慢的恢复。');assert.equal(message.alpha,1);
  message.tick(600);assert.equal(message.alpha,1);
  message.show('泉水中出现了怪物。');
  message.tick(INSTANT_MESSAGE_MS-59);
  assert.equal(message.text,'泉水中出现了怪物。');assert.equal(message.alpha,.25);
  message.tick(59);
  assert.equal(message.text,'');assert.equal(message.alpha,0);
  message.tick(600);assert.equal(message.text,'');
});
