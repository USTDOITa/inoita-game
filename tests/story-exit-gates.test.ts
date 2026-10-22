import assert from 'node:assert/strict';
import test from 'node:test';
import {ExitTrigger,overlapsFootRect} from '../src/domain/navigation.ts';

test('a locked story exit remains armed and triggers once after its condition becomes true',()=>{
  const exit={id:'gate',x:64,y:16,width:32,height:32},trigger=new ExitTrigger([exit],{x:8,y:32});
  const inside={x:80,y:32};let unlocked=false;
  assert.equal(trigger.update(inside,true,()=>unlocked),null);
  assert.equal(trigger.update(inside,true,()=>unlocked),null);
  unlocked=true;assert.equal(trigger.update(inside,true,()=>unlocked),exit);
  assert.equal(trigger.update(inside,true,()=>unlocked),null);
  trigger.update({x:32,y:32},true,()=>unlocked);
  assert.equal(trigger.update(inside,true,()=>unlocked),exit);
});

test('a locked exit cannot shadow an overlapping available exit',()=>{
  const closed={id:'closed',x:64,y:16,width:32,height:32},open={...closed,id:'open'};
  const trigger=new ExitTrigger([closed,open],{x:8,y:32});
  assert.equal(trigger.update({x:80,y:32},true,exit=>exit.id==='open'),open);
});

test('a region event sharing the doorway cell is reached before the exit teleports the player',()=>{
  // 事件 1 的原版矩形与营地东侧去丛林西的四个出口格完全重合（findings 96）：走位时
  // 两种判定必须同粒度（原版都按角色碰撞盒，findings 49），否则身体刚探进门口格时只有出口成立，
  // 玩家被先传送走，演出与它接取的任务一起被跳过。
  // 这里按 world-scene 的顺序复现：先区域、命中即返回，再出口。
  const exit={id:'camp-east',x:384,y:336,width:16,height:16},region={x:384,y:304,width:16,height:64};
  const trigger=new ExitTrigger([exit],{x:200,y:344});
  const stepTo=(x:number)=>{const point={x,y:344};
    if(overlapsFootRect(point,region))return 'event';
    return trigger.update(point,true)===exit?'exit':null;};
  assert.equal(stepTo(376),null,'身体还没探到门口：既不开演，也不传送');
  assert.equal(stepTo(378),'event','身体探进门口格：演出先于传送');
});

test('ordinary entry spawn still requires leaving the open doorway before returning',()=>{
  const exit={id:'gate',x:64,y:16,width:32,height:32},inside={x:80,y:32};
  const trigger=new ExitTrigger([exit],inside);
  assert.equal(trigger.update(inside,true,()=>true),null);
  trigger.update({x:32,y:32},true,()=>true);
  assert.equal(trigger.update(inside,true,()=>true),exit);
});
