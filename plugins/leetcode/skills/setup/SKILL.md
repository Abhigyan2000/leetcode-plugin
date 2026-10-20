---
name: setup
description: Open LeetCode's browser sign-in window, verify the connected account, or disconnect this plugin.
---

For a connection request, call `connect_account` directly once. It verifies an existing account, reuses a pending sign-in, or opens LeetCode's real sign-in page in the default supported browser. Do not call `auth_status` first, inspect processes, or run a separate setup script.

If `CONNECTED` is returned, report the verified username and finish. If `AWAITING_LOGIN` is returned, briefly ask the user to sign in in the returned browser. The visible window uses a separate temporary profile; it does not reuse their normal browser login. The plugin handles waiting, verification, saving, and cleanup in the background. The window closes on completion. Do not poll, wait in tools, or reopen it while pending.

Use `auth_status` once if the user asks for connection status or says they finished sign-in. Otherwise, proceed directly with the next requested LeetCode tool; account tools verify identity themselves. Never infer connection from a pending window. On failure, expiry, or cancellation, retry only when requested. `cancel_login` closes a pending window.

Account responses include `pluginVersion` from the running server. Use that to diagnose a stale version only when needed; an installed update alone does not prove the live server changed. Never inspect login fields, enter credentials, or expose cookies in chat.

To disconnect, call `disconnect_account`. To switch an already connected account, disconnect it before opening a new sign-in window. Environment overrides must be unset locally; the plugin will not mix an environment account with a new saved account. Expired sessions can be refreshed through `connect_account`.

This is a local browser connection, not LeetCode OAuth. The plugin opens its own temporary profile; it must not inspect or copy a regular browser profile. It does not bypass site challenges. The default HTTPS browser comes from the operating system. Chrome, Edge, Brave, Vivaldi, and Chromium executables are supported. If the default is unsupported or cannot be resolved, explain the returned error; do not silently open another browser. The user can choose a supported default or configure `LEETCODE_BROWSER_PATH`. Keep manual cookie login via `node scripts/auth.mjs login` as an optional fallback; don't make it the default. The bundled README covers advanced configuration. Node.js 22 or newer is required.
