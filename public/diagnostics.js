/* 在游戏模块之前安装，诊断发送不依赖 Phaser 的帧循环。 */
(() => {
  if (window.storyDiagnostics) return;
  const storageKey = 'inotia4.diagnostics.pending.v1';
  const endpoint = new URL('./__diagnostics/report', document.currentScript.src).href;
  const session = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  let sequence = 0, sending = false, snapshot = () => null;
  let pending = [], recent = [], capturing = false;
  let lastFrame = 0, phase = 'boot', stalled = false, visibleSince = Date.now();

  // 限制深度和长度；错误对象、循环引用和带异常 getter 的对象都能记录。
  function safe(value, depth = 0, seen = new WeakSet()) {
    try {
      if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
      if (typeof value === 'string') return value.slice(0, 2000);
      if (typeof value !== 'object') return String(value).slice(0, 2000);
      if (seen.has(value)) return '[Circular]';
      if (depth >= 6) return '[Depth limit]';
      seen.add(value);
      if (value instanceof Error || Object.prototype.toString.call(value) === '[object Error]') {
        return { name: safe(value.name), message: safe(value.message), stack: safe(value.stack),
          cause: safe(value.cause, depth + 1, seen) };
      }
      if (Array.isArray(value)) return value.slice(0, 20).map(item => safe(item, depth + 1, seen));
      const result = {};
      for (const key of Object.keys(value).slice(0, 20)) {
        try { result[key] = safe(value[key], depth + 1, seen); }
        catch { result[key] = '[Unreadable]'; }
      }
      return result;
    } catch { return '[Unserializable]'; }
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(pending)); } catch { /* 手机可能禁用存储。 */ }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) pending = saved.filter(item => item && typeof item.id === 'string'
      && JSON.stringify(item).length <= 12000).slice(-32);
  } catch { /* 损坏的诊断缓存不影响游戏启动。 */ }

  async function flush() {
    if (sending || !pending.length) return;
    sending = true;
    // 单条最多约 36 KB，包含中文时仍低于 keepalive 的 64 KB 限制。
    const batch = pending.slice(0, 1);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 1, entries: batch }), keepalive: true, signal: controller.signal });
      if (response.ok) {
        const ids = new Set(batch.map(item => item.id));
        pending = pending.filter(item => !ids.has(item.id));
        persist();
      }
    } catch { /* 发送失败保留待发记录，避免诊断错误递归。 */ }
    finally { clearTimeout(timeout); sending = false; }
  }
  function record(kind, details) {
    if (capturing) return;
    capturing = true;
    try {
      let state;
      try { state = safe(snapshot()); } catch (error) { state = { snapshotError: safe(error) }; }
      const entry = { id: session + ':' + (++sequence), session, time: new Date().toISOString(), kind,
        page: location.pathname, userAgent: navigator.userAgent, visibility: document.visibilityState,
        viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
        frame: { phase, lastFrameAgoMs: lastFrame ? Date.now() - lastFrame : null },
        details: safe(details), state };
      if (JSON.stringify(entry).length > 12000) {
        entry.details = { truncated: JSON.stringify(entry.details).slice(0, 4000) };
        entry.state = { truncated: JSON.stringify(entry.state).slice(0, 4000) };
      }
      recent.push(entry); recent = recent.slice(-32);
      pending.push(entry); pending = pending.slice(-32);
      persist();
      void flush();
    } catch { /* 收集器不能成为新的游戏异常来源。 */ }
    finally { capturing = false; }
  }

  const originalError = console.error;
  console.error = function (...args) {
    record('console-error', { args, callStack: new Error('console.error').stack });
    return originalError.apply(this, args);
  };
  window.addEventListener('error', event => {
    const target = event.target;
    if (target && target !== window) {
      record('resource-error', { tag: target.tagName, url: target.currentSrc || target.src || target.href });
    } else {
      record('window-error', { message: event.message, file: event.filename, line: event.lineno,
        column: event.colno, error: event.error });
    }
  }, true);
  window.addEventListener('unhandledrejection', event => record('unhandled-rejection', { reason: event.reason }));
  window.addEventListener('pagehide', () => { void flush(); });
  document.addEventListener('visibilitychange', () => { visibleSince = Date.now(); stalled = false; });
  document.addEventListener('webglcontextlost', event => record('webgl-context-lost', { status: event.statusMessage }), true);
  window.storyDiagnostics = {
    record, flush,
    setSnapshot(provider) { snapshot = provider; },
    markFrame(nextPhase) { phase = nextPhase; lastFrame = Date.now(); stalled = false; },
    stopFrames() { lastFrame = 0; phase = 'stopped'; },
    export() { return JSON.stringify({ version: 1, entries: recent, pending }, null, 2); }
  };
  // 真正阻塞整个 JavaScript 线程时此计时器也不能执行；异常造成的停帧可以记录。
  setInterval(() => {
    if (lastFrame && document.visibilityState === 'visible' && !stalled
      && Date.now() - Math.max(lastFrame, visibleSince) > 5000) {
      stalled = true;
      record('frame-stalled', { message: '游戏超过 5 秒未进入下一帧' });
    }
    void flush();
  }, 2000);
  record('collector-start', { message: '手机诊断收集器已启动', version: 1 });
})();
