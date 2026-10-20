import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBrowserExecutable, desktopExecutable, supportsBrowserSignIn } from '../src/default-browser.mjs';

test('Windows queries the effective HTTPS default instead of stale registry choices', async () => {
  const expected = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
  let calls = 0;
  const actual = await defaultBrowserExecutable({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' },
    run: async (file, args, options) => {
      calls++;
      assert.equal(file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.ok(args.includes('-NonInteractive'));
      const script = args.at(-1);
      assert.match(script, /QueryCurrentDefault\("https", 1, 1, out association\)/);
      assert.match(script, /AssocQueryStringW\(0x800, 2, \$association/);
      assert.doesNotMatch(script, /Get-ItemProperty|SetAppAsDefault|Set-ItemProperty/);
      return { stdout: JSON.stringify({ path: expected }) };
    }, canAccess: async path => { assert.equal(path, expected); } });
  assert.equal(actual, expected);
  assert.equal(calls, 1);
});

test('macOS resolves the default browser through Launch Services', async () => {
  const expected = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const actual = await defaultBrowserExecutable({ platform: 'darwin', env: {},
    run: async (file, args) => {
      assert.equal(file, '/usr/bin/osascript');
      assert.equal(args[1], 'JavaScript');
      return { stdout: JSON.stringify({ path: expected }) };
    }, canAccess: async () => {} });
  assert.equal(actual, expected);
});

test('Linux uses the selected desktop entry and ignores unrelated desktop actions', async () => {
  const actual = await defaultBrowserExecutable({ platform: 'linux', env: { XDG_DATA_HOME: '/home/test/.local/share' },
    run: async (file, args) => {
      assert.equal(file, 'xdg-settings');
      assert.deepEqual(args, ['get', 'default-web-browser']);
      return { stdout: 'brave-browser.desktop\n' };
    }, read: async () => '[Desktop Entry]\nName=Brave\nExec="/opt/Brave Browser/brave" %U\n\n[Desktop Action other]\nExec=/usr/bin/other\n',
    canAccess: async () => {} });
  assert.equal(actual, '/opt/Brave Browser/brave');
});

test('desktop entry paths cannot traverse outside the applications directory', async () => {
  let reads = 0;
  await assert.rejects(() => defaultBrowserExecutable({ platform: 'linux', env: {},
    run: async () => ({ stdout: '../../private.desktop' }), read: async () => { reads++; } }));
  assert.equal(reads, 0);
});

test('a desktop entry is parsed as data, never as a shell command', () => {
  assert.equal(desktopExecutable('[Desktop Entry]\nExec="/opt/Browser With Spaces/chrome" --new-window %u\n'), '/opt/Browser With Spaces/chrome');
  assert.equal(desktopExecutable('[Desktop Entry]\nExec=/usr/bin/chromium %U\n'), '/usr/bin/chromium');
  assert.throws(() => desktopExecutable('[Desktop Entry]\nExec="unterminated\n'));
  assert.throws(() => desktopExecutable('[Desktop Entry]\nExec=%u\n'));
  assert.throws(() => desktopExecutable('[Desktop Action other]\nExec=/usr/bin/chrome\n'));
});

test('only supported Chromium browser executables are selected for this adapter', () => {
  for (const path of ['C:\\Browser\\msedge.exe', 'C:\\Browser\\chrome.exe', 'C:\\Browser\\brave.exe', '/usr/bin/chromium', '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    assert.equal(supportsBrowserSignIn(path), true, path);
  }
  for (const path of ['/usr/bin/firefox', '/Applications/Safari.app/Contents/MacOS/Safari', '/usr/bin/flatpak', '/usr/bin/env', '/tmp/fake-chrome.exe']) {
    assert.equal(supportsBrowserSignIn(path), false, path);
  }
});

test('unavailable default executables do not turn into another installed browser', async () => {
  await assert.rejects(() => defaultBrowserExecutable({ platform: 'darwin', env: {},
    run: async () => ({ stdout: JSON.stringify({ path: '/Applications/missing/chrome' }) }),
    canAccess: async () => { throw new Error('Missing'); } }));
});
