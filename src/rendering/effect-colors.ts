import type { EffectBlend, EffectClip, EffectLayer, EffectOperation } from '../domain/content.ts';

/**
 * 颜色与混合的公共判断：特效的每个层该按哪种方式画、哪些运算必须读背景。
 *
 * 原版给一帧挂一串滤镜，滤镜按顺序作用在「背景通道」和「源通道」上，透明度是链末的最后一步
 * （证据见 `work/findings/56_effect_color_operations.md`）。这里不碰 Phaser，
 * 内容校验在 node 下也要跑；模式名到引擎常量的映射在 `blend-modes.ts`。
 */

/** 运行时支持的导出契约版本，与 `work/tools/game_content/effects.py` 同值。 */
export const EFFECT_FORMAT_VERSION = 1;

/** 原版滤镜运算名，按 `SNASYS_ApplyFrameFilter` 的位序排列。 */
export const EFFECT_OPERATIONS: readonly EffectOperation[] =
  ['multiply', 'add', 'screen', 'hard-light', 'color-dodge', 'overlay'];

/** 能直接混合的绘制方式，对应 Phaser 的普通/正片叠底/滤色/相加。 */
export const DIRECT_BLENDS: readonly Exclude<EffectBlend, 'backdrop'>[] = ['normal', 'multiply', 'screen', 'add'];

/** 一层特效怎么画：按某种混合方式直接画，还是按整条原版滤镜链读背景合成。 */
type LayerDraw = { kind: 'blend'; blend: Exclude<EffectBlend, 'backdrop'> } | { kind: 'backdrop'; operations: EffectOperation[] };

/**
 * `backdrop` 层在没有背景合成路径时用的混合方式。
 *
 * 原版这两个运算按背景截顶或按背景分支，离线折不出精确的两层编码；读背景的合成
 * 还没接通（见 findings/56），所以先按最接近的相加画，颜色偏亮的部分记在那篇的差异里。
 */
export function backdropApproximation(operations: EffectOperation[]): Exclude<EffectBlend, 'backdrop'> {
  return operations.includes('multiply') ? 'multiply' : 'add';
}

/**
 * 一层的绘制方式；`backdrop` 层带上它的整条原版滤镜链。
 *
 * 走离线还是走背景由导出阶段按等价性决定：折不成「系数×背景＋亮度」的运算，
 * 以及相加在部分透明时那样分段的情形，都由导出打上 `backdrop`。
 */
export function layerDraw(layer: EffectLayer): LayerDraw {
  if (layer.blend !== 'backdrop') return { kind: 'blend', blend: layer.blend };
  if (!layer.operations.length) throw new Error(`backdrop 层没有可作用的运算：${layer.key}`);
  return { kind: 'backdrop', operations: layer.operations };
}

/** 一层是否能画：契约版本、运算名和绘制方式都要认得出。返回问题描述，`null` 表示可以画。 */
export function effectLayerProblem(clip: EffectClip, layer: EffectLayer): string | null {
  if (clip.version !== EFFECT_FORMAT_VERSION) {
    return `特效契约版本不匹配：${layer.key} 是 ${clip.version}，运行时支持 ${EFFECT_FORMAT_VERSION}`;
  }
  for (const operation of layer.operations) {
    if (!EFFECT_OPERATIONS.includes(operation)) return `未核实的颜色运算：${layer.key} ${operation}`;
  }
  if (layer.blend === 'backdrop') {
    return layer.operations.length ? null : `backdrop 层没有可作用的运算：${layer.key}`;
  }
  return DIRECT_BLENDS.includes(layer.blend) ? null : `未核实的绘制方式：${layer.key} ${layer.blend}`;
}

/** 一份内容里的全部特效是否能画；问题逐条列出，供校验器与启动检查使用。 */
export function effectProblems(effects: Record<string, { clips: Record<string, EffectClip> }>): string[] {
  const problems: string[] = [];
  for (const [name, effect] of Object.entries(effects)) {
    for (const clip of Object.values(effect.clips)) {
      for (const layer of clip.layers) {
        const problem = effectLayerProblem(clip, layer);
        if (problem) problems.push(`${name}: ${problem}`);
      }
    }
  }
  return problems;
}
