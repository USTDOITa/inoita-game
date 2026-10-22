import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutChoicePanel } from '../src/ui/choice-layout.ts';

const textHeights = (count: number, height = 27) => Array.from({ length: count }, () => height);

test('options stack vertically with full-height buttons and the panel stays on screen', () => {
  const layout = layoutChoicePanel({ promptHeight: 29, optionTextHeights: textHeights(4) });
  assert.deepEqual(layout.options.map(option => option.height), [56, 56, 56, 56]);
  assert.deepEqual(layout.options.map(option => option.y), [0, 64, 128, 192]);
  assert.equal(layout.contentHeight, 248);
  assert.equal(layout.listViewport, 248, '四个选项放得下时不滚动');
  assert.ok(layout.top >= 20 && layout.top + layout.panelHeight <= 620);
  assert.ok(layout.listY + layout.listViewport <= layout.top + layout.panelHeight - 16);
});

test('every button is tall enough for its wrapped label', () => {
  const layout = layoutChoicePanel({ promptHeight: 29, optionTextHeights: [27, 49, 71] });
  assert.deepEqual(layout.options.map(option => option.height), [56, 69, 91]);
  for (const [index, textHeight] of [27, 49, 71].entries())
    assert.ok(layout.options[index]!.height >= textHeight + 20, '换行后的文字不会压出按钮');
});

test('a long prompt and description push the panel up without overlapping the options', () => {
  const layout = layoutChoicePanel({ promptHeight: 53, descriptionHeight: 100, optionTextHeights: textHeights(3) });
  assert.equal(layout.descriptionView, 44, '描述最高显示两行，超出部分滚动');
  assert.equal(layout.descriptionY, layout.promptY + 53 + 10);
  assert.equal(layout.listY, layout.descriptionY! + 44 + 16);
  assert.ok(layout.top >= 20);
});

test('too many options switch the option area to scrolling instead of leaving the screen', () => {
  const layout = layoutChoicePanel({ promptHeight: 53, optionTextHeights: textHeights(20) });
  assert.equal(layout.top, 20);
  assert.ok(layout.contentHeight > layout.listViewport, '内容高于可视区时滚动');
  assert.equal(layout.listViewport, layout.top + layout.panelHeight - 16 - layout.listY);
  assert.ok(layout.listY + layout.listViewport <= layout.top + layout.panelHeight - 16);
});

test('options keep their measured heights when the list scrolls', () => {
  const layout = layoutChoicePanel({ promptHeight: 29, optionTextHeights: [27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27, 27] });
  assert.equal(layout.options.length, 12);
  assert.ok(layout.contentHeight > layout.listViewport);
  assert.ok(layout.options.every((option, index) => option.y === index * 64));
});
