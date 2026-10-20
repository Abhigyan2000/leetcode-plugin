import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, delimiter, resolve, relative, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { credentialPath, validateCredentials } from './credentials.mjs';
import { LeetCodeError } from './client.mjs';

const LOGIN_URL = 'https://leetcode.com/accounts/login/';

export async function findBrowser(env = process.env, platform = process.platform) {
  const candidates = [];
  if (env.LEETCODE_BROWSER_PATH) {
    if (!isAbsolute(env.LEETCODE_BROWSER_PATH)) throw new LeetCodeError('BROWSER_NOT_FOUND', 'LEETCODE_BROWSER_PATH must be an absolute browser executable path.');
    candidates.push(env.LEETCODE_BROWSER_PATH);
  } else if (platform === 'win32') {
    const value = name => env[Object.keys(env).find(key => key.toUpperCase() === name)];
    for (const root of [value('PROGRAMFILES'), value('PROGRAMFILES(X86)'), value('LOCALAPPDATA')].filter(Boolean)) {
      candidates.push(join(root, 'Google/Chrome/Application/chrome.exe'), join(root, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else if (platform === 'darwin') {
    for (const root of ['/Applications', join(homedir(), 'Applications')]) candidates.push(
      join(root, 'Google Chrome.app/Contents/MacOS/Google Chrome'),
      join(root, 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      join(root, 'Chromium.app/Contents/MacOS/Chromium'));
  } else {
    for (const directory of (env.PATH || '').split(delimiter).filter(isAbsolute)) {
      for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable']) candidates.push(join(directory, name));
    }
  }
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch {}
  }
  throw new LeetCodeError('BROWSER_NOT_FOUND', 'Install Chrome, Edge, or Chromium to use browser sign-in, or set LEETCODE_BROWSER_PATH to its executable. Manual local login remains available.');
}

// Only a newly created sign-in profile is ever passed to this adapter.
// No normal browser profiles, DOM input, passwords, or network bodies are read.
export class DevToolsConnection {
  constructor(socket, timeoutMs = 5000) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error('Browser command failed.'));
      else pending.resolve(message.result || {});
    });
    const closed = () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Sign-in window closed.')); }
      this.pending.clear();
    };
    socket.addEventListener('close', closed);
    socket.addEventListener('error', closed);
  }

  static async open(url, { signal, timeoutMs = 10000 } = {}) {
    const target = new URL(url);
    if (target.protocol !== 'ws:' || target.hostname !== '127.0.0.1' || !target.pathname.startsWith('/devtools/browser/')) throw new Error('Invalid local browser endpoint.');
    signal?.throwIfAborted();
    const socket = new WebSocket(url);
    try {
      await new Promise((resolve, reject) => {
        const finish = callback => { clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.removeEventListener('open', opened); socket.removeEventListener('error', failed); callback(); };
        const opened = () => finish(resolve);
        const failed = () => finish(() => reject(new Error('Could not connect to the sign-in window.')));
        const abort = () => finish(() => reject(new Error('Sign-in cancelled.')));
        const timer = setTimeout(failed, timeoutMs);
        socket.addEventListener('open', opened);
        socket.addEventListener('error', failed);
        signal?.addEventListener('abort', abort, { once: true });
      });
      return new DevToolsConnection(socket);
    } catch (error) { socket.close(); throw error; }
  }

  send(method, params = {}, sessionId) {
    if (this.socket.readyState !== 1) return Promise.reject(new Error('Sign-in window closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Browser command timed out.')); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('Sign-in window closed.')); }
    });
  }

  async readLeetCodeCookies() {
    const { targetInfos = [] } = await this.send('Target.getTargets');
    for (const target of targetInfos) {
      let url;
      try { url = new URL(target.url); } catch { continue; }
      if (target.type !== 'page' || url.origin !== 'https://leetcode.com') continue;
      const { sessionId } = await this.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      try {
        const result = await this.send('Network.getCookies', { urls: ['https://leetcode.com/'] }, sessionId);
        return result.cookies || [];
      } finally { await this.send('Target.detachFromTarget', { sessionId }).catch(() => {}); }
    }
    return [];
  }

  close() { this.socket.close(); }
}

export function credentialsFromCookies(cookies, now = Date.now()) {
  const values = new Map();
  for (const cookie of cookies) {
    if (!['leetcode.com', '.leetcode.com'].includes(cookie.domain) || cookie.path !== '/' ||
      !['LEETCODE_SESSION', 'csrftoken'].includes(cookie.name) || cookie.partitionKey ||
      (cookie.expires > 0 && cookie.expires * 1000 <= now)) continue;
    values.set(cookie.name, cookie.value);
  }
  if (!values.has('LEETCODE_SESSION') || !values.has('csrftoken')) return null;
  return validateCredentials({ session: values.get('LEETCODE_SESSION'), csrf: values.get('csrftoken') });
}

export async function launchSignInBrowser({ env = process.env, signal, startupTimeoutMs = 20000 } = {}) {
  const executable = await findBrowser(env);
  const profileRoot = resolve(dirname(credentialPath(env)), 'sign-in');
  await mkdir(profileRoot, { recursive: true, mode: 0o700 });
  const profile = await mkdtemp(join(profileRoot, 'login-'));
  const profileRelative = relative(profileRoot, profile);
  if (!profileRelative || profileRelative.startsWith('..') || isAbsolute(profileRelative)) throw new Error('Invalid sign-in profile path.');
  const child = spawn(executable, [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    `--app=${LOGIN_URL}`,
  ], { stdio: 'ignore', windowsHide: false, shell: false });
  let exited = false;
  let closed = false;
  let connection;
  child.once('error', () => { exited = true; });
  child.once('exit', () => { exited = true; });
  async function connect() {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (exited || closed) throw new Error('Sign-in window closed.');
      let endpoint;
      try {
        const [port, browserPath] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
        if (/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535 && /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(browserPath)) endpoint = `ws://127.0.0.1:${port}${browserPath}`;
      } catch {}
      if (endpoint) { connection = await DevToolsConnection.open(endpoint, { signal }); return connection; }
      await delay(200, undefined, { signal });
    }
    throw new Error('The sign-in browser did not start.');
  }
  return {
    async readCookies() {
      if (closed || exited) throw new Error('Sign-in window closed.');
      const cdp = connection || await connect();
      return cdp.readLeetCodeCookies();
    },
    async close() {
      if (closed) return;
      closed = true;
      if (connection) {
        await Promise.race([connection.send('Browser.close').catch(() => {}), delay(1000)]);
        connection.close();
      }
      for (let i = 0; i < 15 && !exited; i++) await delay(100);
      if (!exited) child.kill();
      // Checked containment above; never remove a regular user profile.
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}
