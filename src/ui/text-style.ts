/**
 * 全游戏共用的字体栈。
 *
 * 单独成一个不依赖任何东西的模块，是因为消费方里有 `rendering/pickup-messages.ts`
 * 这类**不使用 Phaser** 的模块：它原先只有 `import type Phaser`（会被擦除），
 * 一旦改成从 `ui/phaser/widgets.ts` 取字体，就会把整个 Phaser 运行时拉进来，
 * 在 Node 环境下直接因 `window is not defined` 崩掉。
 *
 * 宋体优先，其次思源宋体（Linux 上更常见），再退到 SimSun 与通用衬线。
 */
export const FONT = '"Songti SC", "Noto Serif CJK SC", SimSun, serif';
