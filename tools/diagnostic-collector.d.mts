import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * 诊断上报中间件：处理 POST /__diagnostics/report，其它请求交给 next()。
 * `root` 必须是项目根，日志写到 `<root>/.diagnostics/client-errors.jsonl`。
 */
export function createDiagnosticMiddleware(
  root: string,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
