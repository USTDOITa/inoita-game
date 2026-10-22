import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

type Execute = (command: string, args: string[], options: { cwd: string; stdio: 'inherit' }) => {
  status: number | null;
  error?: Error;
  signal?: string | null;
};

const usage = '请指定相关测试文件：npm test -- tests/example.test.ts；全量测试：npm run test:all';

function selectTests(args: string[], root: string): string[] {
  if (!args.length) throw new Error(usage);
  const directory = path.join(root, 'tests');
  if (args.length === 1 && args[0] === '--all') {
    const files = fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.test.ts'))
      .map(entry => path.join('tests', entry.name)).sort();
    if (!files.length) throw new Error('tests/ 中没有 .test.ts 文件');
    return files;
  }
  const files = args.map(argument => {
    const file = path.resolve(root, argument);
    if (argument.startsWith('-') || path.dirname(file) !== directory || !file.endsWith('.test.ts')
      || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`无效测试文件：${argument}。${usage}`);
    }
    return path.relative(root, file);
  });
  return [...new Set(files)];
}

export function runTests(args: string[], root: string, execute: Execute = spawnSync,
  report: (message: string) => void = console.error): number {
  try {
    const files = selectTests(args, root);
    const steps: [string, string[]][] = [
      ['npm', ['run', 'typecheck']],
      [process.execPath, ['--test', ...files]]
    ];
    for (const [command, parameters] of steps) {
      const result = execute(command, parameters, { cwd: root, stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.signal) throw new Error(`${command} 被信号 ${result.signal} 中断`);
      if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
  } catch (error) {
    report(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  process.exitCode = runTests(process.argv.slice(2), path.resolve(root));
}
