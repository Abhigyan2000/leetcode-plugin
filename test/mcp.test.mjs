import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.mjs';
import { LeetCodeClient, LeetCodeError } from '../src/client.mjs';

async function connect(t, login, accountClient) {
  const server = createServer(accountClient || new LeetCodeClient({ credentials: async () => ({ source: 'none' }),
    fetchImpl: async () => { throw new Error('Network should not be used'); } }), login);
  const client = new Client({ name: 'fixture-client', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  t.after(() => client.close());
  return client;
}

test('MCP advertises account writes separately from read tools', async t => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 13);
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

test('MCP setup opens a browser connection without asking for credential arguments', async t => {
  let opened = 0;
  const login = { status: () => ({ state: 'IDLE' }), start: async () => { opened++; return { state: 'AWAITING_LOGIN' }; }, cancel: async () => ({ state: 'CANCELLED' }) };
  const client = await connect(t, login);
  const result = await client.callTool({ name: 'connect_account', arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).state, 'AWAITING_LOGIN');
  assert.equal(opened, 1);
  const status = await client.callTool({ name: 'auth_status', arguments: {} });
  assert.equal(JSON.parse(status.content[0].text).connected, false);
});

test('one Connect call verifies an existing account without opening a browser', async t => {
  let checks = 0;
  const login = { status: () => ({ state: 'IDLE' }), start: () => { throw new Error('Must not open a browser'); }, cancel: async () => {} };
  const client = await connect(t, login, { authStatus: async () => {
    checks++;
    return { connected: true, username: 'personal-user', canSubmit: true };
  } });
  const result = JSON.parse((await client.callTool({ name: 'connect_account', arguments: {} })).content[0].text);
  assert.equal(result.state, 'CONNECTED');
  assert.equal(result.username, 'personal-user');
  assert.equal(result.canSubmit, true);
  assert.equal(result.pluginVersion, client.getServerVersion().version);
  assert.equal(checks, 1);
});

test('pending Connect and status calls reuse the window without network verification', async t => {
  const login = { status: () => ({ state: 'AWAITING_LOGIN', browser: 'brave.exe', profile: 'temporary' }),
    start: () => { throw new Error('Must reuse the window'); }, cancel: async () => {} };
  const client = await connect(t, login, { authStatus: () => { throw new Error('Must not contact LeetCode'); } });
  const result = JSON.parse((await client.callTool({ name: 'connect_account', arguments: {} })).content[0].text);
  assert.equal(result.state, 'AWAITING_LOGIN');
  assert.equal(result.browser, 'brave.exe');
  assert.equal(result.pluginVersion, client.getServerVersion().version);
  const status = JSON.parse((await client.callTool({ name: 'auth_status', arguments: {} })).content[0].text);
  assert.equal(status.login.state, 'AWAITING_LOGIN');
});

test('network and rate-limit errors do not open another login window', async t => {
  let opened = 0;
  const login = { status: () => ({ state: 'IDLE' }), start: async () => { opened++; }, cancel: async () => {} };
  for (const code of ['NETWORK_ERROR', 'RATE_LIMITED', 'UPSTREAM_ERROR']) {
    const client = await connect(t, login, { authStatus: async () => { throw new LeetCodeError(code, 'Try later'); } });
    const result = await client.callTool({ name: 'connect_account', arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).code, code);
  }
  assert.equal(opened, 0);
});

test('denied sessions can be refreshed with one Connect call', async t => {
  let opened = 0;
  const login = { status: () => ({ state: 'IDLE' }), start: async () => { opened++; return { state: 'AWAITING_LOGIN' }; }, cancel: async () => {} };
  const client = await connect(t, login, { authStatus: async () => { throw new LeetCodeError('ACCESS_DENIED', 'Sign in'); } });
  const result = await client.callTool({ name: 'connect_account', arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).state, 'AWAITING_LOGIN');
  assert.equal(opened, 1);
});

test('local fallback can replace a pending automated window without credential arguments', async t => {
  let selected;
  const login = { status: () => ({ state: 'AWAITING_LOGIN', method: 'browser' }),
    start: async method => { selected = method; return { state: 'AWAITING_LOGIN', method }; }, cancel: async () => {} };
  const client = await connect(t, login);
  const result = await client.callTool({ name: 'connect_account', arguments: { method: 'local' } });
  assert.equal(selected, 'local');
  assert.equal(JSON.parse(result.content[0].text).method, 'local');
});
