import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpriteSheet } from '../tools/validate-spritesheet.ts';

function header(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

test('sprite sheet validation rejects the original oversized strip and accepts its row layout', () => {
  const clip = { frameWidth: 464, frameHeight: 467, frames: 20 };
  assert.throws(() => validateSpriteSheet(header(9280, 467), clip, 'hellsword.png'), /尺寸/);
  validateSpriteSheet(header(3712, 1401), clip, 'hellsword.png');
});

test('sprite sheet validation rejects HTML, truncated headers, partial frames and insufficient capacity', () => {
  const clip = { frameWidth: 8, frameHeight: 8, frames: 3 };
  for (const bytes of [new TextEncoder().encode('<html>not a PNG image</html>'), header(24, 8).subarray(0,20)]) {
    assert.throws(() => validateSpriteSheet(bytes, clip, 'effect.png'), /PNG 头/);
  }
  assert.throws(() => validateSpriteSheet(header(23, 8), clip, 'effect.png'), /整数倍/);
  assert.throws(() => validateSpriteSheet(header(16, 8), clip, 'effect.png'), /不足 3 帧/);
  validateSpriteSheet(header(16, 16), clip, 'effect.png');
});
