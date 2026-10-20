import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

const root = 'plugins/leetcode';
const files = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) files[relative(root, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
  }
}
await collect(root);
const manifest = JSON.parse(await readFile(join(root, 'plugin.json')));
if (!files['server/index.mjs'] || !files['scripts/auth.mjs']) throw new Error('Run npm run build first.');
await mkdir('artifacts', { recursive: true });
const target = `artifacts/leetcode-plugin-v${manifest.version}.zip`;
await writeFile(target, zipSync(files));
console.log(target);
