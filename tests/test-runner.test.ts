import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runTests } from '../tools/test.ts';

function harness(t: TestContext, statuses = [0, 0]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-test-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'tests'));
  for (const name of ['first.test.ts', 'second.test.ts', 'helper.ts']) {
    fs.writeFileSync(path.join(root, 'tests', name), '');
  }
  fs.mkdirSync(path.join(root, 'tests', 'directory.test.ts'));
  fs.writeFileSync(path.join(root, 'outside.test.ts'), '');
  const calls: { command: string; args: string[]; cwd: string; stdio: string }[] = [];
  const messages: string[] = [];
  const execute: Parameters<typeof runTests>[2] = (command, args, options) => {
    calls.push({ command, args, ...options });
    return { status: statuses.shift() ?? 0 };
  };
  return { root, calls, messages, execute,
    run: (args: string[]) => runTests(args, root, execute, message => messages.push(message)) };
}

test('missing test arguments fail before starting typecheck or tests', t => {
  const h = harness(t);
  assert.equal(h.run([]), 1);
  assert.deepEqual(h.calls, []);
  assert.match(h.messages[0], /npm test -- tests\/example\.test\.ts/);
});

test('the CLI reports missing arguments with a failing exit code', () => {
  const runner = fileURLToPath(new URL('../tools/test.ts', import.meta.url));
  const result = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /请指定相关测试文件/);
  assert.equal(result.stdout, '');
});

test('one selected test runs after exactly one typecheck', t => {
  const h = harness(t);
  assert.equal(h.run(['tests/first.test.ts']), 0);
  assert.deepEqual(h.calls, [
    { command: 'npm', args: ['run', 'typecheck'], cwd: h.root, stdio: 'inherit' },
    { command: process.execPath, args: ['--test', 'tests/first.test.ts'], cwd: h.root, stdio: 'inherit' }
  ]);
});

test('multiple selected tests are normalized and deduplicated without adding other files', t => {
  const h = harness(t);
  assert.equal(h.run(['tests/second.test.ts', './tests/first.test.ts', path.join(h.root, 'tests/second.test.ts')]), 0);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].args, ['--test', 'tests/second.test.ts', 'tests/first.test.ts']);
});

for (const invalid of ['tests/missing.test.ts', 'tests/helper.ts', 'outside.test.ts',
  'tests/directory.test.ts', '--watch', 'tests/*.test.ts']) {
  test(`invalid test argument ${invalid} fails before any process starts`, t => {
    const h = harness(t);
    assert.equal(h.run(['tests/first.test.ts', invalid]), 1);
    assert.deepEqual(h.calls, []);
    assert.match(h.messages[0], /无效测试文件/);
  });
}

test('explicit all mode selects only top-level test files using a process substitute', t => {
  const h = harness(t);
  assert.equal(h.run(['--all']), 0);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].args, ['--test', 'tests/first.test.ts', 'tests/second.test.ts']);
});

test('all mode cannot be mixed with selected files', t => {
  const h = harness(t);
  assert.equal(h.run(['--all', 'tests/first.test.ts']), 1);
  assert.deepEqual(h.calls, []);
});

test('all mode with no test files fails before typecheck', t => {
  const h = harness(t);
  for (const name of ['first.test.ts', 'second.test.ts']) fs.unlinkSync(path.join(h.root, 'tests', name));
  assert.equal(h.run(['--all']), 1);
  assert.deepEqual(h.calls, []);
  assert.match(h.messages[0], /没有 .test.ts 文件/);
});

test('typecheck failure is returned and prevents test execution', t => {
  const h = harness(t, [7]);
  assert.equal(h.run(['tests/first.test.ts']), 7);
  assert.equal(h.calls.length, 1);
});

test('test failure preserves the child exit code', t => {
  const h = harness(t, [0, 11]);
  assert.equal(h.run(['tests/first.test.ts']), 11);
  assert.equal(h.calls.length, 2);
});

test('a child process that cannot start reports its error and fails', t => {
  const h = harness(t);
  const result = runTests(['tests/first.test.ts'], h.root,
    () => ({ status: null, error: new Error('npm unavailable') }), message => h.messages.push(message));
  assert.equal(result, 1);
  assert.deepEqual(h.messages, ['npm unavailable']);
});

test('an interrupted child process returns failure', t => {
  const h = harness(t);
  const result = runTests(['tests/first.test.ts'], h.root,
    () => ({ status: null, signal: 'SIGTERM' }), message => h.messages.push(message));
  assert.equal(result, 1);
  assert.match(h.messages[0], /SIGTERM/);
});
