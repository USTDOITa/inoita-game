import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { BattleCatalog } from '../src/domain/battle.ts';
import type { WorldIndex } from '../src/domain/content.ts';
import type { CompanionCatalog } from '../src/domain/party.ts';
import type { WardrobeCatalog } from '../src/domain/wardrobe.ts';
import { residentCombatAssets } from '../src/rendering/resident-combat-assets.ts';

const read=<T>(name:string):T=>JSON.parse(readFileSync(new URL(`../public/content/${name}.json`,import.meta.url),'utf8'));
const battle=read<BattleCatalog>('battle'),wardrobe=read<WardrobeCatalog>('wardrobe'),
  companions=read<CompanionCatalog>('companions'),world=read<WorldIndex>('world');

test('all mercenary candidates are preloaded as one deduplicated asset set',()=>{
  const pack=residentCombatAssets({battle,wardrobe,world,companions});
  const keys=new Set(pack.assets.map(asset=>asset.key));
  assert.equal(keys.size,pack.assets.length,'贴图键需要去重');
  const actors=new Set(Object.values(companions.definitions).map(definition=>definition.actor));
  assert.equal(actors.size,41);
  for(const actor of actors)for(const layer of world.actors[actor]!.clips['idle-south']!.layers)
    assert.ok(keys.has(layer.key),`${actor} 的待机图层应包含在首次加载集合中`);
  assert.ok(pack.assets.length>2000,`常驻战斗素材规模异常：${pack.assets.length}`);
});
