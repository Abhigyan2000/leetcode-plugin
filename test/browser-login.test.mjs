import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { credentialsFromCookies, DevToolsConnection, findBrowser } from '../src/browser-login.mjs';

const pair = [
  { domain: '.leetcode.com', path: '/', name: 'LEETCODE_SESSION', value: 'fixture-session' },
  { domain: 'leetcode.com', path: '/', name: 'csrftoken', value: 'fixture-csrf' },
];

test('only the two live, root-scoped LeetCode cookies can establish a connection', () => {
  assert.deepEqual(credentialsFromCookies(pair), { session: 'fixture-session', csrf: 'fixture-csrf' });
  assert.equal(credentialsFromCookies([pair[0]]), null);
  for (const change of [
    { domain: 'leetcode.com.attacker.example' }, { domain: '.google.com' },
    { path: '/unrelated' }, { expires: 1 }, { partitionKey: { topLevelSite: 'https://other.example' } },
  ]) assert.equal(credentialsFromCookies([{ ...pair[0], ...change }, pair[1]]), null);
  assert.throws(() => credentialsFromCookies([{ ...pair[0], value: 'invalid;cookie' }, pair[1]]));
});

test('browser selection accepts an explicit executable, not a shell command', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leetcode-browser-path-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, 'fixture browser');
  await writeFile(executable, 'fixture');
  await chmod(executable, 0o700);
  assert.equal(await findBrowser({ LEETCODE_BROWSER_PATH: executable }), executable);
  await assert.rejects(() => findBrowser({ LEETCODE_BROWSER_PATH: 'chrome --some-flag' }), { code: 'BROWSER_NOT_FOUND' });
  await assert.rejects(() => findBrowser({ PATH: '' }, 'linux'), { code: 'BROWSER_NOT_FOUND' });
});

test('Windows browser discovery handles the casing preserved by environment copies', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leetcode-windows-browser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, 'Google/Chrome/Application/chrome.exe');
  await mkdir(dirname(executable), { recursive: true });
  await writeFile(executable, 'fixture');
  await chmod(executable, 0o700);
  assert.equal(await findBrowser({ ProgramFiles: directory }, 'win32'), executable);
});

class Socket extends EventTarget {
  readyState = 1;
  sent = [];
  constructor(reply) { super(); this.reply = reply; }
  send(raw) {
    const command = JSON.parse(raw);
    this.sent.push(command);
    const response = this.reply(command);
    if (response === undefined) return;
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: command.id, ...response }) })));
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

test('browser reads are limited to LeetCode cookies, with no password or page inspection', async () => {
  const socket = new Socket(command => {
    if (command.method === 'Target.getTargets') return { result: { targetInfos: [
      { type: 'page', targetId: 'provider', url: 'https://accounts.google.com/' },
      { type: 'page', targetId: 'spoof', url: 'https://leetcode.com.attacker.example/' },
      { type: 'page', targetId: 'leetcode', url: 'https://leetcode.com/accounts/login/' },
    ] } };
    if (command.method === 'Target.attachToTarget') return { result: { sessionId: 'session' } };
    if (command.method === 'Network.getCookies') return { result: { cookies: pair } };
    return { result: {} };
  });
  const connection = new DevToolsConnection(socket);
  assert.deepEqual(await connection.readLeetCodeCookies(), pair);
  assert.deepEqual(socket.sent.map(c => c.method), ['Target.getTargets', 'Target.attachToTarget', 'Network.getCookies', 'Target.detachFromTarget']);
  assert.equal(socket.sent[1].params.targetId, 'leetcode');
  assert.deepEqual(socket.sent[2].params, { urls: ['https://leetcode.com/'] });
  assert.equal(socket.sent[2].sessionId, 'session');
  connection.close();
});

test('being on an identity-provider page does not expose its cookies', async () => {
  const socket = new Socket(() => ({ result: { targetInfos: [{ type: 'page', targetId: 'provider', url: 'https://accounts.google.com/' }] } }));
  const connection = new DevToolsConnection(socket);
  assert.deepEqual(await connection.readLeetCodeCookies(), []);
  assert.equal(socket.sent.length, 1);
  connection.close();
});

test('closing the browser rejects pending commands instead of hanging', async () => {
  const socket = new Socket(() => undefined);
  const connection = new DevToolsConnection(socket);
  const request = connection.send('Target.getTargets');
  socket.close();
  await assert.rejects(request, /closed/);
  assert.equal(connection.pending.size, 0);
});

test('browser command errors are redacted', async () => {
  const socket = new Socket(() => ({ error: { message: 'fixture-session is private' } }));
  const connection = new DevToolsConnection(socket);
  await assert.rejects(() => connection.send('Target.getTargets'), error => !error.message.includes('fixture-session'));
  connection.close();
});

test('CDP endpoints must be local browser endpoints', async () => {
  for (const url of ['wss://remote.example/devtools/browser/id', 'ws://remote.example/devtools/browser/id', 'ws://127.0.0.1:9222/unrelated']) {
    await assert.rejects(() => DevToolsConnection.open(url), /Invalid local/);
  }
});
