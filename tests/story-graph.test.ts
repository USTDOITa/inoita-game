import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryGraph, type StoryGraph, type StoryNode } from '../src/domain/story-graph.ts';
const node = (id: string, exit: StoryNode['exit'] = { type: 'end' }): StoryNode => ({ id, presentation: [], commands: [], exit });
const graph = (nodes: StoryNode[]): StoryGraph => ({ version: 2, scripts: { main: { entry: nodes[0].id, nodes } }, events: [] });
test('graph accepts cross-script branches and waiting encounters', () => {
  const data = graph([node('start', { type: 'next', target: { script: 'other', node: 'battle' } })]);
  data.scripts.other = { entry: 'battle', nodes: [node('battle', { type: 'waitEncounter', encounter: { id: 'guards', map: 'castle', status: 'prepared', spawns: [] }, outcomes: { won: { script: 'main', node: 'start' } } })] };
  assert.doesNotThrow(() => validateStoryGraph(data));
});
test('graph rejects missing references, duplicate nodes and empty choice panels', () => {
  assert.throws(() => validateStoryGraph(graph([node('one', { type: 'next', target: { script: 'main', node: 'missing' } })])), /不存在/);
  assert.throws(() => validateStoryGraph(graph([node('one'), node('one')])), /重复/);
  const data = graph([node('one')]); data.scripts.main.nodes[0].presentation = [{ type: 'choice', prompt: '选择', options: [] }];
  assert.throws(() => validateStoryGraph(data), /选项为空/);
});
test('graph rejects closed loops but accepts a branch with a terminating route', () => {
  assert.throws(() => validateStoryGraph(graph([node('one', { type: 'next', target: { script: 'main', node: 'one' } })])), /循环/);
  const data = graph([node('one', { type: 'branch', condition: { type: 'always', value: false }, then: { script: 'main', node: 'one' }, otherwise: { script: 'main', node: 'exit' } }), node('exit')]);
  assert.doesNotThrow(() => validateStoryGraph(data));
});
test('graph rejects duplicate events and unknown event scripts', () => {
  const data = graph([node('one')]); data.events = [{ id: 'intro', source: 'map-entry', script: 'unknown' }];
  assert.throws(() => validateStoryGraph(data), /未知脚本/);
  data.events = [{ id: 'intro', source: 'map-entry', script: 'main' }, { id: 'intro', source: 'quest', script: 'main' }];
  assert.throws(() => validateStoryGraph(data), /标识重复/);
});

test('authored choice values must all resolve before gameplay starts',()=>{
  const data=graph([node('choice',{type:'choice',choice:'response',cases:{yes:{script:'main',node:'end'}}}),node('end')]);
  data.scripts.main.nodes[0].presentation=[{type:'choice',prompt:'choose',options:[{label:'yes',value:'yes'},{label:'no',value:'no'}]}];
  assert.throws(()=>validateStoryGraph(data),/不匹配/);
  const exit=data.scripts.main.nodes[0].exit;
  if(exit.type==='choice')exit.cases.no={script:'main',node:'end'};
  assert.doesNotThrow(()=>validateStoryGraph(data));
});
