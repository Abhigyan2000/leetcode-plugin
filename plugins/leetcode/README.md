# LeetCode Companion

A free, open-source **desktop agent plugin** for using your LeetCode account from Codex. The plugin bundles a local MCP server and setup/practice skills. It reads your progress and submission history, fetches problems, runs code, and submits solutions when you ask.

Community project; not affiliated with or endorsed by LeetCode or OpenAI. Version 0.1.0 targets **leetcode.com**. LeetCode's website APIs are not a stable public contract: they may change or require a browser check. No premium access or site checks are bypassed.

## Install

Requires **Node.js 22 or newer** and a desktop Codex client with plugin support. No hosting, database, paid API key, or npm runtime installation is required. The server and its JavaScript dependencies are bundled in the repository and release ZIP.

Add the repository as a plugin marketplace:

```sh
codex plugin marketplace add Abhigyan2000/leetcode-plugin --ref main
```

Restart the desktop app, open the Plugins directory, select **Abhigyan's LeetCode Plugin**, and install **LeetCode Companion**. Run its setup workflow. These steps follow the [official plugin packaging and marketplace documentation](https://developers.openai.com/plugins/build/plugins). Client availability and UI can vary by version.

For a local checkout, use `codex plugin marketplace add /absolute/path/to/leetcode-plugin` instead. The marketplace lives at `.agents/plugins/marketplace.json` and points to `plugins/leetcode/`. A marketplace makes the plugin discoverable; it does not install or authenticate it automatically.

If your client supports MCP but not plugin marketplaces, configure a local stdio server with command `node` and args `["/absolute/path/to/leetcode-plugin/plugins/leetcode/server/index.mjs"]`. The bundled practice/setup skills are available only when installed as a plugin.

## Connect your account

In **your own interactive terminal**, open the installed `leetcode` plugin directory (or `plugins/leetcode` in this checkout) and run:

```sh
node scripts/auth.mjs login
```

Sign in at `https://leetcode.com` in your browser. Open Developer Tools > Application (or Storage) > Cookies > `https://leetcode.com`. Copy the values of **LEETCODE_SESSION** and **csrftoken** into the script's hidden prompts. Do not paste them into a chat, issue, screenshot, or command-line argument. This is local session-cookie setup, not OAuth or an official LeetCode account-linking flow.

The script verifies the session before saving it. Credentials are stored outside the repository and installed plugin:

| Platform | Default credential file |
| --- | --- |
| Windows | `%LOCALAPPDATA%/leetcode-plugin/credentials.json` |
| Linux/macOS | `$XDG_CONFIG_HOME/leetcode-plugin/credentials.json`, falling back to `~/.config/leetcode-plugin/credentials.json` |

The file is plaintext. New directories/files use owner-only permissions on POSIX; on Windows, access follows your user profile's inherited ACLs. Keep the application-data directory private. This version does not use an OS keychain.

Advanced: provide `LEETCODE_SESSION` and `LEETCODE_CSRFTOKEN` through your local MCP process environment instead, or override the file path using `LEETCODE_CREDENTIALS_FILE`. An environment session replaces the entire saved identity; its CSRF token is never taken from another account's file. The server reloads credentials for each operation, so a running server can pick up a refreshed local file.

Use the plugin's `auth_status` tool to verify the connected username. To inspect local configuration or remove saved credentials:

```sh
node scripts/auth.mjs status
node scripts/auth.mjs logout
```

Logout removes the local file; unset environment overrides separately. It does not revoke the browser session. If exposed, revoke that session through LeetCode. When a session expires, run login again.

## Use it

- "Show my solved problems and suggest what to practice next."
- "Look at my submissions for Two Sum and explain what improved."
- "Give me a hint for today's daily challenge."
- "Run this Python solution on the examples."
- "Submit this solution in Python 3 and check the result."

| Tool | Account required | Effect |
| --- | --- | --- |
| `auth_status` | Optional | Verify locally configured account, never return cookies |
| `get_profile` | No | Public profile and solved counts |
| `get_problem` | Optional | Problem statement, hints, tags, language templates |
| `get_daily_challenge` | No | Current challenge |
| `list_solved_problems` | Yes | Paginated unique solved problems |
| `list_submissions` | Yes | Paginated submission history, optionally one problem |
| `get_submission` | Yes | Saved source code and judge details |
| `run_code` | Yes, plus CSRF | Start a test run on LeetCode |
| `submit_solution` | Yes, plus CSRF | Submit code to the judge and add to account history |
| `check_result` | Yes | Check an existing judge ID |

Running/submitting returns a `judgeId` immediately. Check that ID until the judge finishes. A timeout or malformed write response can mean the operation was received: check history before retrying. The server never automatically repeats a submission. "Submit" sends code for evaluation; publishing a community solution article is not implemented.

## Free distribution and hosting

The default design has **no central server bill**. Share the public GitHub marketplace or release ZIP. Each installation runs its own server and sends its own requests directly to LeetCode. Your LeetCode session is never shipped to other users. Standard GitHub-hosted Actions are [free for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

This is a desktop plugin, not a cloud/web account connector. Publishing a GitHub repository does not list it in the universal OpenAI plugin directory. That requires a separate submission and review; [local MCP public submissions currently require partner approval](https://developers.openai.com/plugins/deploy/desktop-only).

A hosted edition is future work. It would need an authenticated remote MCP endpoint, per-user credential isolation, encrypted storage or a different secure account connection, and rate limiting. Do not deploy this stdio server behind a public HTTP wrapper using a shared session. Cloudflare Workers has a [free tier](https://developers.cloudflare.com/workers/platform/pricing/), but server-side access to LeetCode must be tested before choosing a host. A free tier is not a guarantee of unlimited free service.

## Develop

```sh
npm ci
npm run check
npm run smoke
npm run package
```

`build` bundles the server/auth CLI into `plugins/leetcode`. `test` uses fixture responses, not live account writes. The smoke test starts the built server through a real stdio MCP client with an isolated empty credential store; it needs no account. `package` creates a ZIP whose root contains the plugin manifest. Commit the rebuilt bundle whenever source changes so Git marketplace installs work immediately.

Live account operations need separate verification with your own account. Offline tests do not establish that LeetCode's current authentication or judge endpoints work. No live submission is made by CI or the smoke test.

## Privacy and security

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md). No telemetry or central credential collection. Requests go to `https://leetcode.com` only; redirects are rejected. The host assistant and its provider can process tool results such as profile data and submitted code. Host tool approvals still apply.

## License

MIT. The standalone bundle includes third-party dependencies; their notices are in `plugins/leetcode/THIRD_PARTY_NOTICES.txt` after building.
