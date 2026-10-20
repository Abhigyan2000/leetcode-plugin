import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { unzipSync } from 'fflate';

// Use an isolated installation path containing spaces and no node_modules.
const directory = await mkdtemp(join(tmpdir(), 'leetcode plugin smoke '));
const root = join(directory, 'installed plugin');
const archive = process.argv[2];
if (archive) {
  for (const [name, bytes] of Object.entries(unzipSync(await readFile(archive)))) {
    const target = resolve(root, name);
    assert.ok(target.startsWith(resolve(root) + sep), 'ZIP entry must stay inside the installation');
    if (name.endsWith('/')) { await mkdir(target, { recursive: true }); continue; }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
} else await cp('plugins/leetcode', root, { recursive: true });
const manifest = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));
assert.equal(manifest.name, 'leetcode');
const mcp = JSON.parse(await readFile(join(root, 'mcp.json'), 'utf8'));
const server = mcp.mcpServers.leetcode;
assert.equal(server.command, 'node');
assert.equal(server.type, 'stdio');
const client = new Client({ name: 'release-smoke', version: '1.0.0' });
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith('LEETCODE_')));
env.LEETCODE_CREDENTIALS_FILE = join(directory, 'no-credentials.json');
const expand = value => value.replaceAll('${PLUGIN_ROOT}', root);
const transport = new StdioClientTransport({ command: process.execPath, args: server.args.map(expand), cwd: expand(server.cwd), env, stderr: 'pipe' });
let stderr = '';
transport.stderr?.on('data', chunk => { stderr += chunk; });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 10);
  const status = await client.callTool({ name: 'auth_status', arguments: {} });
  assert.equal(JSON.parse(status.content[0].text).connected, false);
  const write = await client.callTool({ name: 'submit_solution', arguments: { titleSlug: 'two-sum', lang: 'python3', code: 'class Solution: pass' } });
  assert.equal(write.isError, true);
  assert.equal(JSON.parse(write.content[0].text).code, 'AUTH_REQUIRED');
  console.log('Standalone installed plugin: MCP handshake, 10 tools, safe disconnected state, and protected submission verified.');
} catch (error) {
  console.error(stderr);
  throw error;
} finally {
  await client.close();
  await rm(directory, { recursive: true, force: true });
}
