import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStoryCondition, storyConditionReferences, type StoryCondition, type StoryConditionContext } from '../src/domain/story-condition.ts';

const context: StoryConditionContext = {
  questStatus: id => id === 'active' ? 'active' : id === 'ready' ? 'ready' : id === 'done' ? 'completed' : 'available',
  questCompletedCycles: id => id === 'repeat' ? 2 : 0,
  eventStatus: id => id === 'encounter' ? 'waiting' : 'completed',
  choice: id => id === 'offer' ? 'accept' : undefined,
  flag: id => id === 'opened', world: key => key === 'gate' ? true : key === 'branch' ? 'north' : undefined,
};

test('shared conditions combine quest, event, choice, flags and world state without side effects', () => {
  const condition: StoryCondition = { type: 'all', conditions: [
    { type: 'quest', quest: 'active', status: 'accepted' }, { type: 'event', event: 'encounter', status: 'waiting' },
    { type: 'choice', choice: 'offer', value: 'accept' }, { type: 'flag', flag: 'opened' },
    { type: 'world', key: 'gate', value: true }, { type: 'not', condition: { type: 'world', key: 'branch', value: 'south' } },
    { type: 'any', conditions: [{ type: 'quest', quest: 'ready', status: 'ready' }, { type: 'always', value: false }] },
  ] };
  assert.equal(evaluateStoryCondition(condition, context), true);
  assert.equal(evaluateStoryCondition({ type: 'not', condition }, context), false);
  assert.equal(evaluateStoryCondition({ type: 'flag', flag: 'missing', value: false }, context), true);
});

test('accepted and settled distinguish running, ready, completed and repeated history', () => {
  for (const quest of ['active', 'ready', 'done']) assert.equal(evaluateStoryCondition({ type: 'quest', quest, status: 'accepted' }, context), true);
  assert.equal(evaluateStoryCondition({ type: 'quest', quest: 'available', status: 'accepted' }, context), false);
  assert.equal(evaluateStoryCondition({ type: 'quest', quest: 'repeat', status: 'settled' }, context), true);
  assert.equal(evaluateStoryCondition({ type: 'quest', quest: 'active', status: 'settled' }, context), false);
  assert.equal(evaluateStoryCondition({ type: 'quest', quest: 'done', status: 'settled' }, context), true);
});

test('world values compare exactly, missing choices fail and empty any is false', () => {
  assert.equal(evaluateStoryCondition({ type: 'world', key: 'gate', value: 1 }, context), false);
  assert.equal(evaluateStoryCondition({ type: 'choice', choice: 'missing', value: 'accept' }, context), false);
  assert.equal(evaluateStoryCondition({ type: 'any', conditions: [] }, context), false);
  assert.equal(evaluateStoryCondition({ type: 'all', conditions: [] }, context), true);
  assert.equal(evaluateStoryCondition(undefined, context), true);
});

test('reference indexing visits both sides of conditional expressions without evaluating them', () => {
  const references = storyConditionReferences({ type: 'all', conditions: [
    { type: 'always', value: false }, { type: 'quest', quest: 'first', status: 'completed' },
    { type: 'not', condition: { type: 'quest', quest: 'first', status: 'active' } },
    { type: 'any', conditions: [{ type: 'event', event: 'battle', status: 'completed' }, { type: 'choice', choice: 'choice', value: 'x' }] },
    { type: 'flag', flag: 'flag' }, { type: 'world', key: 'door', value: true },
  ] });
  assert.deepEqual([...references.quests], ['first']); assert.deepEqual([...references.events], ['battle']);
  assert.deepEqual([...references.choices], ['choice']); assert.deepEqual([...references.flags], ['flag']);
  assert.deepEqual([...references.world], ['door']);
});
