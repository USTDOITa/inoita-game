import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { GameUI } from '../src/ui/game-ui.ts';

function harness(_t:TestContext) {
  const ui=new GameUI();ui.ready=true;ui.page='当前对白';
  ui.dialogueState={text:ui.page,start:0,readTo:0,skipped:false};
  let completed=0;ui.pending=()=>{completed++;};
  const pointer=(type:string,target='game-frame')=>{
    if(target==='choice')return;
    if(type==='pointerdown')ui.pressDialogue(1);
    if(type==='pointerup')ui.releaseDialogue(1);
    if(type==='pointercancel')ui.cancelPress(1);
  };
  return {ui,pointer,completed:()=>completed};
}
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test('screen pointer release reveals and advances dialogue without any browser click event', async t => {
  const h = harness(t);
  h.pointer('pointerdown'); h.pointer('pointerup'); await settle();
  assert.equal(h.ui.revealed, h.ui.page.length); assert.equal(h.completed(), 0);
  h.pointer('pointerdown'); h.pointer('pointerup'); await settle();
  assert.equal(h.completed(), 1); assert.equal(h.ui.pending, null);
});

test('cancelled touches, choice buttons, opening gestures and SKIP cannot advance a different page', async t => {
  const h = harness(t); h.ui.revealed = h.ui.page.length;
  h.pointer('pointerdown'); h.pointer('pointercancel'); h.pointer('pointerup'); await settle();
  h.pointer('pointerdown', 'choice'); h.pointer('pointerup', 'choice'); await settle();
  assert.equal(h.completed(), 0);
  h.ui.pending = null; h.pointer('pointerdown'); h.ui.pending = () => { throw new Error('opening tap consumed next page'); };
  h.pointer('pointerup'); await settle();
  h.ui.pending = () => {};
  h.pointer('pointerdown'); h.pointer('pointerup');
  h.ui.skipDialogue();
  // SKIP completes the old page before the delayed continuation handles release.
  h.ui.pending = () => { throw new Error('SKIP release consumed next page'); };
  await settle();
});
