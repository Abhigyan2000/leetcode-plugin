import { build } from 'esbuild';
import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

await mkdir('plugins/leetcode/server', { recursive: true });
await mkdir('plugins/leetcode/scripts', { recursive: true });
const result = await build({ entryPoints: { 'server/index': 'src/entry.mjs', 'scripts/auth': 'src/auth.mjs' },
  outdir: 'plugins/leetcode', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node',
  format: 'esm', target: 'node22', packages: 'bundle', legalComments: 'eof', metafile: true,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
for (const name of ['README.md', 'LICENSE', 'PRIVACY.md', 'SECURITY.md']) {
  await copyFile(name, `plugins/leetcode/${name}`);
}
const packageRoots = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (match) packageRoots.add(match[1]);
}
const notices = ['Third-party packages included in the standalone server bundle.\n'];
for (const root of [...packageRoots].sort()) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const licenses = (await readdir(root)).filter(name => /^(license|licence|copying)(\..*)?$/i.test(name)).sort();
  notices.push(`\n=== ${pkg.name}@${pkg.version} (${pkg.license || 'see package license'}) ===\n`);
  if (!licenses.length) throw new Error(`No license file found for bundled package ${pkg.name}`);
  for (const license of licenses) notices.push(await readFile(join(root, license), 'utf8'));
}
await writeFile('plugins/leetcode/THIRD_PARTY_NOTICES.txt', notices.join('\n'));
console.log('Built standalone plugin (no runtime npm install required).');
