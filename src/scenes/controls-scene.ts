import { SCENE_KEYS } from '../application/scene-keys.ts';
import Phaser from 'phaser';

/** 单摄像机界面场景：DOMElement 显示高清图片，Phaser 命中区处理输入。 */
export class ControlsScene extends Phaser.Scene {
  constructor() { super(SCENE_KEYS.controlsUi); }
}
