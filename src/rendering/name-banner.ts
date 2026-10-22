import Phaser from 'phaser';
import type { Hud } from './hud.ts';
import { readSafeArea } from '../ui/viewport.ts';
import { FONT } from '../ui/text-style.ts';

/** 地图入场提示与附近交互对象共用的屏幕名称条。 */
export class NameBanner {
  private readonly scene: Phaser.Scene;
  private readonly hud: Hud;
  private readonly container: Phaser.GameObjects.Container;
  private readonly background: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private readonly mapName: string;
  private mapPending = true;
  private kind: 'map' | 'target' | null = null;
  private enabled = false;
  private timer?: Phaser.Time.TimerEvent;
  private tween?: Phaser.Tweens.Tween;
  private textWidth = 0;

  constructor(scene: Phaser.Scene, hud: Hud, mapName: string) {
    this.scene = scene; this.hud = hud; scene = hud.scene; this.mapName = mapName;
    this.background = new Phaser.GameObjects.Rectangle(scene, 0, 0, 1, 1, 0x000000, 0.55);
    this.label = scene.make.text({ x: 0, y: 0, text: '', style: {
      fontFamily: FONT, fontSize: '18px', color: '#fff4dc'
    } }, false).setOrigin(0.5);
    this.container = hud.add(scene.make.container({ x: 0, y: 0 }, false));
    this.container.add([this.background, this.label]); this.hud.setVisible(this.container, false);
  }

  layout(): void {
    const bounds = this.scene.game.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const safe = readSafeArea(), unit = this.scene.scale.height / bounds.height;
    const width = Math.min(480, Math.max(1, bounds.width - 2 * Math.max(safe.left, safe.right)) * 0.6) * unit;
    this.background.setSize(width, 34 * unit);
    this.container.setPosition(this.scene.scale.width / 2, (safe.top + 24 + 17) * unit);
    this.label.setFontSize(18 * unit);
    this.textWidth = Math.max(1, width - 32 * unit);
    this.fitText();
  }

  /** 输入被流程接管时暂停提示；恢复后先重新判断当前目标。 */
  sync(enabled: boolean, targetName: string | null): void {
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      if (this.timer) this.timer.paused = !enabled;
      if (enabled) this.tween?.resume(); else this.tween?.pause();
    }
    this.hud.setVisible(this.container, enabled && this.kind !== null);
    if (!enabled) return;
    if (targetName !== null) {
      if (this.kind === 'target' && this.label.text === targetName) return;
      this.cancelAnimation(); this.mapPending = false; this.kind = 'target';
      this.setText(targetName); this.container.setAlpha(1); this.hud.setVisible(this.container, true);
    } else if (this.kind === 'target') {
      this.kind = null; this.hud.setVisible(this.container, false);
    } else if (this.mapPending) {
      this.mapPending = false; this.kind = 'map'; this.setText(this.mapName);
      this.container.setAlpha(0); this.hud.setVisible(this.container, true);
      this.tween = this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 150,
        onComplete: () => {
          this.tween = undefined;
          this.timer = this.scene.time.delayedCall(2000, () => {
            this.timer = undefined;
            this.tween = this.scene.tweens.add({ targets: this.container, alpha: 0, duration: 400,
              onComplete: () => { this.tween = undefined; this.kind = null; this.hud.setVisible(this.container, false); }
            });
          });
        }
      });
    }
  }

  private setText(value: string): void { this.label.setText(value); this.fitText(); }
  private fitText(): void {
    this.label.setScale(1);
    if (this.textWidth && this.label.width > this.textWidth) this.label.setScale(this.textWidth / this.label.width);
  }
  private cancelAnimation(): void {
    this.timer?.remove(); this.timer = undefined;
    this.tween?.remove(); this.tween = undefined;
  }
  destroy(): void { this.cancelAnimation(); this.container.destroy(true); }
}
