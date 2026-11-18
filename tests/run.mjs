import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = 3123;
const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      /* aguardando */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('O servidor não iniciou a tempo.');
}

function stop() {
  if (!server.killed) server.kill('SIGTERM');
}

try {
  await waitForServer();
  const smoke = spawn(process.execPath, ['tests/smoke.mjs'], {
    cwd: root,
    env: { ...process.env, BASE_URL: `http://127.0.0.1:${port}` },
    stdio: 'inherit',
  });
  const code = await new Promise((resolve) => smoke.on('exit', resolve));
  stop();
  process.exit(code ?? 1);
} catch (error) {
  console.error(error);
  stop();
  process.exit(1);
}
