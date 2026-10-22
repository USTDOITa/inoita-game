import Phaser from 'phaser';

interface DiagnosticCollector {
  record(kind: string, details: unknown): void;
  flush(): Promise<void>;
  setSnapshot(provider: () => unknown): void;
  markFrame(phase: string): void;
  stopFrames(): void;
  export(): string;
}
declare global { var storyDiagnostics: DiagnosticCollector | undefined; }

/** 使用引擎事件观察帧阶段，不替换引擎的更新函数或异常处理。 */
export function installGameDiagnostics(game: Phaser.Game, snapshot: () => unknown): void {
  const collector = globalThis.storyDiagnostics;
  if (!collector) return;
  collector.setSnapshot(snapshot);
  const beforeUpdate = () => collector.markFrame('update');
  const beforeRender = () => collector.markFrame('render');
  const afterRender = () => collector.markFrame('idle');
  game.events.on(Phaser.Core.Events.PRE_STEP, beforeUpdate);
  game.events.on(Phaser.Core.Events.POST_STEP, beforeRender);
  game.events.on(Phaser.Core.Events.POST_RENDER, afterRender);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    game.events.off(Phaser.Core.Events.PRE_STEP, beforeUpdate);
    game.events.off(Phaser.Core.Events.POST_STEP, beforeRender);
    game.events.off(Phaser.Core.Events.POST_RENDER, afterRender);
    collector.stopFrames();
    collector.setSnapshot(() => null);
  });
}
