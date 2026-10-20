import { main } from './server.mjs';
main().catch(() => { process.stderr.write('LeetCode plugin could not start. Use Node.js 22 or newer and check local setup.\n'); process.exitCode = 1; });
