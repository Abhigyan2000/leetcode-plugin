# Privacy

LeetCode Companion runs on your computer. There is no project-operated server, analytics, advertising, or telemetry.

The bundled server sends problem queries and your requested account operations to `https://leetcode.com`. Authenticated requests carry your LeetCode session/CSRF cookies. Runs and submissions send the supplied source code and test input to LeetCode. LeetCode's policies govern its handling of that data.

Browser sign-in opens LeetCode's own login page in a temporary profile using your default supported Chromium-based browser. The plugin reads your operating system's browser preference without changing it; an explicit browser executable override is also supported. You enter credentials directly on the website. The plugin does not inspect password fields, read page contents, or record network traffic. It reads only cookies scoped to `https://leetcode.com/` from that separate profile, keeps the session and CSRF cookies, and verifies the connected username. It does not read cookies from your regular browser profile or from external identity providers.

The browser's local debugging connection exists only for this temporary sign-in profile and binds to loopback. The window and temporary profile are closed and removed after normal completion, cancellation, or timeout. A crash or forced shutdown can leave a temporary profile in the `sign-in` folder beside the credential file; cleanup failures are reported by the login status.

Verified session cookies are saved in a plaintext file in your user application-data directory, outside the repository. Manual local login and environment-variable configuration remain available. The server does not return cookies in its tool results or include upstream response bodies in error messages. Disconnecting removes the saved local file, not regular browser sessions or separately configured environment variables.

Your agent client and model provider receive the tool output needed for a task, including profile information, progress, submission history, and saved source code. Their policies and your client data controls also apply.

GitHub handles repository downloads and optional update checks under its own policies. Node.js and the client application are separate requirements. For development only, npm downloads build/test dependencies. The installed bundled server does not install dependencies at startup.
