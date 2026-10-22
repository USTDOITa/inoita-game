import assert from 'node:assert/strict';
import test from 'node:test';
import { versionedAsset, versionedContent, withVersion } from '../src/application/asset-version.ts';

test('withVersion appends a query once and keeps fragments last', () => {
  assert.equal(withVersion('assets/a.png', 'abc'), 'assets/a.png?v=abc');
  assert.equal(withVersion('/assets/a.png', 'abc'), '/assets/a.png?v=abc');
  assert.equal(withVersion('./assets/a.png?x=1', 'abc'), './assets/a.png?x=1&v=abc');
  assert.equal(withVersion('assets/a.png#frame', 'abc'), 'assets/a.png?v=abc#frame');
  assert.equal(withVersion('assets/a.png?x=1#frame', 'abc'), 'assets/a.png?x=1&v=abc#frame');
  assert.equal(withVersion('assets/a.png?v=old', 'abc'), 'assets/a.png?v=old');
});

test('withVersion leaves external, data and empty URLs alone', () => {
  assert.equal(withVersion('https://example.com/a.png', 'abc'), 'https://example.com/a.png');
  assert.equal(withVersion('//example.com/a.png', 'abc'), '//example.com/a.png');
  assert.equal(withVersion('data:image/png;base64,xx', 'abc'), 'data:image/png;base64,xx');
  assert.equal(withVersion('blob:http://localhost/id', 'abc'), 'blob:http://localhost/id');
  assert.equal(withVersion('assets/a.png', ''), 'assets/a.png');
  assert.equal(withVersion('', 'abc'), '');
});

test('Node tests without build-time constants keep URLs unchanged', () => {
  // 版本由 Vite define 注入；直接跑 Node 测试时不存在，不能凭空加查询参数。
  assert.equal(versionedAsset('assets/a.png'), 'assets/a.png');
  assert.equal(versionedContent('content/a.json'), 'content/a.json');
});
