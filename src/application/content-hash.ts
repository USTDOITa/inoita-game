import {createHash} from 'node:crypto';

/** 与生成器和构建期校验共用的稳定序列化：键排序、无空白。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 内容哈希只用于判断「产物是否对应当前输入」，不参与游戏逻辑。 */
export function contentDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 16);
}
