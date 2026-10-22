import assert from 'node:assert/strict';
import test from 'node:test';
import {ActionPressGate} from '../src/ui/action-press-gate.ts';

test('one action button holds the press gate until its own pointer is released',()=>{
  const gate=new ActionPressGate();
  assert.equal(gate.press(1),true);
  assert.equal(gate.press(2),false,'第二个动作按钮按下被忽略');
  gate.release(2);
  assert.equal(gate.press(3),false,'被忽略的 pointer 释放不能清门');
  gate.release(1);
  assert.equal(gate.press(2),true,'持有者释放后可以接受新的按压');
  gate.reset();
  assert.equal(gate.press(4),true,'显式重置立即清门');
});
