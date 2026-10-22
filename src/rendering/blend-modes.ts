import Phaser from 'phaser';
import type { BlendName } from '../domain/content.ts';

/**
 * 混合模式名到 Phaser 混合模式的公共映射，人物、场景物件和特效共用。
 *
 * Phaser 对这几个名字都有原生混合模式，映射本身是常量；`color-dodge` 没有，
 * 它走各自的合成路径（场景物件见 `scenes/world-scene.ts`，特效见 `effects.ts`），
 * 所以在这里标成 `unsupported`，取用时直接报错，而不是悄悄画成普通混合。
 *
 * 写成 `Record<BlendName, …>` 而不是 `Partial`：新增一个混合方式时必须在这里明确表态——
 * 要么给出对应的 Phaser 模式，要么标成 `unsupported` 并说明它走自己的合成路径。
 */
const BLEND_MODES: Record<BlendName, Phaser.BlendModes | 'unsupported'> = {
  normal: Phaser.BlendModes.NORMAL,
  multiply: Phaser.BlendModes.MULTIPLY,
  screen: Phaser.BlendModes.SCREEN,
  add: Phaser.BlendModes.ADD,
  'color-dodge': 'unsupported',
};

export function blendModeOf(name: BlendName): Phaser.BlendModes {
  const mode = BLEND_MODES[name];
  if (mode === 'unsupported') throw new Error(`颜色混合模式没有 Phaser 对应：${name}`);
  return mode;
}
