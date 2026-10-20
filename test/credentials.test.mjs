import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCredentials, saveCredentials, removeCredentials, validateCredentials } from '../src/credentials.mjs';

async function storage(t) {
  const directory = await mkdtemp(join(tmpdir(), 'leetcode-auth-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { LEETCODE_CREDENTIALS_FILE: join(directory, 'private', 'credentials.json') };
}

test('credentials round-trip outside the plugin and logout removes them', async t => {
  const env = await storage(t);
  assert.equal((await loadCredentials(env)).source, 'none');
  await saveCredentials({ session: 'local-session', csrf: 'local-csrf' }, env);
  assert.deepEqual(await loadCredentials(env), { session: 'local-session', csrf: 'local-csrf', source: 'file' });
  await saveCredentials({ session: 'new-session', csrf: 'new-csrf' }, env);
  assert.equal((await loadCredentials(env)).session, 'new-session');
  if (process.platform !== 'win32') assert.equal((await stat(env.LEETCODE_CREDENTIALS_FILE)).mode & 0o777, 0o600);
  await removeCredentials(env);
  await removeCredentials(env);
  assert.equal((await loadCredentials(env)).source, 'none');
});

test('environment identity does not borrow saved CSRF from another account', async t => {
  const env = await storage(t);
  await saveCredentials({ session: 'account-a', csrf: 'csrf-a' }, env);
  assert.deepEqual(await loadCredentials({ ...env, LEETCODE_SESSION: 'account-b' }), {
    session: 'account-b', csrf: undefined, source: 'environment',
  });
});

test('header-breaking cookie values are rejected', () => {
  for (const bad of ['bad;injection', 'bad\r\nCookie: x', 'bad token', '', '\u0000secret']) {
    assert.throws(() => validateCredentials({ session: bad, csrf: 'ok' }));
  }
});

test('corrupt credentials fail closed and never enter the error text', async t => {
  const env = await storage(t);
  await saveCredentials({ session: 'safe', csrf: 'safe' }, env);
  await writeFile(env.LEETCODE_CREDENTIALS_FILE, '{sensitive-cookie');
  await assert.rejects(() => loadCredentials(env), error => !error.message.includes('sensitive-cookie'));
});

test('incomplete local login never writes credentials', async t => {
  const env = await storage(t);
  await assert.rejects(() => saveCredentials({ session: 'safe' }, env));
  assert.equal((await loadCredentials(env)).source, 'none');
});
