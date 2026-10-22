import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {EffectClip, EffectLayer, EffectOperation} from '../src/domain/content.ts';
import {EFFECT_FORMAT_VERSION,effectProblems,effectLayerProblem,layerDraw} from '../src/rendering/effect-colors.ts';

const root=path.dirname(fileURLToPath(import.meta.url));

function clip(layers: EffectLayer[],version=EFFECT_FORMAT_VERSION):EffectClip{
  return {version,frameWidth:8,frameHeight:8,frames:2,originX:.5,originY:.5,frameRate:60,mirrorX:false,layers};
}
const layer=(operations: EffectOperation[],blend: EffectLayer['blend']):EffectLayer=>({key:'probe',file:'assets/battle-effects/probe.png',operations,blend});

test('能直接混合的层给出混合方式，读背景的层带上整条滤镜链',()=>{
  assert.deepEqual(layerDraw(layer(['hard-light'],'multiply')),{kind:'blend',blend:'multiply'});
  assert.deepEqual(layerDraw(layer(['color-dodge'],'backdrop')),{kind:'backdrop',operations:['color-dodge']});
  assert.deepEqual(layerDraw(layer(['screen','color-dodge'],'backdrop')),{kind:'backdrop',operations:['screen','color-dodge']});
});

test('backdrop 层必须带可作用的运算',()=>{
  assert.throws(()=>layerDraw(layer([],'backdrop')),/没有可作用的运算/);
  assert.match(effectLayerProblem(clip([layer([],'backdrop')]),layer([],'backdrop')) ?? '',/没有可作用的运算/);
});

test('契约版本、运算名和绘制方式都参与能力检查',()=>{
  const good=clip([layer(['color-dodge'],'backdrop')]);
  assert.equal(effectProblems({ok:{clips:{default:good}}}).length,0);
  assert.match(effectProblems({old:{clips:{default:clip([layer(['screen'],'screen')],EFFECT_FORMAT_VERSION+1)}}})[0]!,/契约版本不匹配/);
  assert.match(effectProblems({odd:{clips:{default:clip([layer(['soft-light' as EffectOperation],'screen')])}}})[0]!,/未核实的颜色运算/);
});

test('正式资源里的每一层都能画',()=>{
  const battle=JSON.parse(fs.readFileSync(path.join(root,'../public/content/battle.json'),'utf8'));
  assert.deepEqual(effectProblems(battle.attackEffects),[]);
  const blends=new Set<string>();
  for(const effect of Object.values(battle.attackEffects) as {clips: Record<string, EffectClip>}[])
    for(const value of Object.values(effect.clips))
      for(const item of value.layers)blends.add(item.blend);
  // 颜色减淡只能走背景合成，素材里必须真的出现这一类。
  assert.ok(blends.has('backdrop'),'素材里应当有需要读背景的层');
});

/**
 * `world.json` 的剧情特效也来自同一个导出器。运算名与绘制方式是导出器
 * （`work/tools/game_content/blend.py` 的 `OPERATIONS`）与运行时之间的契约，
 * 这里逐层过一遍，就把它锁在出厂数据上：导出器改了名字而运行时没跟上，
 * 会在这里报「未核实的颜色运算」，而不是等到某个特效画错。
 */
test('剧情特效的每一层也都能画',()=>{
  const world=JSON.parse(fs.readFileSync(path.join(root,'../public/content/world.json'),'utf8'));
  assert.ok(Object.keys(world.storyEffects as object).length>0,'剧情特效不该是空的');
  assert.deepEqual(effectProblems(world.storyEffects),[]);
});
