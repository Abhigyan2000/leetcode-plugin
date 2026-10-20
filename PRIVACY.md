# Privacy

LeetCode Companion runs on your computer. There is no project-operated server, analytics, advertising, or telemetry.

The bundled server sends problem queries and your requested account operations to `https://leetcode.com`. Authenticated requests carry your LeetCode session/CSRF cookies. Runs and submissions send the supplied source code and test input to LeetCode. LeetCode's policies govern its handling of that data.

The local login script saves cookies in a plaintext file in your user application-data directory, outside the repository. Environment-variable configuration is also supported. The server does not return cookies in its tool results or include upstream response bodies in error messages. Logout removes the saved local file, not the browser session or separately configured environment variables.

Your agent client and model provider receive the tool output needed for a task, including profile information, progress, submission history, and saved source code. Their policies and your client data controls also apply.

GitHub handles repository downloads and optional update checks under its own policies. Node.js and the client application are separate requirements. For development only, npm downloads build/test dependencies. The installed bundled server does not install dependencies at startup.
