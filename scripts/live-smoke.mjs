import assert from 'node:assert/strict';
import { LeetCodeClient } from '../src/client.mjs';

// Public reads only. Never loads account credentials or calls judge endpoints.
const client = new LeetCodeClient({ credentials: async () => ({ source: 'none' }) });
try {
  const problem = await client.problem('two-sum');
  assert.equal(problem.titleSlug, 'two-sum');
  assert.ok(problem.codeSnippets.some(s => s.langSlug === 'python3'));
  console.log(`Public problem verified: ${problem.title}`);
  const daily = await client.daily();
  assert.ok(daily?.date && daily?.question?.titleSlug);
  console.log(`Daily challenge verified: ${daily.date} / ${daily.question.titleSlug}`);
} catch (error) {
  console.error(`Public live check: ${error.code || 'FAILED'}: ${error.message}`);
  process.exitCode = 1;
}
