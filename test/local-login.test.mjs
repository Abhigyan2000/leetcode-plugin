import test from 'node:test';
import assert from 'node:assert/strict';
import { launchLocalLogin, openDefaultBrowser } from '../src/local-login.mjs';
import { LoginManager } from '../src/login-manager.mjs';
import { get } from 'node:http';

const values = { session: 'fixture-private-session', csrf: 'fixture-private-csrf' };
async function fixture(t, submit = async () => 'personal-user') {
  let url;
  const local = await launchLocalLogin({ submit, open: async value => { url = value; } });
  t.after(() => local.close());
  return { local, url, origin: new URL(url).origin };
}
const post = (url, origin, data = values) => fetch(url, { method: 'POST',
  headers: { Origin: origin }, body: new URLSearchParams(data) });

test('local form opens through the OS without browser automation or a profile override', async () => {
  const url = 'http://127.0.0.1:12345/setup/fixture';
  let called = false;
  await openDefaultBrowser(url, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' },
    run: async (command, args, options) => {
      called = true;
      assert.equal(command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.equal(args.at(-1), 'Start-Process -FilePath $env:LEETCODE_SETUP_URL');
      assert.equal(options.env.LEETCODE_SETUP_URL, url);
      assert.equal(options.shell, false);
      assert.ok(!args.join(' ').includes('--remote-debugging'));
    } });
  assert.equal(called, true);
});

test('local form has no external assets, scripts, or reflected cookie values', async t => {
  const { url } = await fixture(t);
  const response = await fetch(url);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes(values.session));
  assert.match(html, /type="password"/);
});

test('only the secret setup path accepts a same-origin form submission', async t => {
  let submits = 0;
  const { url, origin } = await fixture(t, async () => { submits++; return 'user'; });
  assert.equal((await post(url, 'https://attacker.example')).status, 403);
  assert.equal((await post(`${origin}/setup/guessed`, origin)).status, 404);
  const status = await new Promise((resolve, reject) => {
    get(url, { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(status, 404);
  assert.equal(submits, 0);
});

test('verified form submissions complete without returning session values', async t => {
  const { url, origin, local } = await fixture(t, async credentials => {
    assert.deepEqual(credentials, values);
    return 'user<script>';
  });
  const response = await post(url, origin);
  const html = await response.text();
  await local.completed;
  assert.equal(response.status, 200);
  assert.match(html, /user&lt;script&gt;/);
  assert.ok(!html.includes(values.session));
  assert.ok(!html.includes(values.csrf));
  assert.equal((await post(url, origin)).status, 410);
});

test('failed verification reveals neither cookies nor upstream errors and permits correction', async t => {
  const { url, origin } = await fixture(t, async () => { throw new Error(values.session); });
  const response = await post(url, origin);
  const html = await response.text();
  assert.equal(response.status, 400);
  assert.match(html, /could not verify and save/);
  assert.ok(!html.includes(values.session));
  assert.ok(!html.includes(values.csrf));
  assert.equal((await fetch(url)).status, 200);
});

test('large or invalid submissions never reach verification', async t => {
  let submits = 0;
  const { url, origin } = await fixture(t, async () => { submits++; });
  assert.equal((await post(url, origin, { session: 'x'.repeat(17000), csrf: 'csrf' })).status, 413);
  assert.equal((await post(url, origin, { session: 'session' })).status, 400);
  assert.equal(submits, 0);
});

test('local setup verifies and saves once, then closes its listener', async () => {
  let url;
  let saved = 0;
  const manager = new LoginManager({ env: {},
    launchLocal: options => launchLocalLogin({ ...options, open: async value => { url = value; } }),
    verify: async () => ({ connected: true, username: 'personal-user' }),
    save: async credentials => { assert.deepEqual(credentials, values); saved++; },
  });
  const pending = await manager.start('local');
  assert.equal(pending.method, 'local');
  assert.equal(pending.profile, 'normal');
  assert.ok(!JSON.stringify(pending).includes('/setup/'));
  try {
    const response = await post(url, new URL(url).origin);
    assert.equal(response.status, 200);
    await response.text();
    await manager.task;
    assert.equal(manager.status().state, 'CONNECTED');
    assert.equal(saved, 1);
    await assert.rejects(() => fetch(url));
  } finally { await manager.cancel(); }
});

test('cancellation and timeout stop local setup without saving a session', async () => {
  for (const cancel of [true, false]) {
    let url;
    const manager = new LoginManager({ env: {}, timeoutMs: cancel ? 1000 : 15,
      launchLocal: options => launchLocalLogin({ ...options, open: async value => { url = value; } }),
      save: async () => { throw new Error('Must not save'); },
    });
    await manager.start('local');
    if (cancel) await manager.cancel();
    else await manager.task;
    assert.equal(manager.status().state, cancel ? 'CANCELLED' : 'EXPIRED');
    await assert.rejects(() => fetch(url));
  }
});

test('cancelling during local verification never saves the supplied session', async () => {
  let url;
  let finish;
  let saved = false;
  const manager = new LoginManager({ env: {},
    launchLocal: options => launchLocalLogin({ ...options, open: async value => { url = value; } }),
    verify: () => new Promise(resolve => { finish = resolve; }),
    save: async () => { saved = true; },
  });
  await manager.start('local');
  const request = post(url, new URL(url).origin);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const cancelled = manager.cancel();
  finish({ connected: true, username: 'personal-user' });
  await (await request).text();
  await cancelled;
  assert.equal(saved, false);
  assert.equal(manager.status().state, 'CANCELLED');
});
