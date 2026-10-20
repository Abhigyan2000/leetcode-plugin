<div align="center">

<h1>LeetCode Companion</h1>

<p>Practice LeetCode from Codex, with your own account and submission history.</p>

<p>
  <a href="https://github.com/Abhigyan2000/leetcode-plugin/actions/workflows/ci.yml"><img src="https://github.com/Abhigyan2000/leetcode-plugin/actions/workflows/ci.yml/badge.svg" alt="Build and tests"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-22%2B-475569" alt="Node.js 22 or newer"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-475569" alt="MIT license"></a>
</p>

<p>
  <a href="#install">Install</a> &nbsp;&middot;&nbsp;
  <a href="#connect-your-account">Connect your account</a> &nbsp;&middot;&nbsp;
  <a href="#tools">Tools</a> &nbsp;&middot;&nbsp;
  <a href="https://github.com/Abhigyan2000/leetcode-plugin/releases/tag/v0.2.3">Download</a>
</p>

</div>

Look up a problem, revisit an old submission, or test the solution you're working on. LeetCode Companion gives Codex access to your progress and saved code, with tools to submit a solution when you ask.

The plugin runs on your computer and talks directly to LeetCode. Each person connects their own account. The server, its dependencies, and the setup and practice skills are bundled together.

## Install

You'll need **Node.js 22 or newer**, a desktop Codex client with plugin support, and a supported Chromium-based browser for sign-in: Chrome, Edge, Brave, Vivaldi, or Chromium.

```sh
codex plugin marketplace add Abhigyan2000/leetcode-plugin --ref main
```

Restart the desktop app. In the Plugins directory, choose **Abhigyan's LeetCode Plugin** and install **LeetCode Companion**. Run the plugin's setup workflow to connect your account.

The plugin is free to use and runs locally, so there's no backend to host or paid API key to configure. See the [Codex plugin documentation](https://developers.openai.com/plugins/build/plugins) for marketplace setup details.

<details>
<summary>Local checkout and other MCP clients</summary>

To use a checkout as the marketplace source:

```sh
git clone https://github.com/Abhigyan2000/leetcode-plugin.git
codex plugin marketplace add ./leetcode-plugin
```

For an MCP client without plugin support, register the bundled server as a stdio connection:

```json
{
  "mcpServers": {
    "leetcode": {
      "command": "node",
      "args": ["/absolute/path/to/leetcode-plugin/plugins/leetcode/server/index.mjs"]
    }
  }
}
```

Adjust the configuration wrapper to match your client. A direct MCP connection provides the tools; install the plugin to get the setup and practice skills as well.

</details>

## Connect your account

Run the plugin's **Setup** workflow, or ask Codex:

> Connect my LeetCode account.

1. Connect checks your saved account. If you're already signed in, it returns your username. Otherwise it opens [LeetCode's sign-in page](https://leetcode.com/accounts/login/) in your default browser, with the address bar visible. Repeated requests reuse a pending window.
2. Sign in and complete any verification there.
3. The plugin verifies and saves your session in the background, then closes the window. Continue with your next LeetCode request, or ask for your connection status to confirm the username.

Connecting takes one tool call; no separate status check or progress polling is needed. Account tools verify identity themselves. Connection responses include the running plugin version and, while sign-in is pending, the selected browser. If you have just updated the plugin, restart your client to load the new server; downloading an update does not replace an already running server.

No terminal commands or cookie copying are needed. The window uses a temporary browser profile, separate from your usual tabs and accounts. The plugin reads only the resulting LeetCode session cookies. It doesn't inspect passwords or sign-in fields.

The default browser is read from your operating system's HTTPS association. On Windows, the plugin asks the shell for the current effective default rather than reading legacy registry preferences. If it isn't supported by the sign-in adapter, the plugin explains that instead of choosing a different browser. Firefox, Safari, and sandboxed launchers such as Flatpak aren't supported by this adapter. You can select a supported executable explicitly with `LEETCODE_BROWSER_PATH`.

You can ask Codex to cancel a pending login or disconnect the saved account. Sign-in expires after five minutes. This is a local browser connection; no account credentials pass through a project-operated server.

The credentials file is **plaintext**. It uses owner-only permissions on POSIX and your user profile's inherited permissions on Windows. See [Security](SECURITY.md) for details.

<details>
<summary>Credential storage, browser selection, and manual setup</summary>

Default storage locations:

| Platform | Credential file |
| --- | --- |
| Windows | `%LOCALAPPDATA%/leetcode-plugin/credentials.json` |
| Linux / macOS | `$XDG_CONFIG_HOME/leetcode-plugin/credentials.json`, or `~/.config/leetcode-plugin/credentials.json` |

You can also configure the MCP process environment:

| Variable | Purpose |
| --- | --- |
| `LEETCODE_SESSION` | Session cookie; overrides the saved account |
| `LEETCODE_CSRFTOKEN` | Matching CSRF token, required to run or submit code |
| `LEETCODE_CREDENTIALS_FILE` | Custom path for the local credentials file |
| `LEETCODE_BROWSER_PATH` | Absolute path to a supported browser executable; overrides the system default |

An environment session uses only its matching environment CSRF token. It never borrows one from the saved account. Credentials are reloaded for each operation, so refreshing the local file doesn't require a server restart.

The plugin reads the default HTTPS association on Windows, Launch Services on macOS, and the default desktop browser on Linux. It doesn't download a browser. If sign-in is unavailable in your browser, manual local setup is still supported: open the installed `leetcode` plugin folder in your terminal and run:

```sh
node scripts/auth.mjs login
```

Copy `LEETCODE_SESSION` and `csrftoken` from your signed-in browser's Developer Tools > Application/Storage > Cookies into the hidden prompts. Keep cookies out of chat and command-line arguments.

To check local configuration or remove saved credentials from a terminal:

```sh
node scripts/auth.mjs status
node scripts/auth.mjs logout
```

The same account checks and logout are available through `auth_status` and `disconnect_account` in Codex. Reconnect when the session expires. Disconnecting deletes the saved file; unset any environment overrides separately. It does not revoke your browser session.

</details>

## Working with the plugin

Ask Codex for the task you have in mind:

> Show my solved medium problems tagged with dynamic programming.

> Review my previous submissions for Two Sum.

> Run this Python solution on the examples, then explain the result.

Public profiles, problem statements, and the daily challenge work without login. Your solved list, submission history, and saved code use the connected account. Runs and submissions execute on LeetCode's judge.

## Tools

| Tool | What it does |
| --- | --- |
| `auth_status` | Verify the connected account without returning cookies |
| `connect_account` | Open LeetCode's sign-in window and connect your account |
| `cancel_login` | Close a pending sign-in window |
| `disconnect_account` | Remove the plugin's saved local credentials |
| `get_profile` | Read a public profile and solved counts |
| `get_problem` | Fetch a statement, hints, tags, and language templates |
| `get_daily_challenge` | Get the current daily challenge |
| `list_solved_problems` | Page through your solved problems |
| `list_submissions` | Read your submission history, optionally for one problem |
| `get_submission` | Retrieve saved source code and judge details |
| `run_code` | Start a test run with example or custom input |
| `submit_solution` | Submit code to the judge as the connected user |
| `check_result` | Check a test run or submission by its judge ID |

Runs and submissions return a `judgeId`. Check that ID for the result; a pending response doesn't mean the code passed. If a write times out, check your history before retrying. The server never automatically repeats a submission.

Submitting sends code for evaluation. Publishing a community solution article isn't supported.

## Development

```sh
npm ci
npm run check
npm run smoke
npm run package
```

Source lives in `src/`. The distributable plugin lives in `plugins/leetcode/`, and the marketplace catalog is at `.agents/plugins/marketplace.json`. Run `npm run build` after changing source and commit the updated bundle so installs work straight from GitHub.

The test suite covers authentication, pagination, submission handling, and MCP behavior using fixtures. The smoke test launches the standalone bundle from a fresh directory. CI runs on Windows and Linux with Node.js 22 and 24. Neither the tests nor CI submit code to a live account.

For a read-only check against the live site:

```sh
npm run smoke:live
```

This fetches Two Sum and the daily challenge without loading credentials. Authenticated history and judge operations need separate verification with your own session.

## Project status

**v0.2.3 is an early release for leetcode.com.** Public problem reads have been verified against the live site. LeetCode's website APIs can change, sessions expire, and some requests may require a browser check. Complete those checks yourself in the sign-in window. The plugin doesn't bypass them or premium access restrictions.

Distribution is through this GitHub marketplace and the release ZIP. The plugin isn't listed in OpenAI's public directory.

## Privacy

The project operates no central server and collects no telemetry. Requests go to `https://leetcode.com`; redirects are rejected. Your agent client and model provider can process tool results, including account history and source code. Read the [privacy notes](PRIVACY.md) for the full data flow.

## License

[MIT](LICENSE). Bundled dependencies retain their own licenses; see [third-party notices](https://github.com/Abhigyan2000/leetcode-plugin/blob/main/plugins/leetcode/THIRD_PARTY_NOTICES.txt).

<sub>Independent community project. Not affiliated with LeetCode or OpenAI.</sub>
