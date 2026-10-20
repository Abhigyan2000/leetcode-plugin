import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function credentialPath(env = process.env) {
  return env.LEETCODE_CREDENTIALS_FILE || join(
    env.LOCALAPPDATA || env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'leetcode-plugin', 'credentials.json');
}

function cookie(value, name) {
  if (typeof value !== 'string' || !value || /[\s;\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid ${name}; use the cookie value only.`);
  }
  return value;
}

export function validateCredentials(value) {
  return {
    session: cookie(value.session, 'LEETCODE_SESSION'),
    csrf: value.csrf ? cookie(value.csrf, 'csrftoken') : undefined,
  };
}

export async function loadCredentials(env = process.env) {
  // An environment session replaces the whole file identity; never mix accounts.
  if (env.LEETCODE_SESSION) {
    return { ...validateCredentials({ session: env.LEETCODE_SESSION, csrf: env.LEETCODE_CSRFTOKEN }), source: 'environment' };
  }
  let raw;
  try { raw = await readFile(credentialPath(env), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { source: 'none' };
    throw new Error('Cannot read the local credential file. Check its permissions.');
  }
  try { return { ...validateCredentials(JSON.parse(raw)), source: 'file' }; }
  catch { throw new Error('The local credential file is invalid. Run local login again.'); }
}

export async function saveCredentials(value, env = process.env) {
  const credentials = validateCredentials(value);
  if (!credentials.csrf) throw new Error('Both session and csrftoken are required for local login.');
  const path = credentialPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function removeCredentials(env = process.env) {
  await rm(credentialPath(env), { force: true });
}
