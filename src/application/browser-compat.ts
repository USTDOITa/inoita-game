/**
 * 离线 APK 跑在设备自带的 Android System WebView 上，引擎版本随系统而定。
 * 本项目按 es2020（约等于 Chrome 80）构建，但下面这些浏览器 API 晚于这个版本，
 * 缺了它们，游戏会在启动或加载中途抛 `TypeError`，而不是给出可理解的错误。
 *
 * 这个模块在入口最先执行：浏览器已有原生实现时全部原样保留，只在缺失时补齐。
 * 兼容基线由此固定为 Chrome 80；要放宽或收紧，改这里而不是在调用点加判断。
 */

const ABORT_MESSAGE = 'This operation was aborted';

function abortError(): DOMException {
  return new DOMException(ABORT_MESSAGE, 'AbortError');
}

/** Chrome 98 加入 `AbortSignal.reason`。旧引擎只记录「已取消」，不保存原因。 */
function installAbortReason(): void {
  if ('reason' in AbortSignal.prototype) return;
  const reasons = new WeakMap<AbortSignal, unknown>();
  const abort = AbortController.prototype.abort;
  AbortController.prototype.abort = function (this: AbortController, reason?: unknown): void {
    if (!this.signal.aborted) reasons.set(this.signal, reason === undefined ? abortError() : reason);
    abort.call(this, reason);
  };
  Object.defineProperty(AbortSignal.prototype, 'reason', {
    configurable: true,
    get(this: AbortSignal): unknown {
      return this.aborted ? reasons.get(this) : undefined;
    }
  });
}

/**
 * Chrome 100 加入 `AbortSignal.prototype.throwIfAborted`。
 * 规范语义：未取消时什么都不做；已取消时抛出取消原因，没有原因就抛 AbortError。
 */
function installThrowIfAborted(): void {
  if (typeof AbortSignal.prototype.throwIfAborted === 'function') return;
  Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', {
    configurable: true,
    writable: true,
    value(this: AbortSignal): void {
      if (!this.aborted) return;
      throw this.reason ?? abortError();
    }
  });
}

/** Chrome 98 加入 `structuredClone`。这里覆盖游戏状态用到的标准类型，并保留循环引用。 */
function cloneUnknown(value: unknown, seen: Map<object, unknown>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const source = value as object;
  if (seen.has(source)) return seen.get(source);

  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength).slice();
    if (value instanceof DataView) return new DataView(bytes.buffer);
    const View = value.constructor as new (buffer: ArrayBuffer) => ArrayBufferView;
    return new View(bytes.buffer);
  }
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    seen.set(source, copy);
    for (const [key, entry] of value) copy.set(cloneUnknown(key, seen), cloneUnknown(entry, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>();
    seen.set(source, copy);
    for (const entry of value) copy.add(cloneUnknown(entry, seen));
    return copy;
  }
  if (Array.isArray(value)) {
    const copy = new Array<unknown>(value.length);
    seen.set(source, copy);
    for (let index = 0; index < value.length; index++) {
      if (index in value) copy[index] = cloneUnknown(value[index], seen);
    }
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(source, copy);
  for (const key of Object.keys(value)) copy[key] = cloneUnknown((value as Record<string, unknown>)[key], seen);
  return copy;
}

function installStructuredClone(): void {
  if (typeof globalThis.structuredClone === 'function') return;
  (globalThis as { structuredClone?: <T>(value: T) => T }).structuredClone = <T>(value: T): T =>
    cloneUnknown(value, new Map()) as T;
}

/** Chrome 92 加入 `Array.prototype.at`。游戏用它取数组末尾（`.at(-1)`）。 */
function installArrayAt(): void {
  if (typeof Array.prototype.at === 'function') return;
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    writable: true,
    value(this: ArrayLike<unknown>, index: number): unknown {
      const length = this.length;
      let position = Math.trunc(index) || 0;
      if (position < 0) position += length;
      return position < 0 || position >= length ? undefined : this[position];
    }
  });
}

/** Chrome 93 加入 `Object.hasOwn`。 */
function installObjectHasOwn(): void {
  if (typeof Object.hasOwn === 'function') return;
  Object.defineProperty(Object, 'hasOwn', {
    configurable: true,
    writable: true,
    value(object: object, property: PropertyKey): boolean {
      return Object.prototype.hasOwnProperty.call(object, property);
    }
  });
}

/** Chrome 85 加入 `String.prototype.replaceAll`。 */
function installStringReplaceAll(): void {
  if (typeof String.prototype.replaceAll === 'function') return;
  Object.defineProperty(String.prototype, 'replaceAll', {
    configurable: true,
    writable: true,
    value(this: string, search: string | RegExp, replacement: string | ((substring: string, ...args: any[]) => string)): string {
      if (search instanceof RegExp && !search.global) throw new TypeError('replaceAll 的 RegExp 必须带 g 标志');
      const pattern = search instanceof RegExp
        ? search
        : new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      return typeof replacement === 'string'
        ? this.replace(pattern, replacement)
        : this.replace(pattern, replacement);
    }
  });
}

installAbortReason();
installThrowIfAborted();
installStructuredClone();
installArrayAt();
installObjectHasOwn();
installStringReplaceAll();

export {};
