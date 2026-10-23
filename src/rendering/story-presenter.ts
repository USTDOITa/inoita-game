import { resolveStoryStage, storyStageWorldCast } from '../domain/story-performance.ts';
import { SCENE_KEYS } from '../application/scene-keys.ts';
import Phaser from 'phaser';
import type { StoryContext } from '../application/ports.ts';
import type { ActorDefinition, Facing, TravelDestination } from '../domain/content.ts';
import type { PerformanceAction, PerformancePlayback, StoryCurtain, StoryPresentationPort, StoryStage } from '../domain/story-performance.ts';
import { cameraDuration, mapEffectTone } from '../domain/story-performance.ts';
import { faceTarget } from '../domain/basic-attack.ts';
import { createCharacter, setCharacterClip } from './characters.ts';
import type { CharacterVisual } from './characters.ts';
import { createEffect } from './effects.ts';
import type { WorldScene } from '../scenes/world-scene.ts';
import type { StoryStageScene } from '../scenes/story-stage-scene.ts';
import type { StoryEntityState } from '../domain/story-world.ts';

interface Performer { visual: CharacterVisual; facing: Facing; worldEntityId?: string; unpositioned?:boolean }
type VisualAction = Exclude<PerformanceAction, { type: 'parallel' }>;

/** 独立舞台只产生语义结果，由运行时提交到正式世界。 */
export class StoryPresenter implements StoryPresentationPort {
  private readonly world: () => WorldScene;
  private readonly scene: () => StoryStageScene;
  private readonly app: StoryContext;
  private actors = new Map<string, Performer>();
  private appearance?: ActorDefinition;
  private baseline?: StoryStage;
  private finalStage?: StoryStage;
  private dynamicMap = false;
  private epoch = 0;
  private closing?: Promise<void>;
  private curtain?: Phaser.GameObjects.Rectangle;
  private opacity = 0;
  private color = 0;
  private effects = new Set<Phaser.GameObjects.Container>();
  private groundEffects?: Phaser.GameObjects.Layer;
  private topEffects?: Phaser.GameObjects.Layer;
  private toneFilter?: Phaser.Filters.ColorMatrix;
  constructor(app: StoryContext, world: () => WorldScene, stage?: () => StoryStageScene) {
    this.app = app; this.world = world;
    this.scene = stage ?? (() => world().scene.get(SCENE_KEYS.storyStage) as StoryStageScene);
  }
  prefetchMap(map: string): void { this.world().prefetchMap(map); }
  async begin(signal?: AbortSignal, restored?: StoryStage, initialCurtain?: StoryCurtain, deferFirstStage = false): Promise<void> {
    if (!signal) throw new Error('剧情舞台需要导演的取消信号');
    signal.throwIfAborted();
    const world = this.world(), player = world.player;
    if (!player || !world.map) throw new Error('正式地图尚未准备好');
    this.appearance = player.actor;
    // 演出开始前的真实状态：优先当前舞台画面，其次从正式世界拼一份。
    const current: StoryStage = this.captureStage() ?? {
      type: 'stage' as const, map: world.map.id, x: player.container.x, y: player.container.y,
      facing: world.facing, playerVisible: player.container.visible,
      cast: world.characters.map(character => ({
        id: character.entity.id, worldEntityId:character.entity.id, actor: character.actor.id, ...(character.entity.characterId?{characterId:character.entity.characterId}:{}),
        x: character.container.x, y: character.container.y,
        facing: character.clipName?.split('-').at(-1) as Facing || 'south', visible: character.container.visible
      }))
    };
    const stage: StoryStage = restored ?? current;
    // `deferFirstStage` 时 `restored` 是即将绘制的首幕声明，不是演出前的状态。
    // 拿它当 baseline，首幕的 `inheritPosition` 会从自己的占位 cast 继承，
    // 结果是该显形的人留在哨兵坐标、`retainPlayerPosition` 也接到声明里的兜底锚点。
    this.baseline = structuredClone(deferFirstStage ? current : stage); this.finalStage = undefined;
    // 首幕在另一张图上时，先把正式世界遮住：舞台场景建场和画图要几帧，
    // 这段时间露出脚下这张图，玩家就会先看到当前地图、再看到别处的演出。
    // 同图首幕不遮，入场淡入仍然直接看着脚下的地图。
    const curtain = initialCurtain ?? (stage.map !== world.map.id ? { opacity: 1, color: 0 } : undefined);
    if (curtain) { this.opacity = curtain.opacity; this.color = curtain.color; }
    await this.ready(signal, curtain);
    // 导演把这一幕的首个舞台动作传进来时，画面由紧随其后的 `execute(action)` 一次画出。
    // 这里再画一遍会让同一张舞台图重建两次（贴图、人物、音频各释放一次再建一次），
    // 就是原版演出开始前那一闪的多余画面。
    if (deferFirstStage) return;
    await this.stage(stage, signal);
    const camera = this.scene().cameras.main;
    if (!restored && !stage.camera && stage.map === world.map.id) camera.setScroll(world.cameras.main.scrollX, world.cameras.main.scrollY);
    this.baseline = this.captureStage();
  }
  private async ready(signal: AbortSignal, initialCurtain?: StoryCurtain): Promise<void> {
    if (this.closing) await this.closing;
    signal.throwIfAborted();
    const stage = this.scene();
    if (stage.sys.isActive()) { if (initialCurtain) stage.showInitialCurtain?.(initialCurtain); return; }
    return new Promise((resolve, reject) => {
      const clean = () => { signal.removeEventListener('abort', abort); };
      const abort = () => { clean(); reject(signal.reason); };
      const created = () => { clean(); if (signal.aborted) reject(signal.reason); else resolve(); };
      signal.addEventListener('abort', abort, { once: true });
      this.world().scene.launch(SCENE_KEYS.storyStage, { signal, onReady: created, initialCurtain });
      this.world().scene.moveAbove('world', 'story-stage');
    });
  }
  captureStage(): StoryStage | undefined {
    const scene = this.scene(), player = this.actors.get('player');
    if (!scene.map || !player) return this.finalStage ? structuredClone(this.finalStage) : undefined;
    const camera = scene.cameras.main;
    const center = { x: camera.scrollX + camera.width / camera.zoom / 2, y: camera.scrollY + camera.height / camera.zoom / 2 };
    const position = (visual: CharacterVisual) => scene.movement?.position?.(visual) ?? visual.container;
    const point = position(player.visual);
    return {
      type: 'stage', map: scene.map.id, x: point.x, y: point.y,
      facing: player.facing, playerVisible: player.visual.container.visible,
      ...(Number.isFinite(center.x) && Number.isFinite(center.y) ? { camera: center } : {}),
      curtain: { opacity: this.opacity, color: this.color },
      ...(this.app.audio ? { audio: this.app.audio.captureStoryAudio() } : {}),
      cast: [...this.actors].filter(([id]) => id !== 'player').map(([id, actor]) => ({
        id, actor: actor.visual.entity.actor, ...(actor.visual.entity.characterId?{characterId:actor.visual.entity.characterId}:{}), worldEntityId: actor.worldEntityId,
        x: position(actor.visual).x, y: position(actor.visual).y, facing: actor.facing, visible: actor.visual.container.visible,
        ...(actor.unpositioned?{unpositioned:true}:{})
      }))
    };
  }
  getStageState(): StoryStage | undefined { return this.captureStage(); }
  getWorldChanges(): readonly StoryEntityState[] {
    const stage = this.captureStage();
    return stage?.cast.filter(actor => !!actor.worldEntityId).map(actor => ({
      id: actor.worldEntityId!, map: stage.map, actor: actor.actor, ...(actor.characterId?{characterId:actor.characterId}:{}),
      x: actor.x, y: actor.y, facing: actor.facing, visible: actor.visible
    })) ?? [];
  }
  async restoreStage(stage: StoryStage, signal: AbortSignal): Promise<void> { await this.ready(signal); await this.stage(stage, signal); }
  private actor(id: string): Performer {
    const actor = this.actors.get(id);
    if (!actor) throw new Error('剧情人物未出场：' + id);
    return actor;
  }
  /**
   * 「这一刻在这张图上」的演员；位置未知（`unpositioned`，停在哨兵坐标）时返回 undefined。
   *
   * 原版对找不到的角色，任何指向它的命令都什么都不做（findings 105），`walk` 早就是这么做的。
   * 镜头和特效若照做，会摇到场外坐标、打在空处；姿态则是对一个看不见的人做动作。判据与
   * `walk` 的跳过同一条：世界投影里接得到位置的演员早就不是 `unpositioned`（findings 189），
   * 所以这条只挡「真的还没到场」的人。
   */
  private present(id: string): Performer | undefined {
    const actor = this.actors.get(id);
    return actor?.unpositioned ? undefined : actor;
  }
  private resetActors(preserveCurtain = false): void {
    for (const [id, actor] of this.actors) {
      this.scene().movement?.stop(actor.visual);
      if (id !== 'player') { this.scene().movement?.remove(actor.visual); if (actor.visual.container.scene) actor.visual.container.destroy(); }
      else this.scene().movement?.setGhost(actor.visual, false);
    }
    this.actors.clear();
    for (const effect of this.effects) if (effect.scene) effect.destroy();
    this.effects.clear();
    if (!preserveCurtain) { this.curtain?.destroy(); this.curtain = undefined; }
  }
  /** 地点特效的两个固定层：地面层在底图之上，顶层在角色之上、树冠之下。 */
  private effectLayer(ground: boolean): Phaser.GameObjects.Layer {
    const existing = ground ? this.groundEffects : this.topEffects;
    if (existing?.scene) return existing;
    const layer = this.scene().add.layer().setDepth(ground ? -9999 : 9999);
    if (ground) this.groundEffects = layer; else this.topEffects = layer;
    return layer;
  }
  /**
   * 地图效果开关：原版 `0x32`／`0x33` 写 `MAP_nBaseEffect`，它决定世界层每帧要不要走
   * `GRP_AddColorTone(2,0)`。复刻用舞台相机上的颜色矩阵滤镜表达同一件事；原版这个开关不随
   * 切图复位，所以重建舞台时不清理它，只在剧情结束时随舞台相机一起消失。
   */
  private applyMapEffect(enabled: boolean): void {
    const filters = this.scene().cameras.main.filters;
    if (!this.toneFilter) {
      if (!enabled || !filters) return;
      this.toneFilter = filters.internal.addColorMatrix();
      this.toneFilter.colorMatrix.set(mapEffectTone);
    }
    this.toneFilter.setActive(enabled);
  }
  private async stage(stage: StoryStage, signal: AbortSignal): Promise<void> {
    const epoch = ++this.epoch;
    this.dynamicMap = stage.mapFromWorld === true;
    // 舞台收尾会把这张图写回正式世界；提前让世界场景预热，减少静默重建的等待。
    if (stage.map && stage.map !== this.world().map?.id) this.prefetchMap(stage.map);
    if (stage.mapFromWorld || stage.cast.some(member=>member.inheritPosition||member.characterId)) {
      const current = this.captureStage() ?? this.baseline;
      if (!current) throw new Error('当前剧情场景尚未准备好');
      let arrival:StoryStage['cast']=[];
      // `inheritPosition` 的角色也可能不在当前舞台的 cast 里（重播、上一幕收起）；同一张图
      // 也要准备到达投影，`resolveStoryStage` 才能从世界状态把人接回来。
      if (!stage.mapFromWorld && (stage.resetActors || stage.map!==current.map || stage.cast.some(member=>member.inheritPosition))) {
        const needsMap=stage.resetActors||stage.map!==current.map;
        const reference=this.app.world?.maps?.find(map=>map.id===stage.map);
        if(!reference&&needsMap)throw new Error('这片区域的资源尚未准备好');
        if(reference){
          const map=await this.app.content.map(reference.file,signal);
          arrival=storyStageWorldCast(map,this.app.campaign.placements,this.app.session.storyWorld,
            condition=>this.app.session.evaluateCondition(condition),stage.resetActors);
        }
      }
      stage = resolveStoryStage(stage, current, arrival);
    }
    if (stage.retainPlayerPosition) {
      const retained = this.retainedPlayer(stage.map);
      if (retained) stage = { ...stage, ...retained };
    }
    if (!this.appearance) throw new Error('剧情玩家外观尚未准备好');
    const identities=new Map(stage.cast.map(member=>[member.id,member.actor]));
    stage={...stage,cast:stage.cast.map(member=>({...member,actor:this.app.session.storyWorld.actorAppearance(member.actor)}))};
    await this.scene().showStage(stage, signal, this.appearance);
    signal.throwIfAborted();
    if (epoch !== this.epoch) throw new DOMException('演出实例已更新', 'AbortError');
    // 舞台地图已经画好、相机底色也已盖住正式世界；首幕的遮罩到这里交还给演出。
    // 已被新舞台取代的那一次不能清掉别人的遮罩。
    this.scene().clearEarlyCurtain();
    this.resetActors(true);
    const scene = this.scene();
    scene.cameras.main.stopFollow();
    this.actors.set('player', { visual: scene.player!, facing: stage.facing });
    // 演出走位按脚本执行：角色只受地形约束，不被机关或其他单位挡住。
    scene.movement!.setGhost(scene.player!, true);
    this.face(this.actors.get('player')!, stage.facing);
    for (const member of stage.cast) {
      const visual = createCharacter(scene, this.app.world.actors[member.actor], { ...member,actor:identities.get(member.id)! });
      visual.container.setVisible(member.visible);
      scene.movement!.register(visual, false); scene.movement!.setEnabled(visual, member.visible);
      scene.movement!.setGhost(visual, true);
      const actor = { visual, facing: member.facing, worldEntityId: member.worldEntityId,unpositioned:member.unpositioned };
      this.actors.set(member.id, actor); this.face(actor, member.facing);
    }
    const placements = [...this.actors].map(([id, actor]) => ({ visual: actor.visual, position: id === 'player' ? {x:stage.x,y:stage.y} : {x:actor.visual.container.x,y:actor.visual.container.y}, enabled: actor.visual.container.visible }));
    if (this.dynamicMap && scene.movement!.navigation) {
      const movement=scene.movement!, navigation=movement.navigation;
      for (const placement of placements) movement.setEnabled(placement.visual,false);
      const settled:import('../domain/navigation-world.ts').Placement[]=[];
      for (const placement of placements) {
        if (!placement.enabled) continue;
        const actor=movement.actor(placement.visual);
        placement.position=navigation.nearest(actor.shape(),placement.position,actor,settled);
        settled.push({actor,position:placement.position,enabled:true});
      }
    }
    scene.movement!.placeAll(placements);
    if (stage.camera) scene.cameras.main.centerOn(stage.camera.x, stage.camera.y);
    if (stage.curtain) { this.opacity = stage.curtain.opacity; this.color = stage.curtain.color; }
    if (stage.audio) this.app.audio?.restoreStoryAudio(stage.audio);
    this.drawCurtain();
  }
  async travel(destination: TravelDestination, signal: AbortSignal): Promise<void> {
    await this.stage({ type: 'stage', ...destination, playerVisible: true, cast: [] }, signal);
  }
  /**
   * `retainPlayerPosition` 的落点：接着上一镜的主角位置。舞台正在放这张图就用舞台上的位置；
   * 这一镜是本段演出的第一镜（舞台还没放过任何一张图）就用正式世界里的位置。
   *
   * 两处都取**脚底**坐标（`movement.position`），与 `captureStage` 写进舞台的 x/y 同一套坐标；
   * 早先读的是容器的绘制坐标，两者差一个碰撞偏移，演出结束把主角写回世界时就会偏一截。
   */
  private retainedPlayer(map: string): { x: number; y: number; facing: Facing } | undefined {
    const scene = this.scene();
    // 本段演出还没画出任何一幕时，舞台里残留的是上一段演出的最后一帧；主角的实际
    // 位置以正式世界为准。已经画过舞台后，才接着舞台上的位置走。
    if (this.actors.has('player') && scene.map?.id === map && scene.player) {
      const position = scene.movement?.position?.(scene.player) ?? scene.player.container;
      return { x: position.x, y: position.y, facing: scene.facing };
    }
    const world = this.world();
    if (!world.map || world.map.id !== map || !world.player) return undefined;
    const position = world.movement?.position?.(world.player) ?? world.player.container;
    return { x: position.x, y: position.y, facing: world.facing };
  }
  private face(actor: Performer, facing: Facing): void {
    actor.facing = facing;
    setCharacterClip(this.scene(), actor.visual, `idle-${facing}`);
    if (actor.visual === this.scene().player) this.scene().facing = facing;
  }
  private drawCurtain(): void {
    const scene = this.scene();
    if (!this.curtain?.scene) this.curtain = scene.add.rectangle(0, 0, 1, 1, this.color).setOrigin(0).setScrollFactor(0).setDepth(20000);
    // 画面遮罩也会受镜头倍率影响，向四边留足覆盖范围。
    this.curtain.setPosition(-scene.scale.width, -scene.scale.height).setSize(scene.scale.width * 3, scene.scale.height * 3)
      .setFillStyle(this.color).setAlpha(this.opacity).setVisible(this.opacity > 0);
    scene.clearEarlyCurtain();
  }
  /** 每个等待都由场景时钟推进；暂停、跳过、取消使用同一条清理路径。 */
  private wait(playback: PerformancePlayback, start: (complete: () => void) => () => void, settle: () => void = () => {}): Promise<void> {
    playback.signal.throwIfAborted();
    if (playback.skipSignal.aborted) { settle(); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      let done = false, clean = () => {};
      const finish = (aborted = false) => {
        if (done) return; done = true; clean();
        playback.signal.removeEventListener('abort', abort);
        playback.skipSignal.removeEventListener('abort', skip);
        if (aborted) reject(playback.signal.reason ?? new DOMException('cancelled', 'AbortError'));
        else { try { settle(); resolve(); } catch (error) { reject(error); } }
      };
      const abort = () => finish(true), skip = () => finish();
      playback.signal.addEventListener('abort', abort, { once: true });
      playback.skipSignal.addEventListener('abort', skip, { once: true });
      try { clean = start(() => finish()); if (done) clean(); }
      catch (error) { done = true; playback.signal.removeEventListener('abort', abort); playback.skipSignal.removeEventListener('abort', skip); clean(); reject(error); }
    });
  }
  private delay(duration: number, playback: PerformancePlayback): Promise<void> {
    if (!duration) return Promise.resolve();
    return this.wait(playback, complete => {
      const timer = this.scene().time.delayedCall(duration, complete); return () => timer.remove();
    });
  }
  private async pan(x: number, y: number, motion: 'pan' | 'cut', playback: PerformancePlayback): Promise<void> {
    const camera = this.scene().cameras.main;
    camera.stopFollow();
    const scroll = camera.getScroll(x, y);
    const duration = motion === 'cut' ? 0 : cameraDuration(Math.hypot(scroll.x - camera.scrollX, scroll.y - camera.scrollY));
    if (!duration) { camera.centerOn(x, y); return; }
    await this.wait(playback, complete => {
      camera.once(Phaser.Cameras.Scene2D.Events.PAN_COMPLETE, complete);
      camera.pan(x, y, duration, 'Linear', true);
      return () => { camera.off(Phaser.Cameras.Scene2D.Events.PAN_COMPLETE, complete); camera.panEffect.reset(); };
    }, () => camera.centerOn(x, y));
  }
  private async walk(action: Extract<VisualAction, {type:'walk'}>, playback: PerformancePlayback, batch = false): Promise<void> {
    const scene = this.scene(), actor = this.actor(action.target), visual = actor.visual, movement = scene.movement!;
    if(actor.unpositioned)return;
    const destination = { x: action.x, y: action.y };
    const finalFacing = faceTarget(movement.position(visual), destination);
    // 停用的角色不会被移动世界推进：`MovementBody.update` 在 `!actor.enabled()` 时提前返回，而
    // `WalkRoute` 的状态只在 `next()` 里推进，等它到站就是永远等——演出卡在这一条上，只能靠玩家
    // 跳过解开。看不见的角色走位只影响位置（原版照走，只是没画出来），所以落点照写、过程省略。
    if (!movement.actor(visual).enabled()) {
      if (!batch) movement.place(visual, destination);
      this.face(actor, finalFacing);
      if (action.followCamera) scene.cameras.main.centerOn(destination.x, destination.y);
      return;
    }
    const body = movement.body(visual);
    const immovable = body.immovable;
    if (action.followCamera) scene.cameras.main.startFollow(visual.container, true, 1, 1);
    const settle = () => {
      movement.stop(visual); body.setImmovable(immovable);
      if (!batch || !playback.skipSignal.aborted) movement.place(visual, destination);
      this.face(actor, playback.skipSignal.aborted ? finalFacing : actor.facing);
      if (action.followCamera) { scene.cameras.main.stopFollow(); scene.cameras.main.centerOn(destination.x, destination.y); }
    };
    if (playback.skipSignal.aborted) { settle(); return; }
    body.setImmovable(false);
    const route = movement.walkTo(visual, destination, action.speedPxPerSecond);
    let failed = route.state === 'failed';
    try {
      await this.wait(playback, complete => {
        const update = () => {
          if (route.state === 'failed') { failed = true; complete(); return; }
          if (route.state === 'arrived') { complete(); return; }
          const dx = body.velocity.x, dy = body.velocity.y;
          if (Math.hypot(dx, dy) > .01) {
            actor.facing = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'west' : 'east' : dy < 0 ? 'north' : 'south';
            setCharacterClip(scene, visual, `walk-${actor.facing}`);
          } else this.face(actor, actor.facing);
        };
        scene.events.on(Phaser.Scenes.Events.POST_UPDATE, update); update();
        return () => { scene.events.off(Phaser.Scenes.Events.POST_UPDATE, update); movement.stop(visual); body.setImmovable(immovable); };
      }, () => { if (!failed) settle(); });
      if (failed) throw new Error(`剧情${route.error?.message ?? '道路不可达'}：${action.target} → (${action.x}, ${action.y})`);
    } finally { movement.stop(visual); body.setImmovable(immovable); }
  }
  async parallel(actions: PerformanceAction[], playback: PerformancePlayback): Promise<void> {
    const flatten = (action: PerformanceAction): VisualAction[] => action.type === 'parallel' ? action.actions.flatMap(flatten) : [action];
    const flat = actions.flatMap(flatten), scene = this.scene(), movement = scene.movement!;
    const placements = flat.flatMap(action => {
      if (action.type !== 'walk' && action.type !== 'appear' && action.type !== 'leave') return [];
      if(action.type==='walk'&&this.actor(action.target).unpositioned)return [];
      const visual = this.actor(action.target).visual;
      return [{ visual, position: action.type === 'leave' ? movement.position(visual) : { x: action.x, y: action.y }, enabled: action.type === 'appear' || (action.type === 'walk' && visual.container.visible) }];
    });
    const settle = () => movement.placeAll(placements);
    if (playback.skipSignal.aborted) settle();
    else movement.placeAll(placements.filter(p => flat.some(a => (a.type === 'appear' || a.type === 'leave') && this.actor(a.target).visual === p.visual)));
    await Promise.all(flat.map(action => this.executeAction(action, playback, true)));
    if (playback.skipSignal.aborted) settle();
  }
  async execute(action: VisualAction, playback: PerformancePlayback): Promise<void> { await this.executeAction(action, playback); }
  private async executeAction(action: VisualAction, playback: PerformancePlayback, batch = false): Promise<void> {
    playback.signal.throwIfAborted();
    const scene = this.scene();
    switch (action.type) {
      case 'instant-message': this.app.ui.showInstant(action.text);return;
      case 'refresh-appearance': {const stage=this.captureStage();if(stage)await this.stage(stage,playback.signal);return;}
      case 'stage': await this.stage(action, playback.signal); return;
      case 'appear': {
        const actor = this.actor(action.target);
        actor.unpositioned=false;
        if (!batch) scene.movement!.placeAll([{ visual: actor.visual, position: action, enabled: true }]);
        this.face(actor, action.facing); return;
      }
      case 'show': {
        // 原版走位前会 `CHARSYSTEM_Revive`：人物已经在台上、只是没画出来。
        // 这里只开显示，不挪位置——位置仍由舞台或之前的走位决定。
        const actor = this.actor(action.target);
        if (actor.unpositioned) return;
        scene.movement!.setEnabled(actor.visual, true);
        actor.visual.container.setVisible(true);
        this.face(actor, actor.facing); return;
      }
      case 'leave': {
        const target = this.actor(action.target).visual.container;
        // 退场只隐藏人物，已经开始的特效留在原地播完。
        for (const effect of this.effects) if (effect.parentContainer === target) {
          const x = target.x + effect.x, y = target.y + effect.y;
          target.remove(effect); scene.add.existing(effect); effect.setPosition(x, y).setDepth(target.depth + 1);
        }
        target.setVisible(false); scene.movement!.setEnabled(this.actor(action.target).visual, false); return;
      }
      case 'face': this.face(this.actor(action.target), action.facing); return;
      case 'walk': await this.walk(action, playback, batch); return;
      case 'pose': {
        const actor = this.present(action.target);
        if (!actor) return;
        if (!playback.skipSignal.aborted) {
          const clip = `${action.pose}-${actor.facing}` as const;
          setCharacterClip(scene, actor.visual, clip, true);
          // 原版按 `ACTDATABASE +4` 决定动作播完要不要排收尾：等于 1 的动作停在末帧保持姿势
          // （114／115／147／149），其余回待机。待机自己循环，不需要收尾事件。
          if (action.pose !== 'idle' && !action.hold) actor.visual.layers[0]?.once('animationcomplete', () => {
            if (actor.visual.container.scene && actor.visual.clipName === clip) this.face(actor, actor.facing);
          });
        } else this.face(actor, actor.facing);
        await this.delay(action.durationMs, playback); return;
      }
      case 'camera': {
        const actor = this.present(action.target);
        if (!actor) return;
        const target = actor.visual.container;
        await this.pan(target.x, target.y, action.motion, playback); return;
      }
      case 'camera-point': await this.pan(action.x, action.y, action.motion, playback); return;
      case 'effect': {
        if (playback.skipSignal.aborted) return;
        const performer = this.present(action.target);
        if (!performer) return;
        const visual = performer.visual;
        const target = visual.container;
        // 表情属于角色本人：角色不在画面上时不要让它单独浮在地图上。
        // event-4 在 `show player` 之前对隐藏的玩家放 `story-attention`，以前会在
        // 地图入口留下一个没有人的感叹号。
        if (!target.visible) return;
        const clip = this.app.world.storyEffects?.[action.effect]?.clips.default;
        if (!clip) throw new Error('剧情特效缺失：' + action.effect);
        const anchor = visual.actor.effectAnchor ?? { x: 0, y: 0 };
        const effect = createEffect(scene, clip, anchor.x, anchor.y);
        target.add(effect);
        this.effects.add(effect); effect.once('destroy', () => this.effects.delete(effect)); return;
      }
      case 'location-effect': {
        if (playback.skipSignal.aborted) return;
        const placed = this.app.world.storyEffects?.[action.effect];
        if (!placed) throw new Error('剧情特效缺失：' + action.effect);
        const effect = createEffect(scene, placed.clips.default, action.x, action.y);
        this.effectLayer(placed.placement === 'ground').add(effect);
        this.effects.add(effect); effect.once('destroy', () => this.effects.delete(effect)); return;
      }
      case 'map-effect': this.applyMapEffect(action.enabled); return;
      case 'wait': await this.delay(action.durationMs, playback); return;
      case 'sound': if (!playback.skipSignal.aborted) this.app.audio?.effect(action.sound); return;
      case 'stop-audio': this.app.audio?.stopStoryAudio(); return;
      case 'music': this.app.audio?.setStoryMusic(action.sound); return;
      case 'fade': {
        this.color = action.color;
        const settle = () => { this.opacity = action.opacity; this.drawCurtain(); };
        if (!action.durationMs) { settle(); return; }
        await this.wait(playback, complete => {
          const tween = scene.tweens.add({ targets: this, opacity: action.opacity, duration: action.durationMs, onUpdate: () => this.drawCurtain(), onComplete: complete });
          return () => tween.remove();
        }, settle); return;
      }
    }
  }
  async finish(completed: boolean, signal?: AbortSignal): Promise<void> {
    if (completed) {
      signal?.throwIfAborted();
      this.finalStage = this.captureStage();
      for (const actor of this.actors.values()) this.scene().movement?.stop(actor.visual);
      return;
    }
    // 节点取消时正式世界尚未修改；恢复舞台由运行时提供仍有效的信号。
    this.epoch++;
    if (signal && !signal.aborted && this.baseline) await this.restoreStage(this.baseline, signal);
    else {
      if (this.baseline?.audio) this.app.audio?.restoreStoryAudio(this.baseline.audio);
      await this.release();
    }
  }
  async release(): Promise<void> {
    if (this.closing) return this.closing;
    this.epoch++;
    this.resetActors(); this.opacity = 0; this.finalStage = undefined; this.baseline = undefined;
    this.groundEffects = undefined; this.topEffects = undefined; this.toneFilter = undefined;
    const scene = this.scene();
    if (scene.sys.isActive() || scene.sys.isPaused() || scene.sys.isSleeping?.()) {
      scene.releaseStage();
      const closing = new Promise<void>(resolve => {
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, resolve);
        scene.scene.stop();
      });
      this.closing = closing;
      try { await closing; } finally { if (this.closing === closing) this.closing = undefined; }
    }
    // 舞台切过别的图之后，音乐停在那一幕的配置上。原版每 255 帧按当前地图重新
    // 调用 `SOUNDSYSTEM_Play_BGM_AMBIENT_CURRENT`，回到正式世界时地图会重新成为
    // 当前地图；这里在演出交还操作权时补同一次应用，255 的地图仍按原版保留当前曲目。
    // 回主菜单时 `ui.mode` 已经切走，不能再把地图音乐盖到菜单主题上。
    const world = this.world();
    if (this.app.ui?.mode === 'game' && world.map) this.app.audio?.enterMap(world.map.id);
  }
}
