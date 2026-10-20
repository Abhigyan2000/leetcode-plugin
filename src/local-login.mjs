import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { win32 } from 'node:path';
import { validateCredentials } from './credentials.mjs';

const execute = promisify(execFile);
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export async function openDefaultBrowser(url, { env = process.env, platform = process.platform, run = execute } = {}) {
  const options = { env, windowsHide: true, shell: false, timeout: 10000 };
  if (platform === 'win32') {
    const root = env[Object.keys(env).find(key => key.toUpperCase() === 'SYSTEMROOT')];
    if (!root || !win32.isAbsolute(root)) throw new Error('Windows directory unavailable');
    await run(win32.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:LEETCODE_SETUP_URL'],
      { ...options, env: { ...env, LEETCODE_SETUP_URL: url } });
  } else if (platform === 'darwin') await run('/usr/bin/open', [url], options);
  else if (platform === 'linux') await run('xdg-open', [url], options);
  else throw new Error('Unsupported operating system');
}

function page(content, nonce) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect LeetCode</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f5f4ef;color:#20231f;font:16px/1.65 system-ui,sans-serif}main{max-width:720px;margin:7vh auto;padding:40px;background:#fff;border:1px solid #dddcd4;border-radius:18px}small{color:#666b60;letter-spacing:.08em;text-transform:uppercase}h1{font-size:32px;letter-spacing:-.04em;line-height:1.2}a{color:#335e46}li{margin:12px 0}label{display:block;margin-top:20px;font-weight:600}input{display:block;width:100%;padding:12px;margin-top:6px;border:1px solid #b9bdb4;border-radius:7px;font:inherit}button{margin-top:24px;padding:12px 22px;background:#244d39;color:white;border:0;border-radius:7px;font:inherit;cursor:pointer}code{font-size:.9em;background:#f1f2ee;padding:2px 5px;border-radius:4px}.note{color:#61665b;font-size:14px}.error{color:#a22626}@media(max-width:760px){main{margin:20px;padding:24px}}</style>
<main><small>LeetCode Companion · Local setup</small>${content}</main></html>`;
}

function form(message = '') {
  return `<h1>Connect your existing session</h1><p>Use the LeetCode account already signed in to your preferred browser profile.</p>
<ol><li>Open <a href="https://leetcode.com/accounts/login/" target="_blank" rel="noreferrer noopener">LeetCode</a> in that profile and finish signing in.</li>
<li>On LeetCode, open developer tools (F12, or your browser's menu). In Chrome, Brave, or Edge, choose <strong>Application → Cookies → https://leetcode.com</strong>. In Firefox, choose <strong>Storage → Cookies</strong>.</li>
<li>Copy the <strong>Value</strong> of <code>LEETCODE_SESSION</code> and <code>csrftoken</code> into the fields below.</li></ol>
${message ? `<p class="error" role="alert">${escape(message)}</p>` : ''}
<form method="post" autocomplete="off"><label for="session">LEETCODE_SESSION<input id="session" name="session" type="password" required maxlength="12000" autocomplete="off" spellcheck="false"></label>
<label for="csrf">csrftoken<input id="csrf" name="csrf" type="password" required maxlength="2000" autocomplete="off" spellcheck="false"></label><button type="submit">Verify and connect</button></form>
<p class="note">This form runs on your computer. Values are sent only to the local plugin and LeetCode for verification, then saved in your local credentials file. Never paste them into chat. Nothing is read automatically from your browser profile.</p>`;
}

export async function launchLocalLogin({ submit, env = process.env, open = openDefaultBrowser } = {}) {
  const path = `/setup/${randomBytes(32).toString('hex')}`;
  const styleNonce = randomBytes(18).toString('base64');
  let origin;
  let busy = false;
  let done = false;
  let closed = false;
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${styleNonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
    const send = (status, content) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page(content, styleNonce)); };
    if (request.headers.host !== origin?.slice(7) || request.url !== path || closed) { send(404, '<h1>Setup unavailable</h1>'); return; }
    if (done) { send(410, '<h1>Setup complete</h1><p>Return to your agent client. You can close this tab.</p>'); return; }
    if (request.method === 'GET') { send(200, form()); return; }
    if (request.method !== 'POST' || request.headers.origin !== origin ||
      (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) { send(403, '<h1>Request refused</h1>'); return; }
    if (request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') { send(415, '<h1>Unsupported form</h1>'); return; }
    if (busy) { send(409, '<h1>Verification in progress</h1><p>Wait for the current request to finish.</p>'); return; }
    busy = true;
    let body = '';
    let credentials;
    try {
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16000) { send(413, form('The submitted values are too long.')); return; }
        body += chunk.toString('utf8');
      }
      const fields = new URLSearchParams(body);
      credentials = validateCredentials({ session: fields.get('session'), csrf: fields.get('csrf') });
      if (!credentials.csrf) throw new Error('Both values are required');
      if (closed) throw new Error('Setup closed');
      const username = await submit(credentials);
      done = true;
      send(200, `<h1>Connected as ${escape(username)}</h1><p>Your session is saved. Return to your agent client and continue with your next LeetCode request.</p><p class="note">You can close this tab.</p>`);
      finish();
    } catch {
      send(400, form('The plugin could not verify and save this session. Copy both values from the same signed-in LeetCode profile and try again. If LeetCode still requires a browser check for API requests, this connection method may not work.'));
    } finally { body = ''; credentials = undefined; busy = false; }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  server.maxConnections = 8;
  server.setTimeout(10000, socket => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  async function close() {
    closed = true;
    const force = setTimeout(() => server.closeAllConnections(), 1000);
    try { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); }
    finally { clearTimeout(force); }
  }
  try { await open(`${origin}${path}`, { env }); }
  catch { await close(); throw new Error('Could not open local setup in the default browser'); }
  return { completed, close };
}
