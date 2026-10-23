import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type Phaser from 'phaser';
import type { WorldMap } from '../src/domain/content.ts';

const hook = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'phaser'
    ? { shortCircuit: true, url: 'data:text/javascript,export default {BlendModes:{NORMAL:0,ADD:1,MULTIPLY:2,SCREEN:3}};' }
    : next(specifier, context);
} });
const { drawMapLayers, mapSurfaceAssets, dodgePixel } = await import('../src/rendering/map-layers.ts');
hook.deregister();

interface FakeImage {
  key: string; x: number; y: number; depth: number; flipped: boolean; blend: number | null;
  scene?: object; destroyed: boolean;
  setOrigin(): FakeImage; setDepth(value: number): FakeImage; setFlipX(value: boolean): FakeImage;
  setBlendMode(value: number): FakeImage; destroy(): void;
}

function fixture(failOnKey?: string) {
  const images: FakeImage[] = [], removed: string[] = [];
  const textures = new Map<string, { height: number }>([
    ['map-ground', { height: 4 }], ['map-canopy', { height: 4 }], ['prop-a', { height: 4 }], ['prop-b', { height: 4 }]
  ]);
  const scene = {
    textures: {
      exists: (key: string) => textures.has(key),
      get: (key: string) => ({ getSourceImage: () => textures.get(key) }),
      remove: (key: string) => { removed.push(key); textures.delete(key); },
      createCanvas: (key: string, width: number, height: number) => {
        textures.set(key, { height });
        const data = new Uint8ClampedArray(width * height * 4).fill(100);
        return {
          key,
          context: {
            drawImage() {},
            getImageData: () => ({ data: new Uint8ClampedArray(data) }),
            putImageData() {}
          },
          refresh() {}
        };
      }
    },
    add: {
      image: (x: number, y: number, key: string) => {
        if (key === failOnKey) throw new Error('绘制失败：' + key);
        const image: FakeImage = {
          key, x, y, depth: 0, flipped: false, blend: null, scene: {}, destroyed: false,
          setOrigin() { return image; }, setDepth(value) { image.depth = value; return image; },
          setFlipX(value) { image.flipped = value; return image; },
          setBlendMode(value) { image.blend = value; return image; },
          destroy() { image.destroyed = true; image.scene = undefined; }
        };
        images.push(image); return image;
      }
    }
  };
  return { scene: scene as unknown as Phaser.Scene, images, removed };
}

const map = (features: WorldMap['features']) => ({ id: 'map', ground: 'ground.png', canopy: 'canopy.png', features } as unknown as WorldMap);

test('map surface assets keep ground, canopy and feature props together', () => {
  const assets = mapSurfaceAssets(map([{ texture: 'prop-a' } as WorldMap['features'][number]]), [
    { key: 'prop-a', file: 'a.png' }
  ]);
  assert.deepEqual(assets.map(asset => asset.key), ['map-ground', 'map-canopy', 'prop-a']);
  assert.throws(() => mapSurfaceAssets(map([{ texture: 'missing' } as WorldMap['features'][number]]), []), /场景物件缺少资源/);
});

test('dodge pixel preserves zero background and saturates a full foreground', () => {
  assert.equal(dodgePixel(0, 50), 0);
  assert.equal(dodgePixel(100, 255), 255);
  assert.equal(dodgePixel(100, 50), 124);
  assert.equal(dodgePixel(255, 254), 255);
});

test('static layers keep feature offsets, flip, blend and depth', () => {
  const run = fixture();
  const layers = drawMapLayers(run.scene, map([
    { texture: 'prop-a', x: 10, y: 20, offsetX: 3, offsetY: 4, width: 8, flip: true, blend: 'multiply' },
    { texture: 'prop-b', x: 30, y: 40, offsetX: 1, offsetY: 2, width: 6, flip: false, blend: 'add' }
  ]), { keyPrefix: 'test-dodge' });
  assert.deepEqual(run.images.map(image => image.key), ['map-ground', 'prop-a', 'prop-b', 'map-canopy']);
  assert.deepEqual(run.images.map(image => image.depth), [-10000, 20, 40, 10000]);
  assert.deepEqual([run.images[1]!.x, run.images[1]!.y, run.images[1]!.flipped, run.images[1]!.blend], [5, 16, true, 2]);
  assert.deepEqual([run.images[2]!.x, run.images[2]!.y, run.images[2]!.flipped, run.images[2]!.blend], [29, 38, false, 1]);
  layers.destroy(); layers.destroy();
  assert(run.images.every(image => image.destroyed));
  assert.deepEqual(run.removed, [], '静态层不能删除租约管理的 ground/canopy/prop');
});

test('color dodge creates its own texture and does not flip or blend the image again', () => {
  const run = fixture();
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({
          translate() {}, scale() {}, drawImage() {},
          getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(100) })
        })
      };
      return canvas;
    }
  };
  try {
    const layers = drawMapLayers(run.scene, map([
      { texture: 'prop-a', x: 10, y: 20, offsetX: 3, offsetY: 4, width: 8, flip: true, blend: 'color-dodge' }
    ]), { keyPrefix: 'test-dodge' });
    const feature = run.images[1]!;
    assert.match(feature.key, /^test-dodge-\d+$/);
    assert.equal(feature.flipped, false);
    assert.equal(feature.blend, null);
    layers.destroy();
    assert.equal(run.removed.length, 1, '只删除自己创建的合成纹理');
    assert.match(run.removed[0]!, /^test-dodge-\d+$/);
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
});

test('a failed layer construction rolls back images and composite textures', () => {
  const run = fixture('map-canopy');
  assert.throws(() => drawMapLayers(run.scene, map([
    { texture: 'prop-a', x: 1, y: 2, offsetX: 0, offsetY: 0, width: 8, flip: false, blend: 'normal' }
  ]), { keyPrefix: 'test-dodge' }), /绘制失败/);
  assert(run.images.every(image => image.destroyed), '已画出的 ground/features 必须销毁');
});
