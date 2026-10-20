import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { credentialsFromCookies, DevToolsConnection, findBrowser, launchSignInBrowser } from '../src/browser-login.mjs';

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
  const executable = join(directory, 'browser with spaces', 'chrome.exe');
  await mkdir(dirname(executable), { recursive: true });
  await writeFile(executable, 'fixture');
  await chmod(executable, 0o700);
  assert.equal(await findBrowser({ LEETCODE_BROWSER_PATH: executable }), executable);
  await assert.rejects(() => findBrowser({ LEETCODE_BROWSER_PATH: 'chrome --some-flag' }), { code: 'BROWSER_NOT_FOUND' });
  await assert.rejects(() => findBrowser({}, 'linux', async () => { throw new Error('Not configured'); }), { code: 'DEFAULT_BROWSER_UNAVAILABLE' });
});

test('browser selection uses the detected default instead of preferring another installed browser', async () => {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  assert.equal(await findBrowser({ ProgramFiles: 'C:\\Program Files' }, 'win32', async () => edge), edge);
});

test('an unsupported default does not silently fall back to Chrome', async () => {
  await assert.rejects(() => findBrowser({}, 'win32', async () => 'C:\\Firefox\\firefox.exe'), { code: 'UNSUPPORTED_BROWSER' });
});

test('an exited browser launcher can hand off to a live sign-in window', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'leetcode-launcher-handoff-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, 'msedge.exe');
  await writeFile(executable, 'fixture');
  await chmod(executable, 0o700);
  let profile;
  let stopped;
  const browser = await launchSignInBrowser({ env: { LEETCODE_BROWSER_PATH: executable, LEETCODE_CREDENTIALS_FILE: join(directory, 'credentials.json') },
    spawnBrowser: (file, args) => {
      assert.equal(file, executable);
      assert.ok(args.includes('--new-window'));
      assert.ok(args.includes('https://leetcode.com/accounts/login/'));
      assert.ok(!args.some(arg => arg.startsWith('--app=')));
      profile = args.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
      const child = new EventEmitter();
      child.kill = () => { throw new Error('The launcher has already exited'); };
      setImmediate(() => {
        child.emit('exit', 0);
        void writeFile(join(profile, 'DevToolsActivePort'), '12345\n/devtools/browser/fixture\n');
      });
      return child;
    },
    connectBrowser: async endpoint => {
      assert.equal(endpoint, 'ws://127.0.0.1:12345/devtools/browser/fixture');
      return { readLeetCodeCookies: async () => pair, send: async () => ({}), close() {} };
    },
    stopProfile: async value => { stopped = value; },
  });
  assert.deepEqual(await browser.readCookies(), pair);
  await browser.close();
  assert.equal(stopped, profile);
  await assert.rejects(() => readFile(join(profile, 'DevToolsActivePort')), { code: 'ENOENT' });
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
