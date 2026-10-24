/**
 * E2E 用的预览服务：先以 BASE_PATH=/ 构建，再启动 vite preview。
 * 这样测试里的 page.goto('/') 就能直接命中根路径。
 */
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, BASE_PATH: '/' };
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const build = spawnSync(process.execPath, [vite, 'build'], { cwd: root, env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const preview = spawn(process.execPath, [vite, 'preview', '--port', '4399', '--strictPort', '--host', '127.0.0.1'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
preview.on('exit', (code) => process.exit(code ?? 0));
