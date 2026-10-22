import type { Point } from '../domain/navigation.ts';

interface MovingVisual extends Point { active: boolean }
interface MotionSample {
  position(): Point;
  enabled(): boolean;
  previous: Point;
  current: Point;
}

/** 保存已完成碰撞的两次位置，只在绘制期间借用人物容器的坐标。 */
export class MovementInterpolation {
  private remainingMs = 0;
  private stepMs = 1000 / 60;
  private readonly samples = new Map<MovingVisual, MotionSample>();
  private readonly restoredPositions = new Map<MovingVisual, Point>();

  register(visual: MovingVisual, position: () => Point, enabled: () => boolean): void {
    const current = position();
    this.samples.set(visual, { position, enabled, previous: current, current });
  }

  beginFrame(deltaMs: number): void {
    this.restore();
    this.remainingMs += deltaMs;
  }

  /** 每个物理步调用一次，长帧补步也逐次采样，保留最后两个结算位置。 */
  completeStep(durationMs: number): void {
    this.stepMs = durationMs;
    this.remainingMs -= durationMs;
    for (const sample of this.samples.values()) {
      sample.previous = sample.current;
      sample.current = sample.position();
      if (!sample.enabled()) sample.previous = sample.current;
    }
  }

  position(visual: MovingVisual): Point {
    const sample = this.samples.get(visual);
    if (!sample) return { x: visual.x, y: visual.y };
    if (!sample.enabled()) return sample.position();
    const fraction = Math.max(0, Math.min(1, this.remainingMs / this.stepMs));
    return {
      x: sample.previous.x + (sample.current.x - sample.previous.x) * fraction,
      y: sample.previous.y + (sample.current.y - sample.previous.y) * fraction
    };
  }

  apply(): void {
    this.restore();
    for (const [visual, sample] of this.samples) {
      if (!visual.active || !sample.enabled()) continue;
      this.restoredPositions.set(visual, { x: visual.x, y: visual.y });
      Object.assign(visual, this.position(visual));
    }
  }

  restore(): void {
    for (const [visual, position] of this.restoredPositions) {
      if (visual.active) Object.assign(visual, position);
    }
    this.restoredPositions.clear();
  }

  /** 瞬移、换装和重新启用时从实际落点开始显示。物理时钟的余量保持不变。 */
  reset(visual: MovingVisual): void {
    const saved = this.restoredPositions.get(visual);
    if (saved && visual.active) Object.assign(visual, saved);
    this.restoredPositions.delete(visual);
    const sample = this.samples.get(visual);
    if (sample) sample.previous = sample.current = sample.position();
  }

  remove(visual: MovingVisual): void { this.reset(visual); this.samples.delete(visual); }
  destroy(): void { this.restore(); this.samples.clear(); }
}
