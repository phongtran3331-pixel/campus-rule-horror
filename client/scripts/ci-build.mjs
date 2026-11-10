// CI 构建包装：在 GitHub Actions 上构建失败时，把错误输出转成 ::error:: 注解，
// 使错误可通过 check-runs 公共 API 读取，便于诊断 Linux 下的构建差异。
// 本地运行行为与直接执行 `tsc --noEmit && vite build` 一致。
import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: process.env,
  });
  const out = [r.stdout, r.stderr].filter(Boolean).join('');
  if (out) process.stdout.write(out);
  return { code: r.status ?? 1, out };
}

let step = run('npx', ['tsc', '--noEmit']);
if (step.code === 0) step = run('npx', ['vite', 'build']);

if (step.code !== 0) {
  const lines = step.out
    .split('\n')
    .filter((l) => l.trim())
    .slice(-40);
  for (const l of lines) console.log(`::error::${l}`);
}

process.exit(step.code);
