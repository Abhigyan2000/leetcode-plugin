import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, delimiter, isAbsolute, win32 } from 'node:path';

const execute = promisify(execFile);
const environmentValue = (env, name) => env[Object.keys(env).find(key => key.toUpperCase() === name.toUpperCase())];

// Read the current HTTPS association, then ask Windows for its executable.
// This never changes associations or executes the registered open command.
const WINDOWS_DEFAULT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$association = Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' -Name ProgId
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LeetCodeDefaultBrowser {
  [DllImport("Shlwapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  public static extern int AssocQueryStringW(uint flags, uint kind, string association, string verb, StringBuilder output, ref uint length);
}
'@
[uint32]$length = 0
$null = [LeetCodeDefaultBrowser]::AssocQueryStringW(0, 2, $association, 'open', $null, [ref]$length)
if ($length -eq 0) { throw 'No default browser executable' }
$buffer = [System.Text.StringBuilder]::new([int]$length)
$result = [LeetCodeDefaultBrowser]::AssocQueryStringW(0, 2, $association, 'open', $buffer, [ref]$length)
if ($result -ne 0) { throw 'Default browser lookup failed' }
@{ path = $buffer.ToString() } | ConvertTo-Json -Compress
`;

const MAC_DEFAULT = `
ObjC.import('AppKit');
ObjC.import('Foundation');
var url = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString('https://leetcode.com'));
JSON.stringify({path: $.NSBundle.bundleWithURL(url).executablePath.js});
`;

export function desktopExecutable(text) {
  // Only the main Desktop Entry applies; action entries may open other apps.
  const section = text.match(/^\[Desktop Entry\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  if (!section) throw new Error('Desktop entry missing');
  const line = section.match(/^Exec=(.*)$/m)?.[1]?.trim();
  if (!line) throw new Error('Desktop executable missing');
  const match = line.match(/^(?:"((?:[^"\\]|\\.)+)"|([^\s"']+))(?:\s|$)/);
  if (!match) throw new Error('Unsupported desktop command');
  const executable = (match[1] || match[2]).replace(/\\(["\\])/g, '$1');
  if (/[\x00-\x1f%]/.test(executable)) throw new Error('Invalid desktop executable');
  return executable;
}

export async function resolveBrowserExecutable(executable, env, canAccess = path => access(path, constants.X_OK)) {
  if (!executable || /[\x00-\x1f]/.test(executable)) throw new Error('Invalid executable');
  const candidates = isAbsolute(executable) || win32.isAbsolute(executable)
    ? [executable]
    : (env.PATH || '').split(delimiter).filter(isAbsolute).map(directory => join(directory, executable));
  for (const candidate of candidates) {
    try { await canAccess(candidate); return candidate; } catch {}
  }
  throw new Error('Default browser executable unavailable');
}

export async function defaultBrowserExecutable({ env = process.env, platform = process.platform,
  run = execute, read = readFile, canAccess, home = homedir() } = {}) {
  const options = { env, encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024, windowsHide: true, shell: false };
  let executable;
  if (platform === 'win32') {
    const root = environmentValue(env, 'SystemRoot');
    if (!root || !win32.isAbsolute(root)) throw new Error('Windows directory unavailable');
    const powershell = win32.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_DEFAULT], options);
    executable = JSON.parse(stdout.trim()).path;
  } else if (platform === 'darwin') {
    const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_DEFAULT], options);
    executable = JSON.parse(stdout.trim()).path;
  } else if (platform === 'linux') {
    const { stdout } = await run('xdg-settings', ['get', 'default-web-browser'], options);
    const desktopId = stdout.trim();
    if (!/^[A-Za-z0-9_.-]+\.desktop$/.test(desktopId) || desktopId.startsWith('.')) throw new Error('Invalid default browser desktop ID');
    const roots = [env.XDG_DATA_HOME || join(home, '.local/share'), ...(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')].filter(isAbsolute);
    for (const root of roots) {
      let content;
      try { content = await read(join(root, 'applications', desktopId), 'utf8'); } catch { continue; }
      executable = desktopExecutable(content);
      break;
    }
  } else throw new Error('Unsupported operating system');
  return resolveBrowserExecutable(executable, env, canAccess);
}

export function supportsBrowserSignIn(executable) {
  const name = executable.replaceAll('\\', '/').split('/').pop().toLowerCase();
  return /^(?:chrome|msedge|chromium|brave|vivaldi)(?:\.exe)?$/.test(name) ||
    /^(?:google-chrome(?:-stable|-beta|-unstable)?|chromium-browser|microsoft-edge(?:-stable|-beta|-dev)?|brave-browser(?:-stable|-beta|-nightly)?|vivaldi-stable)$/.test(name) ||
    ['google chrome', 'google chrome beta', 'google chrome dev', 'google chrome canary', 'microsoft edge', 'microsoft edge beta', 'microsoft edge dev', 'brave browser'].includes(name);
}
