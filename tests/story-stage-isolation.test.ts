import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { StoryContext } from '../src/application/ports.ts';
import type { ActorDefinition, WorldMap } from '../src/domain/content.ts';
import type { StoryStage } from '../src/domain/story-performance.ts';
import type { WorldScene } from '../src/scenes/world-scene.ts';
import type { StoryStageScene as StageSceneType } from '../src/scenes/story-stage-scene.ts';

const hook = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'phaser' ? { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(`
    export default {Scene:class {}, Physics:{Arcade:{Body:class {}}},BlendModes:{NORMAL:0,SCREEN:1,ADD:2,MULTIPLY:3},
      Scenes:{Events:{CREATE:'create',SHUTDOWN:'shutdown',PRE_UPDATE:'preupdate',POST_UPDATE:'postupdate',PRE_RENDER:'prerender',RENDER:'render'}},
      Cameras:{Scene2D:{Events:{PAN_COMPLETE:'pancomplete'}}}};
  `)}` } : next(specifier, context);
} });
const { StoryPresenter } = await import('../src/rendering/story-presenter.ts');
const { StoryStageScene, STAGE_BACKDROP_COLOR, STAGE_TRANSPARENT_COLOR } = await import('../src/scenes/story-stage-scene.ts');
const { MovementWorld } = await import('../src/rendering/movement-world.ts');
hook.deregister();

const appearance = { id: 'hero', clips: {} } as ActorDefinition;

test('the initial curtain is drawn during create before readiness and survives map preparation', () => {
  const sequence: string[] = [], covers: { destroyed: boolean }[] = [];
  const events = new EventEmitter(), scale = Object.assign(new EventEmitter(), { width: 320, height: 200 });
  const scene = new StoryStageScene({} as StoryContext);
  Object.assign(scene, { events, scale, cameras: { main: { setBackgroundColor() {} } }, input: {},
    add: { rectangle(x: number, y: number, width: number, height: number, color: number) {
      assert.deepEqual({x,y,width,height,color}, {x:-320,y:-200,width:960,height:600,color:0});
      sequence.push('cover');
      const cover = { destroyed: false, setOrigin() { return this; }, setScrollFactor() { return this; },
        setDepth() { return this; }, setAlpha(opacity: number) { assert.equal(opacity, 1); return this; },
        destroy() { this.destroyed = true; } };
      covers.push(cover); return cover;
    } }
  });
  scene.create({ initialCurtain: { opacity: 1, color: 0 }, onReady: () => sequence.push('ready') });
  assert.deepEqual(sequence, ['cover']);
  events.emit('create'); assert.deepEqual(sequence, ['cover', 'ready']);
  scene.releaseStage(true); assert.equal(covers[0].destroyed, false);
  scene.clearEarlyCurtain(); assert.equal(covers[0].destroyed, true);
  scene.showInitialCurtain({ opacity: 1, color: 0 });
  events.emit('shutdown'); assert.equal(covers[1].destroyed, true);
});

test('the stage backdrop turns opaque only after a map is drawn and transparent on release', async () => {
  const colors: string[] = [];
  const map = { id: 'small', name: 'Small', width: 256, height: 448, columns: 16, rows: 28,
    tileSize: 16, blocked: [], ground: 'ground.png', canopy: 'canopy.png', features: [], entities: [] } as unknown as WorldMap;
  const app = {
    world: { maps: [{ id: 'small', file: 'small.json' }], props: [], actors: { hero: appearance }, storyEffects: {} },
    content: { map: async () => map },
    wardrobe: { textures: [] },
    session: { evaluateCondition: () => true, storyWorld: { visit: 0, currentLocation: { map: 'small' }, visible: () => true,
      actorAppearance: (actor: string) => actor, projectEntities: (_map: string, base: unknown[]) => base } },
    campaign: { start: { actor: 'hero' }, placements: [] }
  } as unknown as StoryContext;
  const scene = new StoryStageScene(app);
  const image = () => {
    const value: Record<string, unknown> = { scene: {}, setOrigin() { return value; }, setDepth() { return value; },
      setFlipX() { return value; }, setBlendMode() { return value; }, destroy() { value.scene = undefined; } };
    return value;
  };
  const container = () => {
    const value = Object.assign(new EventEmitter(), { x: 0, y: 0, scene: {}, visible: true,
      setOrigin() { return value; }, setDepth() { return value; }, setScrollFactor() { return value; },
      setPosition() { return value; }, setSize() { return value; }, setAlpha() { return value; },
      setVisible(next: boolean) { value.visible = next; return value; },
      destroy() { (value as { scene?: unknown }).scene = undefined; } });
    return value;
  };
  const camera = { scrollX: 0, scrollY: 0, width: 960, height: 640, zoom: 1,
    setBackgroundColor(color: string) { colors.push(color); return camera; },
    setZoom() { return camera; }, setRoundPixels() { return camera; }, setBounds() { return camera; }, centerOn() { return camera; } };
  Object.assign(scene, {
    events: new EventEmitter(), scale: { width: 960, height: 640, on() {}, off() {} },
    game: { canvas: { getBoundingClientRect: () => ({ width: 960, height: 640 }) } },
    sys: { isActive: () => true }, cameras: { main: camera },
    add: { image, container, group: () => ({ add() {} }) },
    physics: { world: { on() {}, add() {} }, add: { collider: () => ({}) } },
    textures: { exists: () => true, get: () => ({ has: () => true }), remove() {}, createCanvas() {} },
    anims: { exists: () => false, remove() {} }, input: {},
    load: { image() {}, start() {}, on() {}, once() {}, off() {} }
  });
  const saved = { register: MovementWorld.prototype.register, setEnabled: MovementWorld.prototype.setEnabled,
    destroy: MovementWorld.prototype.destroy };
  MovementWorld.prototype.register = function () { return {} as never; };
  MovementWorld.prototype.setEnabled = function () {};
  MovementWorld.prototype.destroy = function () {};
  const stage: StoryStage = { type: 'stage', map: 'small', x: 16, y: 16, facing: 'south', playerVisible: true, cast: [] };
  const content = app.content as unknown as { map: (file: string, signal?: AbortSignal) => Promise<WorldMap> };
  try {
    // 首张地图加载失败：舞台仍透明，正式世界应保持可见。
    content.map = async () => { throw new Error('load failed'); };
    await assert.rejects(scene.showStage(stage, new AbortController().signal, appearance));
    assert.ok(!colors.includes(STAGE_BACKDROP_COLOR));

    content.map = async () => map;
    await scene.showStage(stage, new AbortController().signal, appearance);
    assert.equal(colors.at(-1), STAGE_BACKDROP_COLOR);

    // 已有舞台时下一张图失败：保留已经画好的遮罩，不能露出世界。
    content.map = async () => { throw new Error('load failed'); };
    await assert.rejects(scene.showStage({ ...stage, map: 'other' }, new AbortController().signal, appearance));
    assert.equal(colors.at(-1), STAGE_BACKDROP_COLOR);

    scene.releaseStage();
    assert.equal(colors.at(-1), STAGE_TRANSPARENT_COLOR);
    // SHUTDOWN 时 CameraManager 可能已经销毁主相机，清理路径不能抛错。
    (scene.cameras as unknown as { main?: unknown }).main = undefined;
    assert.doesNotThrow(() => scene.releaseStage());
  } finally {
    MovementWorld.prototype.register = saved.register;
    MovementWorld.prototype.setEnabled = saved.setEnabled;
    MovementWorld.prototype.destroy = saved.destroy;
  }
});

test('a stage map draws static map entities and removes them with the map', async () => {
  const { drawStoryMap } = await import('../src/rendering/story-map-view.ts');
  const containers: { x: number; y: number; depth: number; scene?: unknown; setDepth(value: number): unknown; destroy(): void }[] = [];
  const scene = {
    add: {
      image() {
        const value: { scene?: unknown; setOrigin(): unknown; setDepth(): unknown; setFlipX(): unknown; setBlendMode(): unknown; destroy(): void } = {
          scene: {}, setOrigin() { return value; }, setDepth() { return value; }, setFlipX() { return value; },
          setBlendMode() { return value; }, destroy() { value.scene = undefined; }
        };
        return value;
      },
      container(x: number, y: number) {
        const value: { x: number; y: number; depth: number; scene?: unknown; setDepth(next: number): unknown; destroy(): void } = {
          x, y, depth: 0, scene: {},
          setDepth(next) { this.depth = next; return this; },
          destroy() { this.scene = undefined; }
        };
        containers.push(value); return value;
      }
    },
    textures: { exists: () => false, remove() {} }
  };
  const map = { id: 'small', features: [], entities: [
    { id: 'exit', actor: 'map-exit-x', x: 24, y: 48 },
    { id: 'steel', actor: 'steel-door-x', x: 30, y: 64 },
    { id: 'torch', actor: 'torch-x', x: 12, y: 20 },
    { id: 'chest', actor: 'treasure-box-x', x: 8, y: 16 },
    { id: 'spring', actor: 'clear-springs-x', x: 4, y: 8, spring: true }
  ] } as unknown as WorldMap;
  const characters = map.entities
    .filter(entity => !entity.actor.startsWith('treasure-box') && !entity.actor.startsWith('clear-springs'))
    .map(entity => ({ entity, actor: { id: entity.actor, clips: {} } as ActorDefinition }));
  const cleanup = drawStoryMap(scene as unknown as Parameters<typeof drawStoryMap>[0], map, characters);
  assert.equal(containers.length, 3, '门、钢门和火把等地图实体都画，宝箱与泉水不画');
  assert.deepEqual({ x: containers[0]!.x, y: containers[0]!.y, depth: containers[0]!.depth }, { x: 24, y: 48, depth: 48.5 });
  assert.deepEqual({ x: containers[1]!.x, y: containers[1]!.y, depth: containers[1]!.depth }, { x: 30, y: 64, depth: 64.5 });
  assert.deepEqual({ x: containers[2]!.x, y: containers[2]!.y, depth: containers[2]!.depth }, { x: 12, y: 20, depth: 20.5 });
  cleanup();
  assert(containers.every(container => container.scene === undefined), '清理演出地图时一并销毁门');
});

function harness() {
  const owner = {};
  const container = (x: number, y: number) => Object.assign(new EventEmitter(), {
    x, y, scene: owner as object | undefined, visible: true,
    setVisible(value: boolean) { this.visible = value; return this; },
    setDepth() { return this; }, setOrigin() { return this; }, setScrollFactor() { return this; },
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
    setSize() { return this; }, setFillStyle() { return this; }, setAlpha() { return this; },
    destroy() { this.scene = undefined; }
  });
  const visual = (x: number, y: number) => ({ actor: appearance, entity: { id: 'player', actor: 'hero', x, y }, container: container(x, y), layers: [], clipName: null });
  const world = { map: { id: 'home' }, player: visual(10, 20), facing: 'south', characters: [],
    cameras: { main: { scrollX: 5, scrollY: 6 } },
    scene: { launch() { throw new Error('active stage must be reused'); }, restart() { throw new Error('formal world must be retained'); } },
    prefetchMap() {}, showStage() { throw new Error('formal world must not prepare cinematics'); }
  } as unknown as WorldScene;
  let released = 0, rendered = 0;
  const movement = {
    stop() {}, remove() {}, register() {}, setEnabled() {}, setGhost() {},
    position(target: ReturnType<typeof visual>) { return { x: target.container.x, y: target.container.y }; },
    actor(target: ReturnType<typeof visual>) { return { enabled: () => target.container.visible !== false }; },
    place(target: ReturnType<typeof visual>, position: { x: number; y: number }) {
      this.placeAll([{ visual: target, position, enabled: target.container.visible }]);
    },
    placeAll(values: { visual: ReturnType<typeof visual>; position: { x: number; y: number }; enabled?: boolean }[]) {
      for (const value of values) { value.visual.container.x = value.position.x; value.visual.container.y = value.position.y;
        if (value.enabled !== undefined) value.visual.container.visible = value.enabled; }
    }
  };
  const events = new EventEmitter();
  const stage = { map: undefined as { id: string } | undefined, player: visual(10, 20), facing: 'south', movement,
    cameras: { main: { scrollX: 0, scrollY: 0, width: 960, height: 640, zoom: 1, stopFollow() {},
      setScroll(this: { scrollX: number; scrollY: number }, x: number, y: number) { this.scrollX = x; this.scrollY = y; },
      centerOn(this: { scrollX: number; scrollY: number }, x: number, y: number) { this.scrollX = x - 480; this.scrollY = y - 320; }
    } }, sys: { isActive: () => true, isPaused: () => false },
    add: { container, rectangle: () => container(0, 0) }, scale: { width: 960, height: 640 },
    async showStage(this: { map?: { id: string }; player: ReturnType<typeof visual> }, value: StoryStage, signal: AbortSignal) {
      signal.throwIfAborted(); this.map = { id: value.map }; rendered++;
      this.player.container.visible = value.playerVisible;
      (this as unknown as { movement: { setEnabled(target: unknown, enabled: boolean): void } }).movement.setEnabled(this.player, value.playerVisible);
    },
    releaseStage(this: { map?: { id: string } }) { released++; this.map = undefined; }, events,
    clearEarlyCurtain() {},
    scene: { stop() { events.emit('shutdown'); } }
  } as unknown as StageSceneType;
  const app = { session:{storyWorld:{actorAppearance:(id:string)=>id}}, world: { actors: { hero: appearance, guard: { ...appearance, id: 'guard' }, saint: { ...appearance, id: 'saint' } } }, campaign: { start: { actor: 'hero' } } } as unknown as StoryContext;
  const presenter = new StoryPresenter(app, () => world, () => stage);
  return { presenter, stage, world, released: () => released, rendered: () => rendered };
}

test('cinematic travel retains formal world and only explicit bindings become world changes', async () => {
  const run = harness(), signal = new AbortController().signal;
  await run.presenter.begin(signal);
  await run.presenter.execute({ type: 'stage', map: 'hall', x: 30, y: 40, facing: 'east', playerVisible: true,
    cast: [
      { id: 'named-performer', worldEntityId: 'persistent-guard', actor: 'guard', x: 60, y: 70, facing: 'west', visible: true },
      { id: 'temporary-double', actor: 'guard', x: 80, y: 90, facing: 'south', visible: true }
    ] }, { signal, skipSignal: signal });
  await run.presenter.finish(true, signal);
  assert.equal(run.world.map!.id, 'home'); assert.equal(run.world.player!.container.x, 10);
  assert.equal(run.released(), 0, 'final frame remains while runtime commits and projects');
  assert.deepEqual(run.presenter.getWorldChanges(), [{ id: 'persistent-guard', map: 'hall', actor: 'guard', x: 60, y: 70, facing: 'west', visible: true }]);
  const saved = run.presenter.captureStage()!; saved.cast[0].x = 999;
  assert.equal(run.presenter.captureStage()!.cast[0].x, 60);
  await run.presenter.release(); assert.equal(run.released(), 1);
});

test('交还操作权时重新应用正式世界的地图音乐，回菜单后不再应用', async () => {
  const applied: string[] = [];
  const world = { map: { id: 'shadow-camp' } } as unknown as WorldScene;
  const stage = { sys: { isActive: () => false, isPaused: () => false } } as unknown as StageSceneType;
  const presenter = (mode: string) => new StoryPresenter(
    { audio: { enterMap: (id: string) => applied.push(id) }, ui: { mode } } as unknown as StoryContext,
    () => world, () => stage);

  await presenter('game').release();
  assert.deepEqual(applied, ['shadow-camp']);
  await presenter('menu').release();
  assert.deepEqual(applied, ['shadow-camp'], '回菜单后不能再把地图音乐盖到菜单主题上');
});

test('deferred first stage inherits the world actor instead of resolving against its own declaration', async () => {
  const run = harness(), signal = new AbortController().signal;
  // 正式世界已经在洞穴入口，圣女是事件 3 登记在藏身处的世界实体。
  (run.world as unknown as { map: { id: string }; player: { container: { x: number; y: number } } }).map = { id: 'depths' };
  run.world.player!.container.x = 40; run.world.player!.container.y = 168;
  (run.world as unknown as { characters: unknown[] }).characters = [{
    entity: { id: 'quest-npc-located-npc-79', characterId: 'npc-79', actor: 'saint', x: 360, y: 136 },
    actor: { id: 'saint' }, container: { x: 360, y: 136, visible: true }, clipName: 'idle-south'
  }];
  // 上一段演出留下的最后一帧还停在同一张图、同一个旧坐标；它不是本段主角的起点。
  (run.stage as unknown as { map: { id: string } }).map = { id: 'depths' };
  run.stage.player!.container.x = 200; run.stage.player!.container.y = 184;
  // 这一幕自己的声明把圣女写成「位置未知、从现场继承」，主角坐标只是兜底锚点。
  const action: StoryStage = { type: 'stage', map: 'depths', x: 200, y: 184, facing: 'south', playerVisible: false,
    retainPlayerPosition: true, cast: [{ id: 'saint', actor: 'saint', characterId: 'npc-79', x: 2048, y: 2048,
      facing: 'south', visible: false, unpositioned: true, inheritPosition: true }] };
  await run.presenter.begin(signal, action, undefined, true);
  await run.presenter.execute(action, { signal, skipSignal: signal });
  const stage = run.presenter.captureStage()!;
  const saint = stage.cast.find(member => member.characterId === 'npc-79')!;
  assert.deepEqual([saint.x, saint.y, saint.visible, saint.unpositioned], [360, 136, true, undefined]);
  assert.deepEqual([stage.x, stage.y], [40, 168], '主角接正式世界的入口位置，而不是声明的兜底锚点');
});

test('show reveals an already positioned character without moving it', async () => {
  const run = harness(), signal = new AbortController().signal;
  await run.presenter.begin(signal);
  await run.presenter.execute({ type: 'stage', map: 'hall', x: 30, y: 40, facing: 'east', playerVisible: false, cast: [] },
    { signal, skipSignal: signal });
  assert.equal(run.stage.player!.container.visible, false);
  const before = { x: run.stage.player!.container.x, y: run.stage.player!.container.y };
  await run.presenter.execute({ type: 'show', target: 'player' }, { signal, skipSignal: signal });
  assert.equal(run.stage.player!.container.visible, true);
  assert.deepEqual([run.stage.player!.container.x, run.stage.player!.container.y], [before.x, before.y], '显形不能挪位置');
});

test('a stage handed to begin paints once, when the following execute runs', async () => {
  const run = harness(), signal = new AbortController().signal;
  const action = { type: 'stage' as const, map: 'hall', x: 30, y: 40, facing: 'east' as const, playerVisible: true, cast: [] };
  await run.presenter.begin(signal, action, undefined, true);
  assert.equal(run.rendered(), 0, '首幕舞台动作留给 execute 一次画出，begin 不重复建图');
  await run.presenter.execute(action, { signal, skipSignal: signal });
  assert.equal(run.rendered(), 1);
});

test('failure restores cinematic baseline with caller signal and leaves formal world intact', async () => {
  const run = harness(), signal = new AbortController().signal;
  await run.presenter.begin(signal);
  await run.presenter.travel({ map: 'remote', x: 80, y: 90, facing: 'north' }, signal);
  await run.presenter.execute({ type: 'fade', opacity: 1, color: 0, durationMs: 0 }, { signal, skipSignal: signal });
  assert.equal(run.presenter.captureStage()!.curtain!.opacity, 1);
  await run.presenter.finish(false, signal);
  assert.equal(run.presenter.captureStage()!.map, 'home'); assert.equal(run.world.map!.id, 'home');
  assert.deepEqual(run.presenter.captureStage()!.curtain, { opacity: 0, color: 0 });
  assert.deepEqual(run.presenter.captureStage()!.camera, { x: 485, y: 326 });
  const abort = new AbortController(); abort.abort(new DOMException('cancelled', 'AbortError'));
  await run.presenter.finish(false, abort.signal); assert.equal(run.released(), 1);
});

test('cancelled or superseded resource loading releases the late lease without rebuilding a stage', async () => {
  for (const cancellation of ['abort', 'release']) {
    const events = new EventEmitter(), frames = new Set<string>(), pending: string[] = [];
    const load = Object.assign(new EventEmitter(), { image: (key: string) => pending.push(key), spritesheet() {}, start() {} });
    let mapEntries = 0;
    const app = { world: { maps: [{ id: 'map', file: 'map.json' }], props: [], actors: {} }, wardrobe: { textures: [] },
      session: { enterMap() { mapEntries++; }, evaluateCondition: () => true,
        storyWorld: { visit: 0, currentLocation: { map: 'map' }, visible: () => true,
          actorAppearance: (actor: string) => actor, projectEntities: (_map: string, base: unknown[]) => base } },
      campaign: { start: { actor: 'hero' }, placements: [] },
      content: { map: async () => ({ id: 'map', ground: 'ground.png', canopy: 'canopy.png', features: [], entities: [] } as unknown as WorldMap) }
    } as unknown as StoryContext;
    const scene = new StoryStageScene(app);
    Object.assign(scene, { events, load, sys: { isActive: () => true },
      textures: { exists: (key: string) => frames.has(key), get: () => ({ has: () => true }), remove: (key: string) => frames.delete(key) },
      anims: { exists: () => false } });
    const abort = new AbortController();
    const running = scene.showStage({ type: 'stage', map: 'map', x: 1, y: 2, facing: 'south', playerVisible: true, cast: [] }, abort.signal, appearance);
    await new Promise(resolve => setImmediate(resolve));
    if (cancellation === 'abort') abort.abort(new DOMException('cancelled', 'AbortError'));
    else scene.releaseStage();
    const rejected = assert.rejects(running, { name: 'AbortError' });
    // An abort returns before a pending loader settles; superseding a stage also rejects when its old loader finally returns.
    if (cancellation === 'abort') await rejected;
    for (const key of pending) frames.add(key);
    load.emit('complete'); await rejected; await new Promise(resolve => setImmediate(resolve));
    assert.equal(frames.size, 0); assert.equal(mapEntries, 0); assert.equal(scene.map, undefined);
  }
});

test('retainPlayerPosition continues from the formal world player when the stage has not shown that map yet', async () => {
  const run = harness(), signal = new AbortController().signal;
  await run.presenter.begin(signal);
  // 本段演出的第一镜：舞台场景还没放过任何一张图（map 为空），位置只能从正式世界取。
  (run.stage as unknown as { map?: unknown }).map = undefined;
  run.stage.player!.container.x = 50; run.stage.player!.container.y = 60;
  run.world.player!.container.x = 12; run.world.player!.container.y = 34;
  await run.presenter.execute({ type: 'stage', map: 'home', x: 999, y: 999, facing: 'north', playerVisible: true, cast: [], retainPlayerPosition: true },
    { signal, skipSignal: signal });
  const stage = run.presenter.captureStage()!;
  assert.deepEqual({ x: stage.x, y: stage.y, facing: stage.facing }, { x: 12, y: 34, facing: 'south' });
  // 没有 retainPlayerPosition 时仍用脚本坐标：台上演员各就各位，主角回到脚本写的位置。
  await run.presenter.execute({ type: 'stage', map: 'home', x: 999, y: 999, facing: 'north', playerVisible: true, cast: [] },
    { signal, skipSignal: signal });
  assert.deepEqual({ x: run.presenter.captureStage()!.x, y: run.presenter.captureStage()!.y }, { x: 999, y: 999 });
});

test('an invisible actor walks straight to its destination instead of stalling the performance', async () => {
  const run = harness(), signal = new AbortController().signal;
  await run.presenter.begin(signal);
  await run.presenter.execute({ type: 'stage', map: 'home', x: 10, y: 20, facing: 'south', playerVisible: true,
    cast: [{ id: 'hidden-guard', actor: 'guard', x: 60, y: 70, facing: 'west', visible: false }] }, { signal, skipSignal: signal });
  // 停用的角色不会被移动世界推进：`MovementBody.update` 在 `!actor.enabled()` 时提前返回，而
  // `WalkRoute` 的状态只在 `next()` 里推进。这条走位必须立刻收尾，否则演出会永远等下去。
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run.presenter.execute({ type: 'walk', target: 'hidden-guard', x: 100, y: 120, speedPxPerSecond: 100 }, { signal, skipSignal: signal }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('停用角色的走位把演出挂住了')), 300); }),
    ]);
  } finally { clearTimeout(timer); }
  const member = run.presenter.captureStage()!.cast.find(cast => cast.id === 'hidden-guard')!;
  assert.deepEqual([member.x, member.y, member.visible], [100, 120, false], '落点照写，人物仍然不显示');
});

test('an off-stage actor is not pointed at: camera and pose do nothing when the position is unknown', async () => {
  const run = harness(), signal = new AbortController().signal;
  await run.presenter.begin(signal);
  await run.presenter.execute({ type: 'stage', map: 'home', x: 10, y: 20, facing: 'south', playerVisible: true,
    cast: [{ id: 'absent', actor: 'guard', x: 2048, y: 2048, facing: 'west', visible: false, unpositioned: true, inheritPosition: true }] },
    { signal, skipSignal: signal });
  const camera = run.stage.cameras.main as unknown as { scrollX: number; scrollY: number };
  const before = { x: camera.scrollX, y: camera.scrollY };
  // 原版对找不到的角色什么都不做；照做会把镜头摇到场外坐标 (2048,2048)，姿态则对着看不见的人做动作。
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run.presenter.execute({ type: 'camera', target: 'absent', motion: 'cut' }, { signal, skipSignal: signal }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('镜头动作没有结束')), 300); }),
    ]);
    await run.presenter.execute({ type: 'pose', target: 'absent', pose: 'idle', durationMs: 0 }, { signal, skipSignal: signal });
  } finally { clearTimeout(timer); }
  assert.deepEqual([camera.scrollX, camera.scrollY], [before.x, before.y], '镜头停在原处，没有摇到场外');
});

test('a current-map performance never loads its preview map or restarts the formal world',async()=>{
  const run=harness(),signal=new AbortController().signal;
  await run.presenter.begin(signal);
  await run.presenter.execute({type:'stage',map:'preview',mapFromWorld:true,x:70,y:90,facing:'east',playerVisible:true,cast:[]},
    {signal,skipSignal:signal});
  assert.equal(run.stage.map!.id,'home');
  assert.deepEqual([run.stage.player!.container.x,run.stage.player!.container.y],[70,90]);
  assert.equal(run.world.map!.id,'home');
  assert.equal(run.presenter.getStageState()!.mapFromWorld,undefined);
});

test('an emote is not drawn for a character that is not on screen', async () => {
  const run = harness(), signal = new AbortController().signal;
  await run.presenter.begin(signal);
  await run.presenter.execute({ type: 'stage', map: 'home', x: 10, y: 20, facing: 'south', playerVisible: true,
    cast: [{ id: 'hidden', actor: 'guard', x: 80, y: 90, facing: 'south', visible: false }] },
    { signal, skipSignal: signal });
  // 隐藏角色身上的表情不再单独绘制；素材缺失也不会因此报错。
  await assert.doesNotReject(run.presenter.execute({ type: 'effect', target: 'hidden', effect: 'story-startle' },
    { signal, skipSignal: signal }));
  await run.presenter.finish(true, signal);
});
