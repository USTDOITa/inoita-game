import type { StatusHudSkin } from '../domain/status-hud.ts';

export function statusHudAssets(skin:StatusHudSkin) {
  return [...Object.values(skin.assets),...Object.values(skin.buffIcons.catalog)]
    .map(file=>({kind:'image' as const,key:file,file}));
}
