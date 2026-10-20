# Security

Do not include LeetCode cookies, tokens, or private submission data in GitHub issues or pull requests. Report sensitive issues privately using GitHub private vulnerability reporting if enabled on this repository. If that channel is unavailable, open an issue requesting a private contact without including exploit details or secrets.

Credentials confer account access. Store them only in your own local application data or process environment. This version stores local credentials in plaintext, with POSIX owner-only modes and Windows inherited user-profile permissions; it does not implement an OS keychain. Never use a shared account cookie to serve multiple users.

The local MCP server uses stdio, has no HTTP listener, and only sends requests to the fixed LeetCode origin. Requests do not follow redirects. It does not execute submitted code locally. Non-idempotent operations are not retried automatically. Tool annotations distinguish account writes from read operations, and the bundled skill requires the user's authorization for submission.

Website APIs can change. Respect LeetCode's access controls, terms, premium requirements, and rate limits. If a request encounters a browser challenge, sign in using the normal website; this plugin does not solve or bypass challenges.
