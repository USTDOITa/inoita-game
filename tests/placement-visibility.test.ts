import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateStoryCondition, type StoryConditionContext } from '../src/domain/story-condition.ts';
import type { Campaign } from '../src/domain/campaign.ts';

const campaign = JSON.parse(readFileSync(new URL('../public/content/campaign.json', import.meta.url), 'utf8')) as Campaign;
const context = (flags: ReadonlySet<string>): StoryConditionContext => ({
  questStatus: () => 'available', questCompletedCycles: () => 0,
  eventStatus: () => 'idle', choice: () => undefined, flag: id => flags.has(id), world: () => undefined
});

test('every placement declares its visibility and registered locations wait for their native flag', () => {
  for (const placement of campaign.placements) {
    assert.ok(placement.condition, `摆放点 ${placement.id} 缺少 condition`);
    if (!placement.id.startsWith('quest-npc-located-')) continue;
    assert.deepEqual(placement.condition, {type:'flag',flag:placement.id});
    assert.equal(evaluateStoryCondition(placement.condition,context(new Set())),false,placement.id);
    assert.equal(evaluateStoryCondition(placement.condition,context(new Set([placement.id]))),true,placement.id);
  }
});

test('native location registration is the source of visibility for opening quest NPCs', () => {
  for (const [script, characterId, map] of [
    ['event-1','npc-40','shadow-camp'],
    ['event-411','npc-55','sanctus-church'],
    ['event-8','npc-54','shadow-hall'],
    ['event-10','npc-126','training-dungeon-one'],
  ]) {
    const placement=campaign.placements.find(value=>value.characterId===characterId)!;
    assert.ok(placement,characterId);
    const commands=campaign.scripts[script].nodes.flatMap(node=>node.commands);
    assert.ok(commands.some(command=>command.type==='world'&&command.command.kind==='place'
      &&command.command.entity.id===placement.id&&command.command.entity.map===map),`${script}: ${characterId}`);
    assert.ok(commands.some(command=>command.type==='flag'&&command.flag===placement.id&&command.value!==false),`${script}: ${characterId}`);
  }
});

test('native unconditional NPC placements remain visible before and after registration flags change', () => {
  const placements=campaign.placements.filter(placement=>placement.condition.type==='always'&&placement.condition.value);
  assert.ok(placements.length>0);
  for(const placement of placements)for(const flags of [new Set<string>(),new Set(['quest-npc-located-npc-40'])])
    assert.equal(evaluateStoryCondition(placement.condition,context(flags)),true,placement.id);
});

test('the cave encounter declares separate native identities for the earl and guards', () => {
  const stage=campaign.scripts['event-4'].nodes.flatMap(node=>node.presentation).find(action=>action.type==='stage');
  assert.ok(stage?.type==='stage');
  assert.equal(stage.map,'silent-cave-depths');
  const members=stage.cast.filter(member=>['npc-109','npc-62','npc-63'].includes(member.characterId??''));
  assert.equal(members.length,3);
  assert.equal(new Set(members.map(member=>member.characterId)).size,3);
  const encounter=campaign.scripts['event-4'].nodes.find(node=>node.exit.type==='waitEncounter');
  assert.ok(encounter?.exit.type==='waitEncounter');
  assert.deepEqual(encounter.exit.encounter.spawns.map(spawn=>spawn.enemyId).sort(),
    ['enemy-earl-grafton-1','enemy-berkel-soldier-2','enemy-berkel-soldier-3'].sort());
});
