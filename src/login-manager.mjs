import { setTimeout as delay } from 'node:timers/promises';
import { launchSignInBrowser, credentialsFromCookies } from './browser-login.mjs';
import { LeetCodeClient, LeetCodeError } from './client.mjs';
import { saveCredentials, removeCredentials } from './credentials.mjs';

export class LoginManager {
  constructor({ launch = launchSignInBrowser, save = saveCredentials, remove = removeCredentials,
    verify = credentials => new LeetCodeClient({ credentials: async () => credentials }).authStatus(),
    env = process.env, timeoutMs = 300000, pollMs = 1500 } = {}) {
    this.launch = launch;
    this.save = save;
    this.remove = remove;
    this.verify = verify;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.state = { state: 'IDLE' };
    this.task = null;
    this.starting = null;
  }

  status() { return { ...this.state }; }

  async start() {
    if (this.env.LEETCODE_SESSION) throw new LeetCodeError('ENVIRONMENT_ACCOUNT', 'An environment-configured account takes precedence. Unset LEETCODE_SESSION and LEETCODE_CSRFTOKEN before connecting a different account in the browser.');
    if (this.starting) return this.starting;
    if (this.state.state === 'AWAITING_LOGIN') return this.status();
    this.starting = this.open();
    try { return await this.starting; } finally { this.starting = null; }
  }

  async open() {
    if (this.task) await this.task;
    this.controller = new AbortController();
    const browser = await this.launch({ env: this.env, signal: this.controller.signal });
    this.state = { state: 'AWAITING_LOGIN', browser: browser.browser, profile: 'temporary', flow: 'manual-first',
      message: 'Sign in normally in the browser window, then close that window to finish connecting. Debugging stays off during sign-in. A blank window may briefly appear while the plugin verifies and saves the session. No progress checks are needed.',
      expiresAt: new Date(Date.now() + this.timeoutMs).toISOString() };
    this.task = this.observe(browser, this.controller.signal);
    return this.status();
  }

  async observe(browser, signal) {
    const deadline = Date.now() + this.timeoutMs;
    let lastAttempt;
    try {
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const credentials = credentialsFromCookies(await browser.readCookies());
        if (credentials && (credentials.session !== lastAttempt?.session || credentials.csrf !== lastAttempt?.csrf)) {
          lastAttempt = credentials;
          const verified = await this.verify(credentials);
          signal.throwIfAborted();
          if (verified.connected && verified.username) {
            await this.save(credentials, this.env);
            this.state = { state: 'CONNECTED', username: verified.username, message: 'Account connected. You can return to Codex.' };
            return;
          }
          if (browser.manualFirst) throw new LeetCodeError('SESSION_NOT_VERIFIED', 'LeetCode did not verify this browser session. Nothing was saved.');
        }
        await delay(this.pollMs, undefined, { signal });
      }
      this.state = { state: 'EXPIRED', message: 'Sign-in timed out without a verified account. Use connect_account to try again.' };
    } catch (error) {
      this.state = signal.aborted
        ? { state: 'CANCELLED', message: 'Sign-in cancelled.' }
        : { state: 'FAILED', message: error instanceof LeetCodeError && ['SIGN_IN_INCOMPLETE', 'SESSION_NOT_VERIFIED'].includes(error.code)
          ? error.message : 'LeetCode could not verify the browser session. Nothing was saved. Use connect_account to try again.' };
    } finally {
      lastAttempt = undefined;
      try { await browser.close(); }
      catch { this.state.cleanupWarning = 'The temporary sign-in profile could not be fully removed. Check the sign-in folder beside your local credential file.'; }
    }
  }

  async cancel() {
    if (this.starting) await this.starting.catch(() => {});
    if (this.state.state === 'AWAITING_LOGIN') this.controller?.abort();
    if (this.task) await this.task;
    return this.status();
  }

  async disconnect() {
    await this.cancel();
    await this.remove(this.env);
    const cleanupWarning = this.state.cleanupWarning;
    this.state = { state: 'DISCONNECTED', ...(cleanupWarning ? { cleanupWarning } : {}),
      message: 'Saved local credentials removed. Environment overrides and browser sessions must be removed separately.' };
    return this.status();
  }
}
