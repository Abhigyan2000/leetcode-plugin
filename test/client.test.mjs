import test from 'node:test';
import assert from 'node:assert/strict';
import { LeetCodeClient } from '../src/client.mjs';

const credentials = async () => ({ session: 'fixture-session', csrf: 'fixture-csrf', source: 'fixture' });
const identity = { data: { userStatus: { isSignedIn: true, username: 'personal-user' } } };
const problem = { data: { question: { questionId: '1', titleSlug: 'two-sum', codeSnippets: [{ langSlug: 'python3' }], exampleTestcases: '[2,7,11,15]\n9' } } };
function fixture(responses, options = {}) {
  const calls = [];
  const client = new LeetCodeClient({ credentials, ...options, fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    assert.ok(responses.length, 'Unexpected API request');
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : Response.json(next);
  } });
  return { client, calls };
}

test('missing credentials report disconnected without network access', async () => {
  const { client, calls } = fixture([], { credentials: async () => ({ source: 'none' }) });
  assert.equal((await client.authStatus()).connected, false);
  await assert.rejects(() => client.solved(), { code: 'AUTH_REQUIRED' });
  assert.equal(calls.length, 0);
});

test('configured cookies are not treated as a verified login', async () => {
  const guest = { data: { userStatus: { isSignedIn: false, username: null } } };
  const { client, calls } = fixture([guest, guest]);
  assert.equal((await client.authStatus()).connected, false);
  await assert.rejects(() => client.execute({ titleSlug: 'two-sum', lang: 'python3', code: 'x' }, true), { code: 'SESSION_EXPIRED' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.url.endsWith('/graphql/')));
});

test('solved problems filter accepted status and return real pagination', async () => {
  const { client, calls } = fixture([identity, { data: { questionList: { totalNum: 3, data: [{ titleSlug: 'two-sum', status: 'ac' }] } } }]);
  const page = await client.solved({ offset: 1, limit: 1, difficulty: 'EASY' });
  assert.equal(page.username, 'personal-user');
  assert.equal(page.nextOffset, 2);
  assert.equal(page.total, 3);
  const payload = JSON.parse(calls[1].body);
  assert.deepEqual(payload.variables, { skip: 1, limit: 1, filters: { status: 'AC', difficulty: 'EASY' } });
});

test('an empty page never produces an endless pagination cursor', async () => {
  const { client } = fixture([identity, { data: { questionList: { totalNum: 50, data: [] } } }]);
  assert.equal((await client.solved()).nextOffset, null);
});

test('history carries pagination and safely encodes last-key tokens', async () => {
  const { client, calls } = fixture([identity, { submissions_dump: [{ id: 1 }], has_next: true, last_key: 'next' }]);
  const page = await client.submissions({ titleSlug: 'two-sum', offset: 2, limit: 1, lastKey: 'a&b=?' });
  assert.equal(page.nextOffset, 3);
  assert.equal(page.lastKey, 'next');
  const url = new URL(calls[1].url);
  assert.equal(url.pathname, '/api/submissions/two-sum/');
  assert.equal(url.searchParams.get('lastkey'), 'a&b=?');
});

test('writes require CSRF before any API calls', async () => {
  const { client, calls } = fixture([], { credentials: async () => ({ session: 'fixture-session' }) });
  await assert.rejects(() => client.execute({ titleSlug: 'two-sum', lang: 'python3', code: 'x' }, true), { code: 'CSRF_REQUIRED' });
  assert.equal(calls.length, 0);
});

test('submission uses the fetched question ID and returns a judge ID without resubmitting', async () => {
  const { client, calls } = fixture([identity, problem, { submission_id: 42 }]);
  const result = await client.execute({ titleSlug: 'two-sum', lang: 'python3', code: 'class Solution: pass' }, true);
  assert.equal(result.judgeId, '42');
  assert.equal(result.state, 'PENDING');
  assert.equal(result.username, 'personal-user');
  assert.deepEqual(JSON.parse(calls[2].body), { lang: 'python3', question_id: '1', typed_code: 'class Solution: pass' });
  assert.equal(calls[2].headers['x-csrftoken'], 'fixture-csrf');
  assert.ok(calls[2].headers.Cookie.includes('csrftoken=fixture-csrf'));
  assert.equal(calls[2].redirect, 'error');
  assert.equal(calls.filter(c => c.url.endsWith('/submit/')).length, 1);
});

test('running examples uses test input without submitting to the full judge', async () => {
  const { client, calls } = fixture([identity, problem, { interpret_id: 'runcode_123' }]);
  const result = await client.execute({ titleSlug: 'two-sum', lang: 'python3', code: 'x' });
  assert.equal(result.kind, 'test_run');
  assert.equal(result.judgeId, 'runcode_123');
  assert.equal(JSON.parse(calls[2].body).data_input, '[2,7,11,15]\n9');
  assert.ok(calls[2].url.endsWith('/interpret_solution/'));
});

test('language mismatches cannot reach the write endpoint', async () => {
  const { client, calls } = fixture([identity, problem]);
  await assert.rejects(() => client.execute({ titleSlug: 'two-sum', lang: 'ruby', code: 'x' }, true), { code: 'LANGUAGE_UNAVAILABLE' });
  assert.equal(calls.length, 2);
});

test('a network failure during a write reports uncertainty and never retries', async () => {
  const { client, calls } = fixture([identity, problem, new Error('sensitive network diagnostics fixture-session')]);
  await assert.rejects(() => client.execute({ titleSlug: 'two-sum', lang: 'python3', code: 'x' }, true), error => {
    assert.equal(error.code, 'WRITE_OUTCOME_UNKNOWN');
    assert.ok(!error.message.includes('fixture-session'));
    return true;
  });
  assert.equal(calls.length, 3);
});

test('malformed successful write responses do not claim success', async () => {
  const { client } = fixture([identity, problem, { detail: 'unrecognized' }]);
  await assert.rejects(() => client.execute({ titleSlug: 'two-sum', lang: 'python3', code: 'x' }, true), { code: 'WRITE_OUTCOME_UNKNOWN' });
});

test('polling preserves the existing ID and performs no new write', async () => {
  const { client, calls } = fixture([identity, { state: 'SUCCESS', status_code: 10, status_msg: 'Accepted' }]);
  const result = await client.checkResult('42');
  assert.equal(result.status_msg, 'Accepted');
  assert.equal(calls[1].method, 'GET');
  assert.ok(calls[1].url.endsWith('/submissions/detail/42/check/'));
});

test('rate limits preserve retry guidance without exposing response bodies', async () => {
  const { client } = fixture([new Response('private fixture-session', { status: 429, headers: { 'retry-after': '120' } })]);
  await assert.rejects(() => client.daily(), error => {
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.detail.retryAfter, '120');
    assert.ok(!error.message.includes('fixture-session'));
    return true;
  });
});

test('GraphQL error bodies are not exposed to the assistant', async () => {
  const { client } = fixture([{ errors: [{ message: 'private fixture-session' }] }]);
  await assert.rejects(() => client.profile('some-user'), error => error.code === 'QUERY_FAILED' && !error.message.includes('fixture-session'));
});

test('browser challenges are surfaced without retries or HTML leakage', async () => {
  const { client, calls } = fixture([new Response('<html>fixture-session</html>', { status: 403 })]);
  await assert.rejects(() => client.daily(), { code: 'ACCESS_DENIED' });
  assert.equal(calls.length, 1);
});

test('saved submission source is returned only through the authenticated endpoint', async () => {
  const { client, calls } = fixture([identity, { data: { submissionDetails: { id: 42, code: 'class Solution: pass', statusCode: 10 } } }]);
  assert.equal((await client.submission(42)).code, 'class Solution: pass');
  assert.equal(JSON.parse(calls[1].body).variables.submissionId, 42);
});

test('only the fixed LeetCode origin receives cookies and redirects are disabled', async () => {
  const { client, calls } = fixture([{ data: { activeDailyCodingChallengeQuestion: { date: 'fixture' } } }]);
  await client.daily();
  assert.ok(calls.every(call => new URL(call.url).origin === 'https://leetcode.com' && call.redirect === 'error'));
  await assert.rejects(() => client.request('//another-host.example/'));
});
