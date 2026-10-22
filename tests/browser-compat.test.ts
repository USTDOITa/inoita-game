// 模拟设备自带但版本较旧的 Android System WebView：先把这些 API 删掉，
// 再加载兼容层，验证补上之后的行为与原生实现一致。
const removed = {
  throwIfAborted: Reflect.deleteProperty(AbortSignal.prototype, 'throwIfAborted'),
  reason: Reflect.deleteProperty(AbortSignal.prototype, 'reason'),
  at: Reflect.deleteProperty(Array.prototype, 'at'),
  hasOwn: Reflect.deleteProperty(Object, 'hasOwn'),
  replaceAll: Reflect.deleteProperty(String.prototype, 'replaceAll'),
  structuredClone: Reflect.deleteProperty(globalThis, 'structuredClone')
};

import assert from 'node:assert/strict';
import test from 'node:test';

await import('../src/application/browser-compat.ts');

test('测试前提：这些 API 在旧 WebView 上确实缺失', () => {
  for (const [name, deleted] of Object.entries(removed)) assert.equal(deleted, true, `${name} 没有被删除`);
});

test('取消后 throwIfAborted 抛出 AbortError，未取消时什么都不做', () => {
  const signal = new AbortController().signal;
  assert.doesNotThrow(() => signal.throwIfAborted());
  const controller = new AbortController();
  controller.abort();
  assert.ok(controller.signal.reason instanceof DOMException);
  assert.throws(() => controller.signal.throwIfAborted(),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
});

test('带原因的取消保留原始原因', () => {
  const reason = new Error('演出被取消');
  const controller = new AbortController();
  controller.abort(reason);
  assert.equal(controller.signal.reason, reason);
  assert.throws(() => controller.signal.throwIfAborted(), (error: unknown) => error === reason);
});

test('structuredClone 复制标准类型并保留循环引用', () => {
  const source: Record<string, unknown> = {
    date: new Date(1234),
    map: new Map([['key', { count: 1 }]]),
    set: new Set([1, 2]),
    list: [1, , 3],
    nested: { text: '原文' }
  };
  source.self = source;

  const copy = structuredClone(source);
  assert.notEqual(copy, source);
  assert.notEqual(copy.nested, source.nested);
  assert.equal(copy.self, copy);
  assert.deepEqual(copy.date, new Date(1234));
  assert.equal((copy.map as Map<string, { count: number }>).get('key')?.count, 1);
  assert.deepEqual([...(copy.set as Set<number>)], [1, 2]);
  assert.equal((copy.list as unknown[]).length, 3);
  assert.equal(1 in (copy.list as unknown[]), false, '数组空位保持为空位');
});

test('Array.at 按规范处理负下标和越界', () => {
  assert.equal([1, 2, 3].at(-1), 3);
  assert.equal([1, 2, 3].at(0), 1);
  assert.equal([1, 2, 3].at(-4), undefined);
  assert.equal([1, 2, 3].at(3), undefined);
});

test('Object.hasOwn 只认自有属性', () => {
  const value = Object.create({ inherited: 1 }) as Record<string, number>;
  value.own = 2;
  assert.equal(Object.hasOwn(value, 'own'), true);
  assert.equal(Object.hasOwn(value, 'inherited'), false);
});

test('String.replaceAll 支持字符串、空串和全局正则', () => {
  assert.equal('a_b_c'.replaceAll('_', ' · '), 'a · b · c');
  assert.equal('abc'.replaceAll('', '-'), '-a-b-c-');
  assert.equal('a1b2'.replaceAll(/\d/g, '#'), 'a#b#');
  assert.throws(() => 'a1'.replaceAll(/\d/, '#'), TypeError);
});
