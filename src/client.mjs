import { loadCredentials } from './credentials.mjs';

const ORIGIN = 'https://leetcode.com';
const QUESTION = `query PluginQuestion($titleSlug: String!) {
  question(titleSlug: $titleSlug) { questionId questionFrontendId title titleSlug
    content difficulty isPaidOnly status hints sampleTestCase exampleTestcases
    codeSnippets { lang langSlug code } topicTags { name slug } }
}`;
const STATUS = 'query PluginIdentity { userStatus { isSignedIn username } }';

export class LeetCodeError extends Error {
  constructor(code, message, detail = {}) { super(message); this.code = code; this.detail = detail; }
}

export class LeetCodeClient {
  constructor({ fetchImpl = fetch, credentials = loadCredentials, timeoutMs = 20000 } = {}) {
    this.fetch = fetchImpl;
    this.credentials = credentials;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body, credentials, mutation = false, referer = '/' } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path');
    const headers = { Accept: 'application/json', Referer: ORIGIN + referer,
      'User-Agent': 'LeetCodeCompanion/0.2.3 (community desktop plugin)' };
    if (body) headers['Content-Type'] = 'application/json';
    if (credentials?.session) {
      headers.Cookie = `LEETCODE_SESSION=${credentials.session}` + (credentials.csrf ? `; csrftoken=${credentials.csrf}` : '');
      if (credentials.csrf) headers['x-csrftoken'] = credentials.csrf;
    }
    let response;
    try {
      response = await this.fetch(ORIGIN + path, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
        redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new LeetCodeError(mutation ? 'WRITE_OUTCOME_UNKNOWN' : 'NETWORK_ERROR', mutation
        ? 'The request may have reached LeetCode. Check your submission history before retrying; this plugin will not retry it.'
        : 'Could not reach LeetCode. Check your connection and try again.');
    }
    if (response.status === 429) {
      throw new LeetCodeError('RATE_LIMITED', 'LeetCode rate limited this request. Wait before retrying.',
        { retryAfter: response.headers.get('retry-after') || '60 seconds' });
    }
    if ([401, 403].includes(response.status)) {
      throw new LeetCodeError('ACCESS_DENIED', 'LeetCode denied access. Your session may have expired, or the site requires a browser check. Sign in on leetcode.com; do not bypass the check.');
    }
    if (!response.ok) throw new LeetCodeError(mutation ? 'WRITE_OUTCOME_UNKNOWN' : 'UPSTREAM_ERROR',
      mutation ? 'LeetCode returned an error. Check history before retrying this write.' : `LeetCode returned HTTP ${response.status}.`);
    let data;
    try { data = await response.json(); }
    catch { throw new LeetCodeError(mutation ? 'WRITE_OUTCOME_UNKNOWN' : 'INVALID_RESPONSE',
      mutation ? 'Unrecognized write response. Check history before retrying.' : 'LeetCode returned a non-JSON response. Open the site to check sign-in or site challenges.'); }
    return data;
  }

  async graphql(query, variables = {}, credentials) {
    const result = await this.request('/graphql/', { method: 'POST', body: { query, variables }, credentials });
    if (result.errors?.length || !result.data) throw new LeetCodeError('QUERY_FAILED',
      'LeetCode rejected the query. The site API may have changed or this account lacks access.');
    return result.data;
  }

  async authStatus() {
    const credentials = await this.credentials();
    if (!credentials.session) return { connected: false, source: credentials.source, reason: 'Use connect_account to open the LeetCode sign-in window.' };
    const { userStatus } = await this.graphql(STATUS, {}, credentials);
    return { connected: Boolean(userStatus?.isSignedIn && userStatus.username),
      username: userStatus?.isSignedIn ? userStatus.username : undefined,
      source: credentials.source, canSubmit: Boolean(userStatus?.isSignedIn && credentials.csrf) };
  }

  async authenticated(write = false) {
    const credentials = await this.credentials();
    if (!credentials.session) throw new LeetCodeError('AUTH_REQUIRED', 'Use connect_account to sign in through the browser first.');
    if (write && !credentials.csrf) throw new LeetCodeError('CSRF_REQUIRED', 'Code execution and submission require your local csrftoken as well as LEETCODE_SESSION.');
    const { userStatus } = await this.graphql(STATUS, {}, credentials);
    if (!userStatus?.isSignedIn || !userStatus.username) throw new LeetCodeError('SESSION_EXPIRED', 'Your LeetCode session has expired. Use connect_account to sign in again.');
    return { credentials, username: userStatus.username };
  }

  async profile(username) {
    const data = await this.graphql(`query PluginProfile($username: String!) {
      matchedUser(username: $username) { username profile { realName ranking }
        submitStatsGlobal { acSubmissionNum { difficulty count submissions } } }
    }`, { username });
    if (!data.matchedUser) throw new LeetCodeError('NOT_FOUND', 'LeetCode user not found.');
    return data.matchedUser;
  }

  async problem(titleSlug, credentials) {
    const data = await this.graphql(QUESTION, { titleSlug }, credentials);
    if (!data.question) throw new LeetCodeError('NOT_FOUND', 'Problem not found or unavailable for this account.');
    return { ...data.question, url: `${ORIGIN}/problems/${titleSlug}/` };
  }

  async daily() {
    const data = await this.graphql(`query PluginDaily {
      activeDailyCodingChallengeQuestion { date link question { questionFrontendId title titleSlug difficulty } }
    }`);
    return data.activeDailyCodingChallengeQuestion;
  }

  async solved({ offset = 0, limit = 50, difficulty } = {}) {
    const { credentials, username } = await this.authenticated();
    const data = await this.graphql(`query PluginSolved($skip: Int, $limit: Int, $filters: QuestionListFilterInput) {
      questionList(categorySlug: "", skip: $skip, limit: $limit, filters: $filters) {
        totalNum data { questionFrontendId title titleSlug difficulty status topicTags { name slug } }
      }
    }`, { skip: offset, limit, filters: { status: 'AC', ...(difficulty ? { difficulty } : {}) } }, credentials);
    const page = data.questionList;
    if (!Array.isArray(page?.data) || !Number.isInteger(page.totalNum)) throw new LeetCodeError('INVALID_RESPONSE', 'Unrecognized solved-problem response.');
    const next = offset + page.data.length;
    return { username, total: page.totalNum, problems: page.data, offset,
      nextOffset: page.data.length && next < page.totalNum ? next : null };
  }

  async submissions({ offset = 0, limit = 20, titleSlug, lastKey } = {}) {
    const { credentials, username } = await this.authenticated();
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (lastKey) params.set('lastkey', lastKey);
    const data = await this.request(`/api/submissions/${titleSlug ? `${titleSlug}/` : ''}?${params}`, { credentials });
    if (!Array.isArray(data.submissions_dump)) throw new LeetCodeError('INVALID_RESPONSE', 'Unrecognized submission-history response.');
    return { username, submissions: data.submissions_dump, offset,
      nextOffset: data.has_next && data.submissions_dump.length ? offset + data.submissions_dump.length : null,
      lastKey: data.last_key ?? null };
  }

  async submission(submissionId) {
    const { credentials, username } = await this.authenticated();
    const data = await this.graphql(`query PluginSubmission($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) { id code runtime memory statusCode
        lang { name verboseName } question { title titleSlug } }
    }`, { submissionId }, credentials);
    if (!data.submissionDetails) throw new LeetCodeError('NOT_FOUND', 'Submission not found or not accessible to your account.');
    return { username, ...data.submissionDetails };
  }

  async execute({ titleSlug, lang, code, dataInput }, submit = false) {
    const { credentials, username } = await this.authenticated(true);
    const problem = await this.problem(titleSlug, credentials);
    if (!problem.codeSnippets?.some(snippet => snippet.langSlug === lang)) throw new LeetCodeError('LANGUAGE_UNAVAILABLE', 'This problem does not list that language. Use get_problem to inspect its language templates.');
    if (!/^\d+$/.test(problem.questionId)) throw new LeetCodeError('INVALID_RESPONSE', 'The problem has no valid judge ID.');
    const payload = { lang, question_id: problem.questionId, typed_code: code };
    if (!submit) payload.data_input = dataInput ?? problem.exampleTestcases ?? problem.sampleTestCase ?? '';
    const data = await this.request(`/problems/${titleSlug}/${submit ? 'submit' : 'interpret_solution'}/`,
      { method: 'POST', credentials, body: payload, mutation: true, referer: `/problems/${titleSlug}/` });
    const id = submit ? data.submission_id : data.interpret_id;
    if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(String(id))) throw new LeetCodeError('WRITE_OUTCOME_UNKNOWN', 'LeetCode did not return a judge ID. Check history before retrying.');
    return { username, titleSlug, lang, kind: submit ? 'submission' : 'test_run', judgeId: String(id), state: 'PENDING',
      ...(submit ? { url: `${ORIGIN}/submissions/detail/${id}/` } : {}),
      nextStep: 'Use check_result with judgeId. Do not repeat the write to poll its result.' };
  }

  async checkResult(judgeId) {
    const { credentials, username } = await this.authenticated();
    const result = await this.request(`/submissions/detail/${judgeId}/check/`, { credentials });
    return { username, judgeId, ...result };
  }
}
