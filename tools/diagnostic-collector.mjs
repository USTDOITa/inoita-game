import fs from 'node:fs/promises';
import path from 'node:path';

/** 开发服务与 4002 打包静态服务共用。JSONL 每行一条记录，保存当前文件和一份轮转文件。 */
export function createDiagnosticMiddleware(root) {
  const directory = path.join(root, '.diagnostics');
  const file = path.join(directory, 'client-errors.jsonl');
  let writes = Promise.resolve();
  async function save(entries) {
    await fs.mkdir(directory, { recursive: true });
    let size = 0;
    try { size = (await fs.stat(file)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const receivedAt = new Date().toISOString();
    const text = entries.map(entry => JSON.stringify({ receivedAt, ...entry }) + '\n').join('');
    if (size + Buffer.byteLength(text) > 2 * 1024 * 1024) {
      await fs.rename(file, path.join(directory, 'client-errors.previous.jsonl'));
    }
    await fs.appendFile(file, text, 'utf8');
  }
  return function diagnostics(req, res, next) {
    if (req.url?.split('?')[0] !== '/__diagnostics/report') { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.writeHead(405); res.end(); return; }
    let bytes = 0, oversized = false;
    const chunks = [];
    req.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 65536) {
        if (!oversized) { oversized = true; chunks.length = 0; res.writeHead(413); res.end(); }
      } else if (!oversized) chunks.push(chunk);
    });
    req.on('error', () => { if (!res.writableEnded) { res.writeHead(400); res.end(); } });
    req.on('end', () => {
      if (oversized) return;
      let entries;
      try {
        const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        entries = report.entries;
        if (report.version !== 1 || !Array.isArray(entries) || !entries.length || entries.length > 3
          || entries.some(entry => !entry || typeof entry.id !== 'string' || typeof entry.kind !== 'string'
            || typeof entry.time !== 'string' || JSON.stringify(entry).length > 12000)) throw new Error('Invalid report');
      } catch { res.writeHead(400); res.end(); return; }
      const write = writes.then(() => save(entries));
      writes = write.catch(() => {});
      void write.then(() => { res.writeHead(204); res.end(); }, () => { res.writeHead(500); res.end(); });
    });
  };
}
