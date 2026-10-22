import type { Point } from './navigation.ts';
import { NavigationWorld, type NavigationActor } from './navigation-world.ts';
import { canTraverse } from './pathfinding.ts';

/** 走到指定脚点的路线；动态阻挡时限频重算，失败由播放流程处理。 */
export class WalkRoute {
  readonly destination: Point;
  state: 'walking' | 'arrived' | 'failed' = 'walking';
  error?: Error;
  private readonly navigation: NavigationWorld;
  private readonly actor: NavigationActor;
  private path: Point[] = [];
  private elapsed = 0;
  private nextSearch = 0;
  private lastProgress = 0;
  private progressPosition: Point;
  private readonly timeout: number;
  constructor(navigation: NavigationWorld, actor: NavigationActor, destination: Point, speed: number) {
    this.navigation = navigation; this.actor = actor; this.destination = { ...destination };
    this.progressPosition = { ...actor.position() };
    const path = navigation.path(actor, destination);
    if (!path) { this.state = 'failed'; this.error = new Error('道路不可达'); }
    this.path = path ?? [];
    let previous = actor.position(), distance = 0;
    for (const point of this.path) { distance += Math.hypot(point.x - previous.x, point.y - previous.y); previous = point; }
    this.timeout = distance / speed * 1000 + 3000;
  }
  next(deltaMs: number): Point | undefined {
    if (this.state !== 'walking') return;
    this.elapsed += deltaMs;
    const current = this.actor.position();
    if (Math.hypot(current.x - this.destination.x, current.y - this.destination.y) <= .01) { this.state = 'arrived'; return; }
    if (this.elapsed > this.timeout) { this.state = 'failed'; this.error = new Error('人物未能到达'); return; }
    while (this.path.length && Math.hypot(current.x - this.path[0].x, current.y - this.path[0].y) <= .01) this.path.shift();
    if (Math.hypot(current.x - this.progressPosition.x, current.y - this.progressPosition.y) >= .5) {
      this.lastProgress = this.elapsed; this.progressPosition = { ...current };
    }
    const traversable = (p: Point) => this.navigation.canStand(this.actor, p);
    const blocked = !this.path.length || !canTraverse(current, this.path[0], traversable);
    if (this.elapsed >= this.nextSearch && (blocked || this.elapsed - this.lastProgress >= 250)) {
      this.nextSearch = this.elapsed + 250;
      this.lastProgress = this.elapsed;
      this.path = this.navigation.path(this.actor, this.destination) ?? [];
    }
    return this.path.length && canTraverse(current, this.path[0], traversable) ? this.path[0] : undefined;
  }
}
