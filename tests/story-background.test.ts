import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Campaign } from '../src/domain/campaign.ts';
import type { WorldIndex, WorldMap } from '../src/domain/content.ts';
import { StoryWorldState } from '../src/domain/story-world.ts';
import { stageBackground } from '../src/rendering/story-background.ts';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/content/${name}.json`, import.meta.url), 'utf8')) as T;
const world = read<WorldIndex>('world');
const campaign = read<Campaign>('campaign');
const map = read<WorldMap>('maps/training-dungeon-one');

test('stage background follows the formal world projection and skips owned props', () => {
  const state = new StoryWorldState();
  // 剧情把一名骑士标记为不在场；另一名临时士兵由剧情摆放出来。
  state.apply({ kind: 'remove-character', map: map.id, characterId: 'npc-376', all: true });
  state.apply({ kind: 'place', scope: 'visit', entity: {
    id: 'quest-npc-located-npc-62', map: map.id, actor: 'berkel-soldier-48d3f50d', characterId: 'npc-62', x: 328, y: 440
  } });
  const stage = { resetActors: false, cast: [{
    id: 'laiman', actor: 'story-lehman-90989efd', characterId: 'npc-59',
    worldEntityId: 'quest-npc-located-npc-59', x: 200, y: 408, facing: 'south' as const, visible: true
  }] };
  const background = stageBackground(map, stage, campaign, world.actors, state, () => true);
  const ids = new Set(background.characters.map(value => value.entity.id));
  assert.ok(ids.has('quest-npc-located-npc-62'), '剧情临时摆放的士兵要进背景');
  assert.ok(ids.has('quest-npc-npc-351'), '剧情摆放覆盖同身份的静态 NPC');
  assert.ok(ids.has('leap-gate-253891b2-000'), '没有被覆盖的静态物件保留');
  assert.ok(!ids.has('bounty-hunter-lars-ff7d92aa-012'), '静态 Lars 被剧情摆放覆盖');
  assert.ok(!ids.has('quest-npc-located-npc-59'), '舞台演员已经接管莱曼');
  assert.ok(!ids.has('treasure-box-a0caef88-004'), '宝箱有本局开启状态');
  assert.ok(!ids.has('well-7abb1f76-010'), '泉水有等级档位状态');
  assert.ok(!ids.has('berkel-castle-knight-28dd5010-005'), '剧情标记不在场的骑士不画');
  assert.ok(background.actorIds.has('berkel-soldier-48d3f50d'));
});
