import type Phaser from 'phaser';
import type { WorldMap } from '../domain/content.ts';
import { blendModeOf } from './blend-modes.ts';

let serial = 0;

/** 演出地图只绘制背景，不创建宝箱、商店、敌人或地图访问状态。 */
export function drawStoryMap(scene: Phaser.Scene, map: WorldMap): () => void {
  const images: Phaser.GameObjects.Image[] = [], textures: string[] = [];
  images.push(scene.add.image(0, 0, map.id + '-ground').setOrigin(0).setDepth(-10000));
  for (const feature of map.features) {
    const left = feature.x - (feature.flip ? feature.width - feature.offsetX : feature.offsetX);
    const top = feature.y - feature.offsetY;
    let key = feature.texture;
    if (feature.blend === 'color-dodge') {
      const ground = scene.textures.get(map.id + '-ground').getSourceImage() as HTMLImageElement;
      const prop = scene.textures.get(key).getSourceImage() as HTMLImageElement;
      const texture = scene.textures.createCanvas(`story-dodge-${++serial}`, feature.width, prop.height)!;
      textures.push(texture.key);
      const context = texture.context;
      context.drawImage(ground, left, top, feature.width, prop.height, 0, 0, feature.width, prop.height);
      const backdrop = context.getImageData(0, 0, feature.width, prop.height);
      const scratch = document.createElement('canvas');
      scratch.width = feature.width; scratch.height = prop.height;
      const sourceContext = scratch.getContext('2d')!;
      if (feature.flip) { sourceContext.translate(feature.width, 0); sourceContext.scale(-1, 1); }
      sourceContext.drawImage(prop, 0, 0);
      const source = sourceContext.getImageData(0, 0, feature.width, prop.height).data;
      for (let index = 0; index < backdrop.data.length; index += 4) {
        if (!source[index + 3]) continue;
        for (let channel = 0; channel < 3; channel++) {
          const foreground = source[index + channel], background = backdrop.data[index + channel];
          backdrop.data[index + channel] = background === 0 ? 0 : foreground === 255 ? 255 : Math.min(255, Math.floor(background * 255 / (255 - foreground)));
        }
      }
      context.putImageData(backdrop, 0, 0); texture.refresh(); key = texture.key;
    }
    const image = scene.add.image(left, top, key).setOrigin(0).setDepth(feature.y);
    if (feature.blend !== 'color-dodge') image.setFlipX(feature.flip).setBlendMode(blendModeOf(feature.blend));
    images.push(image);
  }
  images.push(scene.add.image(0, 0, map.id + '-canopy').setOrigin(0).setDepth(10000));
  return () => {
    for (const image of images) if (image.scene) image.destroy();
    for (const key of textures) if (scene.textures.exists(key)) scene.textures.remove(key);
  };
}
