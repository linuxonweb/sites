import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
await rm(join(root, 'dist'), { recursive: true, force: true });
for (const directory of ['server', 'client', '.openai']) await mkdir(join(root, 'dist', directory), { recursive: true });
await copyFile(join(root, 'worker.mjs'), join(root, 'dist/server/index.js'));
await copyFile(join(root, '.openai/hosting.json'), join(root, 'dist/.openai/hosting.json'));
await writeFile(join(root, 'dist/client/index.html'), '<!doctype html><meta charset="utf-8"><title>Linux on Web</title><p>Linux on Web requires its server runtime.</p>\n');
console.log('Prepared dist/server/index.js, dist/client/index.html, and dist/.openai/hosting.json');
