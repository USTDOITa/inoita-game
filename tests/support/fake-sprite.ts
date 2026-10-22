import { EventEmitter } from 'node:events';

/**
 * 技能播放与特效用例共用的假 `Sprite`：只是 Phaser `Sprite` 的链式调用面。
 *
 * 为什么值得共用：各用例都是把假对象 `as unknown as Sprite` 塞进生产代码的，类型上不会
 * 失败——生产代码多调一个 sprite 方法，五个替身会**在运行时**炸。这几个替身声明的
 * 链式方法高度重合（`setOrigin`/`setBlendMode`/`setTexture`/`setScale`/`setVisible`/`play`），
 * 加在这里就是一次到位。
 *
 * 需要真的记下某个值的用例在本地覆写（`setScale` 记 `scaleX`、`play` 记 `repeat`、
 * `setVisible` 记 `visible`），**不要为了基类好看把记录行为搬上来**——那会让不记录它的
 * 用例也长得像记录了。
 *
 * `anims` 故意不在这里：五个替身有四种互不兼容的形状（有的只放 `accumulator`、
 * 有的自己维护 `currentFrame` 并派发动画事件、`multiple-shot-facing` 用的是真的
 * `AnimationState`），统一它只会把差异藏起来。
 */
export class FakeSprite extends EventEmitter {
  setOrigin(..._args: unknown[]): this { return this; }
  setBlendMode(..._args: unknown[]): this { return this; }
  setTexture(..._args: unknown[]): this { return this; }
  setScale(..._args: unknown[]): this { return this; }
  setVisible(..._args: unknown[]): this { return this; }
  play(..._args: unknown[]): this { return this; }
  destroy(): void { this.removeAllListeners(); }
}
