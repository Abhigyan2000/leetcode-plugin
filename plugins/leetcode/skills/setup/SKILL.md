---
name: setup
description: Connect or disconnect this LeetCode plugin using locally configured session cookies, and verify the connected account.
---

Call `auth_status` first. It reports configuration and verifies the account without returning credentials. If connected, show the username and finish unless the user requested a change.

If setup is needed, direct the user to run `node scripts/auth.mjs login` in this installed plugin's directory in their own interactive terminal. The script prompts for `LEETCODE_SESSION` and `csrftoken` without echoing them. They come from the user's signed-in leetcode.com browser session, under Developer Tools > Application/Storage > Cookies. Do not ask for either cookie in chat or pass secrets as tool arguments. The setup script stores them in the user's local application data outside the plugin checkout. Environment variable configuration is also supported; see the bundled README.

Run `auth_status` again after the user completes local setup. Report the verified username; a configured cookie alone does not prove a working connection. If a cookie expired, repeat local login. To disconnect, use `node scripts/auth.mjs logout` in the user's terminal; environment overrides must be unset separately.

This plugin supports leetcode.com and personal practice. It does not offer OAuth or a hosted account connection. A missing Node.js runtime requires Node.js 22 or newer before the bundled server can start.
