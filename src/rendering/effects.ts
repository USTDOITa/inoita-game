import Phaser from 'phaser';
import type { AttackEffectDefinition } from '../domain/battle.ts';
import type { EffectClip } from '../domain/content.ts';
import type { PendingAsset } from './scene-assets.ts';
import { backdropApproximation, layerDraw } from './effect-colors.ts';
import { blendModeOf } from './blend-modes.ts';

/**
 * 共用特效渲染器：普攻和技能都从这里建特效、播放、释放。
 *
 * 绝大多数层的结果只由它自己和背景的仿射关系决定，按 Phaser 的混合模式直接画。
 * `backdrop` 层的运算结果依赖背景像素本身（颜色减淡要按背景截顶），导出阶段已经
 * 把它们单独标出来，但游戏里还没有读背景的合成路径，暂时按最接近的混合模式画，
 * 差异记在 `work/findings/56_effect_color_operations.md`。
 */
export function effectAssets(effects: Record<string, AttackEffectDefinition>): PendingAsset[] {
  return Object.values(effects).flatMap(effect => Object.values(effect.clips).flatMap(clip => clip.layers.map(layer => ({
    kind: 'spritesheet' as const, key: layer.key, file: layer.file,
    config: { frameWidth: clip.frameWidth, frameHeight: clip.frameHeight, endFrame: clip.frames - 1 }
  }))));
}

export function createEffect(scene: Phaser.Scene, clip: EffectClip, x: number, y: number, loop = false): Phaser.GameObjects.Container {
  const effect = scene.add.container(x, y).setDepth(y + 1);
  setEffectClip(scene, effect, clip, loop);
  return effect;
}

/** 投射物转向时更换方向素材，保留动画帧和帧内进度。 */
export function setEffectClip(scene: Phaser.Scene, effect: Phaser.GameObjects.Container, clip: EffectClip, loop: boolean): void {
  const previous = (effect.list[0] as Phaser.GameObjects.Sprite | undefined)?.anims;
  const startFrame = previous?.currentFrame ? (previous.currentFrame.index - 1) % clip.frames : 0;
  const elapsed = previous?.accumulator ?? 0;
  effect.removeAll(true);
  for (const layer of clip.layers) {
    const sprite = scene.add.sprite(0, 0, layer.key).setOrigin(clip.originX, clip.originY)
      .setScale(clip.mirrorX ? -1 : 1, 1);
    if (!scene.anims.exists(layer.key)) {
      scene.anims.create({ key: layer.key, frames: scene.anims.generateFrameNumbers(layer.key, { start: 0, end: clip.frames - 1 }), frameRate: clip.frameRate });
    }
    const draw = layerDraw(layer);
    sprite.setBlendMode(blendModeOf(draw.kind === 'backdrop' ? backdropApproximation(layer.operations) : draw.blend));
    effect.add(sprite);
    if (effect.length === 1 && !loop) sprite.once('animationcomplete', () => effect.destroy());
    sprite.play({ key: layer.key, startFrame, repeat: loop ? -1 : 0 });
    sprite.anims.accumulator = elapsed;
  }
}
