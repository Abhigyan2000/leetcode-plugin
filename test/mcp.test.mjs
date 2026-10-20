import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.mjs';
import { LeetCodeClient } from '../src/client.mjs';

async function connect(t) {
  const server = createServer(new LeetCodeClient({ credentials: async () => ({ source: 'none' }),
    fetchImpl: async () => { throw new Error('Network should not be used'); } }));
  const client = new Client({ name: 'fixture-client', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  t.after(() => client.close());
  return client;
}

test('MCP advertises account writes separately from read tools', async t => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 10);
  for (const name of ['submit_solution', 'run_code']) {
    const tool = tools.find(t => t.name === name);
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.idempotentHint, false);
  }
  assert.equal(tools.find(t => t.name === 'list_solved_problems').annotations.readOnlyHint, true);
});

test('unauthenticated MCP tools return clear errors, not invented account data', async t => {
  const client = await connect(t);
  const result = await client.callTool({ name: 'list_solved_problems', arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).code, 'AUTH_REQUIRED');
});

test('MCP schema rejects path injection and unreasonable pagination', async t => {
  const client = await connect(t);
  for (const args of [{ name: 'get_problem', arguments: { titleSlug: '../../secret' } },
    { name: 'list_submissions', arguments: { limit: 1000000 } },
    { name: 'check_result', arguments: { judgeId: 'https://other.example' } }]) {
    const result = await client.callTool(args);
    assert.equal(result.isError, true);
  }
});
