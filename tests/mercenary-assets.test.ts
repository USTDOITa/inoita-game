import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { BattleCatalog } from '../src/domain/battle.ts';
import type { WorldIndex } from '../src/domain/content.ts';
import type { CompanionCatalog } from '../src/domain/party.ts';
import type { WardrobeCatalog } from '../src/domain/wardrobe.ts';

// 素材清单是纯函数，但所在渲染模块会加载 Phaser；Node 里用最小替身顶掉。
const hook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'phaser'
      ? { url: 'data:text/javascript,export default {Scene:class{},Physics:{Arcade:{Body:class{}}},BlendModes:{NORMAL:0,ADD:1,MULTIPLY:2,SCREEN:3}}', shortCircuit: true }
      : next(specifier, context);
  }
});
const { mercenaryCombatAssets } = await import('../src/rendering/combat-assets.ts');
hook.deregister();

const read=<T>(name:string):T=>JSON.parse(readFileSync(new URL(`../public/content/${name}.json`,import.meta.url),'utf8'));
const battle=read<BattleCatalog>('battle'),wardrobe=read<WardrobeCatalog>('wardrobe'),
  companions=read<CompanionCatalog>('companions'),world=read<WorldIndex>('world');

test('all mercenary candidates are preloaded as one deduplicated asset set',()=>{
  const assets=mercenaryCombatAssets(battle,wardrobe,companions,world);
  const keys=new Set(assets.map(asset=>asset.key));
  assert.equal(keys.size,assets.length,'贴图键需要去重');
  const actors=new Set(Object.values(companions.definitions).map(definition=>definition.actor));
  assert.equal(actors.size,41);
  for(const actor of actors)for(const layer of world.actors[actor]!.clips['idle-south']!.layers)
    assert.ok(keys.has(layer.key),`${actor} 的待机图层应包含在首次加载集合中`);
  assert.ok(assets.length>2000,`佣兵素材规模异常：${assets.length}`);
});
