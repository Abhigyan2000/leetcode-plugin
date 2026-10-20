import { credentialPath, loadCredentials, saveCredentials, removeCredentials, validateCredentials } from './credentials.mjs';
import { LeetCodeClient } from './client.mjs';

async function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run login in your own interactive terminal. Never paste credentials into chat.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const onData = chunk => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') { finish(); reject(new Error('Login cancelled.')); return; }
        if (ch === '\r' || ch === '\n') { finish(); resolve(value); return; }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Do not supply credentials as command-line arguments. Use interactive login or environment variables.');
  if (command === 'login') {
    const session = await readSecret('LEETCODE_SESSION (hidden): ');
    const csrf = await readSecret('csrftoken (hidden): ');
    const credentials = { ...validateCredentials({ session, csrf }), source: 'interactive' };
    const status = await new LeetCodeClient({ credentials: async () => credentials }).authStatus();
    if (!status.connected) throw new Error('LeetCode did not verify this session. Nothing was saved.');
    await saveCredentials(credentials);
    process.stdout.write(`Connected as ${status.username}. Credentials saved locally at ${credentialPath()}.\n`);
    if (process.env.LEETCODE_SESSION) process.stdout.write('An environment session is set and takes precedence. Unset it if you want the plugin to use this saved account.\n');
  } else if (command === 'logout') {
    await removeCredentials();
    process.stdout.write('Removed saved credentials. Unset LEETCODE_SESSION and LEETCODE_CSRFTOKEN separately if configured.\n');
  } else if (command === 'status') {
    const credentials = await loadCredentials();
    process.stdout.write(JSON.stringify({ configured: Boolean(credentials.session), source: credentials.source, csrfConfigured: Boolean(credentials.csrf) }) + '\n');
  } else {
    process.stdout.write('Usage: node scripts/auth.mjs login|status|logout\nCredentials are entered locally with hidden prompts.\n');
  }
}
main().catch(error => {
  // All client/credential errors are sanitized; never print transport internals.
  process.stderr.write(`${error.message}\n`); process.exitCode = 1;
});
