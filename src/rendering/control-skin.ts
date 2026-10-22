import type { ControlSkin } from '../domain/control-skin.ts';
import type { PendingAsset } from './scene-assets.ts';

export function controlSkinAssets(skin: ControlSkin): PendingAsset[] {
  return Object.values(skin).map(file => ({ kind: 'image', key: file, file }));
}
