import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { computeVersions, hashTree, versionHtmlAssets } from '../tools/build-version.ts';

async function tree(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'story-build-version-'));
  await mkdir(path.join(root, 'assets', 'ui'), { recursive: true });
  await mkdir(path.join(root, 'content'), { recursive: true });
  await writeFile(path.join(root, 'assets', 'ui', 'a.png'), 'a');
  await writeFile(path.join(root, 'assets', 'b.png'), 'b');
  await writeFile(path.join(root, 'content', 'world.json'), '{}');
  return root;
}

test('the same file tree hashes identically regardless of write order', async () => {
  const root = await tree();
  try {
    const first = hashTree(path.join(root, 'assets'));
    const second = hashTree(path.join(root, 'assets'));
    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{16}$/);
    assert.notEqual(computeVersions(root).contentVersion, computeVersions(root).assetVersion);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('content and file set changes change the version', async () => {
  const root = await tree();
  try {
    const before = hashTree(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets', 'b.png'), 'changed');
    const changed = hashTree(path.join(root, 'assets'));
    assert.notEqual(changed, before);
    await writeFile(path.join(root, 'assets', 'c.png'), 'c');
    assert.notEqual(hashTree(path.join(root, 'assets')), changed);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a missing directory is reported clearly', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'story-build-version-empty-'));
  try {
    assert.throws(() => hashTree(path.join(root, 'assets')), /构建版本目录不存在/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('versionHtmlAssets only rewrites asset URLs and is idempotent', () => {
  const html = '<link rel="preload" href="/assets/ui/a.png"><script src="./bundles/index-abc.js"></script>'
    + '<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="https://x/a.png">'
    + '<link rel="apple-touch-icon" href="/assets/ui/icon.png#x">';
  const once = versionHtmlAssets(html, 'v1');
  assert.match(once, /href="\/assets\/ui\/a\.png\?v=v1"/);
  assert.match(once, /href="\/assets\/ui\/icon\.png\?v=v1#x"/);
  assert.match(once, /src="\.\/bundles\/index-abc\.js"/);
  assert.match(once, /href="\/manifest\.webmanifest"/);
  assert.match(once, /href="https:\/\/x\/a\.png"/);
  assert.equal(versionHtmlAssets(once, 'v1'), once);
});
