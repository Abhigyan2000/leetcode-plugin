import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { credentialPath, validateCredentials } from './credentials.mjs';
import { LeetCodeError } from './client.mjs';
import { defaultBrowserExecutable, resolveBrowserExecutable, supportsBrowserSignIn } from './default-browser.mjs';

const LOGIN_URL = 'https://leetcode.com/accounts/login/';
const execute = promisify(execFile);

async function stopProfileProcesses(profile, env) {
  if (process.platform !== 'win32') return;
  const root = env[Object.keys(env).find(key => key.toUpperCase() === 'SYSTEMROOT')];
  if (!root) return;
  const script = String.raw`
$expected = [System.IO.Path]::GetFullPath($env:LEETCODE_SIGNIN_PROFILE)
Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe' OR Name='brave.exe' OR Name='vivaldi.exe' OR Name='chromium.exe'" | Where-Object {
  $match = [regex]::Match($_.CommandLine, '(?:^|\s)--user-data-dir=(?:"([^"]+)"|(\S+))')
  if ($match.Success) {
    $value = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
    try { [string]::Equals([System.IO.Path]::GetFullPath($value), $expected, [System.StringComparison]::OrdinalIgnoreCase) } catch { $false }
  }
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;
  await execute(join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...env, LEETCODE_SIGNIN_PROFILE: profile }, windowsHide: true, shell: false, timeout: 10000 });
}

export async function findBrowser(env = process.env, platform = process.platform, detect = defaultBrowserExecutable) {
  let executable;
  if (env.LEETCODE_BROWSER_PATH) {
    if (!isAbsolute(env.LEETCODE_BROWSER_PATH)) throw new LeetCodeError('BROWSER_NOT_FOUND', 'LEETCODE_BROWSER_PATH must be an absolute browser executable path.');
    try { executable = await resolveBrowserExecutable(env.LEETCODE_BROWSER_PATH, env); }
    catch { throw new LeetCodeError('BROWSER_NOT_FOUND', 'The configured browser executable is unavailable. Check LEETCODE_BROWSER_PATH.'); }
  } else {
    try { executable = await detect({ env, platform }); }
    catch { throw new LeetCodeError('DEFAULT_BROWSER_UNAVAILABLE', 'Could not determine your default HTTPS browser. Check the operating system default-browser setting or set LEETCODE_BROWSER_PATH to a supported browser executable.'); }
  }
  if (!supportsBrowserSignIn(executable)) throw new LeetCodeError('UNSUPPORTED_BROWSER', 'Your selected browser does not support this plugin\'s automatic sign-in connection. Use Chrome, Edge, Brave, Vivaldi, or Chromium as the default, or choose one explicitly with LEETCODE_BROWSER_PATH. Firefox, Safari, and sandboxed browser launchers are not supported by this adapter.');
  return executable;
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

export async function launchSignInBrowser({ env = process.env, signal, startupTimeoutMs = 20000,
  spawnBrowser = spawn, connectBrowser = DevToolsConnection.open, stopProfile = stopProfileProcesses } = {}) {
  const executable = await findBrowser(env);
  const profileRoot = resolve(dirname(credentialPath(env)), 'sign-in');
  await mkdir(profileRoot, { recursive: true, mode: 0o700 });
  const profile = await mkdtemp(join(profileRoot, 'login-'));
  const profileRelative = relative(profileRoot, profile);
  if (!profileRelative || profileRelative.startsWith('..') || isAbsolute(profileRelative)) throw new Error('Invalid sign-in profile path.');
  const child = spawnBrowser(executable, [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--new-window', LOGIN_URL,
  ], { stdio: 'ignore', windowsHide: false, shell: false });
  let exited = false;
  let launchFailed = false;
  let closed = false;
  let connection;
  child.once('error', () => { exited = true; launchFailed = true; });
  child.once('exit', () => { exited = true; });
  async function connect() {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      // Edge can hand off to another browser process and exit its launcher.
      if (launchFailed || closed) throw new Error('Sign-in window closed.');
      let endpoint;
      try {
        const [port, browserPath] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
        if (/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535 && /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(browserPath)) endpoint = `ws://127.0.0.1:${port}${browserPath}`;
      } catch {}
      if (endpoint) { connection = await connectBrowser(endpoint, { signal }); return connection; }
      await delay(200, undefined, { signal });
    }
    throw new Error('The sign-in browser did not start.');
  }
  return {
    browser: executable.replaceAll('\\', '/').split('/').pop(),
    async readCookies() {
      if (closed || launchFailed) throw new Error('Sign-in window closed.');
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
      // A Windows launcher can have exited while its temporary-profile browser
      // is still alive. Match only this exact profile, never all browser PIDs.
      await stopProfile(profile, env).catch(() => {});
      // Checked containment above; never remove a regular user profile.
      await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    },
  };
}
