import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { LoginManager } from '../src/login-manager.mjs';

const cookies = [
  { domain: '.leetcode.com', path: '/', name: 'LEETCODE_SESSION', value: 'fixture-session' },
  { domain: '.leetcode.com', path: '/', name: 'csrftoken', value: 'fixture-csrf' },
];
function fixture(overrides = {}) {
  const actions = { launches: 0, closes: 0, saved: [], removed: 0, verifies: 0 };
  const manager = new LoginManager({ env: {}, pollMs: 1, timeoutMs: 1000,
    launch: async () => { actions.launches++; return { readCookies: async () => cookies, close: async () => { actions.closes++; } }; },
    save: async credentials => { actions.saved.push(credentials); },
    remove: async () => { actions.removed++; },
    verify: async () => { actions.verifies++; return { connected: true, username: 'personal-user' }; },
    ...overrides,
  });
  return { manager, actions };
}

test('browser connection saves only a verified session and returns no credentials', async () => {
  const { manager, actions } = fixture();
  await manager.start();
  await manager.task;
  assert.equal(manager.status().state, 'CONNECTED');
  assert.equal(manager.status().username, 'personal-user');
  assert.equal(actions.saved.length, 1);
  assert.equal(actions.closes, 1);
  assert.ok(!JSON.stringify(manager.status()).includes('fixture-session'));
  assert.ok(!JSON.stringify(manager.status()).includes('fixture-csrf'));
});

test('repeated Connect requests reuse one pending browser window', async () => {
  let closed = 0;
  let launches = 0;
  const { manager } = fixture({ launch: async () => { launches++; return { browser: 'brave.exe', readCookies: async () => [], close: async () => { closed++; } }; } });
  const statuses = await Promise.all([manager.start(), manager.start(), manager.start()]);
  assert.ok(statuses.every(status => status.state === 'AWAITING_LOGIN'));
  assert.equal(launches, 1);
  assert.equal(statuses[0].browser, 'brave.exe');
  assert.equal(statuses[0].profile, 'temporary');
  await manager.start();
  assert.equal(launches, 1);
  await manager.cancel();
  assert.equal(manager.status().state, 'CANCELLED');
  assert.equal(closed, 1);
});

test('a cookie alone does not establish a connection or trigger repeated verification', async () => {
  const { manager, actions } = fixture({ verify: async () => { actions.verifies++; return { connected: false }; }, timeoutMs: 15 });
  await manager.start();
  await manager.task;
  assert.equal(manager.status().state, 'EXPIRED');
  assert.equal(actions.saved.length, 0);
  assert.equal(actions.verifies, 1);
  assert.equal(actions.closes, 1);
});

test('closing the sign-in window saves nothing and does not return browser errors', async () => {
  const { manager, actions } = fixture({ launch: async () => ({ readCookies: async () => { throw new Error('private fixture-session'); }, close: async () => { actions.closes++; } }) });
  await manager.start();
  await manager.task;
  assert.equal(manager.status().state, 'FAILED');
  assert.equal(actions.saved.length, 0);
  assert.ok(!JSON.stringify(manager.status()).includes('fixture-session'));
});

test('disconnect waits for pending verification before deleting credentials', async () => {
  let finish;
  const { manager, actions } = fixture({ verify: () => new Promise(resolve => { finish = resolve; }) });
  await manager.start();
  while (!finish) await delay(1);
  const disconnect = manager.disconnect();
  // Allow cancel to abort the pending operation before verification returns.
  await delay(1);
  finish({ connected: true, username: 'personal-user' });
  await disconnect;
  assert.equal(actions.saved.length, 0);
  assert.equal(actions.removed, 1);
  assert.equal(manager.status().state, 'DISCONNECTED');
});

test('environment accounts cannot be silently replaced by browser login', async () => {
  const { manager, actions } = fixture({ env: { LEETCODE_SESSION: 'another-account' } });
  await assert.rejects(() => manager.start(), { code: 'ENVIRONMENT_ACCOUNT' });
  assert.equal(actions.launches, 0);
});

test('temporary-profile cleanup failures are reported without exposing credentials', async () => {
  const { manager } = fixture({ launch: async () => ({ readCookies: async () => cookies, close: async () => { throw new Error('private fixture-session'); } }) });
  await manager.start();
  await manager.task;
  assert.equal(manager.status().state, 'CONNECTED');
  assert.ok(manager.status().cleanupWarning);
  assert.ok(!JSON.stringify(manager.status()).includes('fixture-session'));
});
