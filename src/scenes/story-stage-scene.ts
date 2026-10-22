import { SCENE_KEYS } from '../application/scene-keys.ts';
import Phaser from 'phaser';
import type { StoryContext } from '../application/ports.ts';
import type { AssetLease } from '../application/assets.ts';
import type { ActorDefinition, Facing, WorldMap } from '../domain/content.ts';
import type { StoryCurtain, StoryStage } from '../domain/story-performance.ts';
import { NavigationWorld } from '../domain/navigation-world.ts';
import { MovementWorld } from '../rendering/movement-world.ts';
import { characterAssets, createCharacter, setCharacterClip, type CharacterVisual } from '../rendering/characters.ts';
import { effectAssets } from '../rendering/effects.ts';
import { loadSceneAssets, type PendingAsset } from '../rendering/scene-assets.ts';
import { drawStoryMap } from '../rendering/story-map-view.ts';
import { worldZoom } from '../ui/viewport.ts';
import { Wardrobe } from '../rendering/wardrobe.ts';

/** 舞台画出地图后用来盖住下方正式世界的底色；与 WorldScene 相机底色一致（world-scene.ts:171）。 */
export const STAGE_BACKDROP_COLOR = '#000000';
export const STAGE_TRANSPARENT_COLOR = 'rgba(0,0,0,0)';

function cancellable<T>(work: Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cancel = () => { if (!finished) { finished = true; reject(signal.reason); } };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    work.then(value => {
      signal.removeEventListener('abort', cancel);
      if (finished) { late?.(value); return; }
      finished = true; resolve(value);
    }, error => {
      signal.removeEventListener('abort', cancel);
      if (!finished) { finished = true; reject(error); }
    });
  });
}

/** 独立演出世界：正式地图的访问记录、战斗和摆放点均由 WorldScene 保留。 */
export class StoryStageScene extends Phaser.Scene {
  readonly app: StoryContext;
  map?: WorldMap;
  player?: CharacterVisual;
  facing: Facing = 'south';
  movement?: MovementWorld;
  private lease?: AssetLease;
  private clearMap?: () => void;
  private revision = 0;
  private wardrobe?: Wardrobe;
  private earlyCurtain?: Phaser.GameObjects.Rectangle;
  constructor(app: StoryContext) {
    super({ key: SCENE_KEYS.storyStage, physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } } });
    this.app = app;
  }
  create(options?: { signal?: AbortSignal; onReady?: () => void; initialCurtain?: StoryCurtain }): void {
    // 首幕/淡入阶段舞台还没有地图，保持透明让正式世界可见；
    // 第一次成功画出舞台地图后由 showStage 切换为不透明。
    this.setWorldCovered(false);
    this.input.enabled = false;
    if (options?.initialCurtain && !options.signal?.aborted) this.showInitialCurtain(options.initialCurtain);
    this.scale.on('resize', this.resizeView, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.revision++;
      this.scale.off('resize', this.resizeView, this);
      this.releaseStage();
      this.wardrobe = undefined;
    });
    this.events.once(Phaser.Scenes.Events.CREATE, () => {
      if (!options?.signal?.aborted) options?.onReady?.();
    });
  }
  showInitialCurtain(curtain: StoryCurtain): void {
    this.clearEarlyCurtain();
    this.earlyCurtain = this.add.rectangle(-this.scale.width, -this.scale.height, this.scale.width * 3, this.scale.height * 3, curtain.color)
      .setOrigin(0).setScrollFactor(0).setDepth(20001).setAlpha(curtain.opacity);
  }
  clearEarlyCurtain(): void { this.earlyCurtain?.destroy(); this.earlyCurtain = undefined; }
  /**
   * 舞台一旦有自己的地图，就用不透明相机底色完全盖住下方仍在渲染的正式世界。
   * 还没画舞台地图（首幕淡入/lead-in）时保持透明，让玩家仍能看到世界。
   *
   * 相机背景先于本场景所有对象铺满整个视口，所以地图比视口小时四周显示黑边，
   * 而不是透出下面的旧地图。场景 SHUTDOWN 时 CameraManager 可能已经销毁主相机，
   * 这里用可选链避免清理路径抛错。
   */
  private setWorldCovered(covered: boolean): void {
    this.cameras?.main?.setBackgroundColor(covered ? STAGE_BACKDROP_COLOR : STAGE_TRANSPARENT_COLOR);
  }
  /** 新地图加载完成前保留上一幅画面；迟到的加载只释放自己的租约。 */
  async showStage(stage: StoryStage, signal: AbortSignal, appearance: ActorDefinition): Promise<void> {
    signal.throwIfAborted();
    const revision = ++this.revision;
    const reference = this.app.world.maps.find(map => map.id === stage.map);
    if (!reference) throw new Error('这片区域的资源尚未准备好');
    const map = this.map?.id === stage.map ? this.map : await this.app.content.map(reference.file, signal);
    signal.throwIfAborted();
    const needed: PendingAsset[] = [
      { kind: 'image', key: map.id + '-ground', file: map.ground },
      { kind: 'image', key: map.id + '-canopy', file: map.canopy },
      ...characterAssets(appearance).filter(asset => asset.file),
      ...effectAssets(this.app.world.storyEffects ?? {})
    ];
    needed.push(...this.app.wardrobe.textures.map(texture => ({ kind: 'image' as const, ...texture })));
    for (const feature of map.features) {
      const prop = this.app.world.props.find(prop => prop.key === feature.texture);
      if (!prop) throw new Error('场景物件缺少资源');
      needed.push({ kind: 'image', key: prop.key, file: prop.file });
    }
    for (const member of stage.cast) {
      const actor = this.app.world.actors[member.actor];
      if (!actor) throw new Error('角色资源缺失：' + member.actor);
      needed.push(...characterAssets(actor));
    }
    const lease = await cancellable(loadSceneAssets(this, needed, () => {}, true), signal, lease => lease.release());
    if (signal.aborted || revision !== this.revision || !this.sys.isActive()) {
      lease.release(); signal.throwIfAborted(); throw new DOMException('演出舞台已更新', 'AbortError');
    }
    const character = this.app.session.character;
    if (character) {
      this.wardrobe ??= new Wardrobe(this, this.app.wardrobe, this.app.items);
      try {
        const outfit = await cancellable(this.wardrobe.prepare(character.appearance, this.app.session.bag.equipmentItems(), character.classId), signal);
        signal.throwIfAborted();
        if (revision !== this.revision) throw new DOMException('演出舞台已更新', 'AbortError');
        this.wardrobe.activate(outfit); appearance = outfit.actor;
      } catch (error) { lease.release(); throw error; }
    }
    this.releaseStage(true); this.lease = lease; this.map = map;
    this.clearMap = drawStoryMap(this, map);
    this.movement = new MovementWorld(this, new NavigationWorld(map));
    this.player = createCharacter(this, appearance, { id: 'player', actor: this.app.campaign.start.actor, x: stage.x, y: stage.y });
    this.movement.register(this.player, true, true, 'party');
    this.facing = stage.facing;
    setCharacterClip(this, this.player, `idle-${stage.facing}`);
    this.player.container.setVisible(stage.playerVisible);
    this.movement.setEnabled(this.player, stage.playerVisible);
    this.resizeView(); this.cameras.main.centerOn(stage.x, stage.y);
    // 到这里地图已经成功画好，再盖上不透明底色；加载失败/取消时不会提前遮住世界。
    this.setWorldCovered(true);
    this.app.audio?.enterMap(stage.map);
  }
  resizeView(): void {
    if (!this.map) return;
    const camera = this.cameras.main, zoom = worldZoom(this);
    camera.setZoom(zoom).setRoundPixels(true);
    const width = Math.max(this.map.width, this.scale.width / zoom), height = Math.max(this.map.height, this.scale.height / zoom);
    camera.setBounds((this.map.width - width) / 2, (this.map.height - height) / 2, width, height);
  }
  releaseStage(preserveEarlyCurtain = false): void {
    // 先恢复透明：最终释放到场景 stop 之间露出下面已经切换好的世界，避免黑帧。
    this.setWorldCovered(false);
    this.revision++;
    if (!preserveEarlyCurtain) this.clearEarlyCurtain();
    this.movement?.destroy(); this.movement = undefined;
    if (this.player?.container.scene) this.player.container.destroy();
    this.player = undefined;
    this.clearMap?.(); this.clearMap = undefined;
    this.lease?.release(); this.lease = undefined; this.map = undefined;
  }
}
