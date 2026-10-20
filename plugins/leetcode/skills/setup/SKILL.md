---
name: setup
description: Open LeetCode's browser sign-in window, verify the connected account, or disconnect this plugin.
---

Call `auth_status` first. It reports configuration and verifies the account without returning credentials. If connected, show the username and finish unless the user requested a change.

If setup is needed, use `connect_account`. It opens LeetCode's real sign-in page in the user's default supported browser with the address bar visible. Tell the user to sign in and complete any verification themselves. Do not inspect login fields or offer to enter credentials. The plugin reads only the resulting LeetCode session cookies, verifies the account, and saves them in local application data. Cookies and passwords must never appear in chat or tool arguments.

Use `auth_status` to check completion after the user signs in. `connected: true` and the returned username establish the active account; a pending browser window or configured cookie alone does not. While sign-in is pending, allow the user time to act; do not poll continuously or block them with long tool waits. `cancel_login` closes a pending window. If they close the window, cancel, or sign-in expires, offer another attempt only when requested.

To disconnect, call `disconnect_account`. To switch an already connected account, disconnect it before opening a new sign-in window. Environment overrides must be unset locally; the plugin will not mix an environment account with a new saved account. Expired sessions can be refreshed through `connect_account`.

This is a local browser connection, not LeetCode OAuth. The plugin opens its own temporary profile; it must not inspect or copy a regular browser profile. It does not bypass site challenges. The default HTTPS browser comes from the operating system. Chrome, Edge, Brave, Vivaldi, and Chromium executables are supported. If the default is unsupported or cannot be resolved, explain the returned error; do not silently open another browser. The user can choose a supported default or configure `LEETCODE_BROWSER_PATH`. Keep manual cookie login via `node scripts/auth.mjs login` as an optional fallback; don't make it the default. The bundled README covers advanced configuration. Node.js 22 or newer is required.
