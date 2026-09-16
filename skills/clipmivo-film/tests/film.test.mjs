import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Api, apiOrigin } from '../scripts/api.mjs';
import {
  validateManifest,
  candidates,
  plan,
  run,
  collect,
} from '../scripts/film.mjs';

const model = (id, extra = {}) => ({
  id,
  mode: 'text-to-video',
  qualities: ['720p'],
  durations: [4, 8],
  durations_by_quality: { '720p': [4] },
  aspect_ratios: ['16:9'],
  capabilities: { max_images: 0, generate_audio: true },
  ...extra,
});
const manifest = () => ({
  version: 1,
  id: 'test',
  quality: '720p',
  aspect_ratio: '16:9',
  budget_credits: 20,
  preference: 'economy',
  shots: [
    {
      id: 'a',
      prompt: 'A boat in morning sunlight',
      duration: 4,
      mode: 'text-to-video',
    },
    {
      id: 'b',
      prompt: 'A boat arriving at shore',
      duration: 4,
      mode: 'text-to-video',
    },
  ],
});
function fixture() {
  const submissions = [],
    polls = [];
  return {
    origin: 'http://127.0.0.1:1234',
    submissions,
    polls,
    async json(path, method, body, key) {
      if (path === 'models')
        return {
          models: [model('expensive'), model('cheap'), model('disabled')],
        };
      if (path.endsWith('/quote')) {
        if (body.model === 'disabled')
          throw Object.assign(new Error('price_unavailable'), { status: 503 });
        return { credits_to_hold: body.model === 'cheap' ? 3 : 8 };
      }
      if (path === 'videos/generations') {
        submissions.push({ body: structuredClone(body), key });
        return { id: `task_${key.slice(-8)}`, status: 'queued' };
      }
      polls.push(path);
      return { status: 'succeeded' };
    },
  };
}
test('plans live compatible lowest quotes without generation', async () => {
  const api = fixture(),
    s = await plan(manifest(), null, api);
  assert.equal(api.submissions.length, 0);
  assert.equal(s.budget.planned, 6);
  assert.equal(s.jobs[s.shots[0].job_key].request.model, 'cheap');
  assert.equal(s.quote_problems.length, 2);
});
test('quality-specific duration and reference constraints are enforced', () => {
  const m = manifest();
  m.shots[0].duration = 8;
  assert.deepEqual(
    candidates(m, m.shots[0], [model('x')], 'https://clipmivoai.com'),
    [],
  );
  m.shots[0].character_ids = ['hero'];
  assert.throws(
    () => candidates(m, m.shots[0], [model('x')], 'https://clipmivoai.com'),
    /needs an owned reference/,
  );
});
test('budget blocks the whole plan before any paid request', async () => {
  const api = fixture(),
    m = manifest();
  m.budget_credits = 5;
  await assert.rejects(plan(m, null, api), /Budget exceeded/);
  assert.equal(api.submissions.length, 0);
});
test('quality uses supplied ranking and never invented quality scores', async () => {
  const m = manifest();
  m.preference = 'quality';
  m.preferred_models = ['expensive'];
  const s = await plan(m, null, fixture());
  assert.equal(s.budget.planned, 16);
});
test('status does not submit; repeated run reuses accepted tasks', async () => {
  const api = fixture(),
    s = await plan(manifest(), null, api);
  const persist = async () => {};
  await run(s, api, persist);
  assert.equal(api.submissions.length, 0);
  await run(s, api, persist, { submit: true });
  assert.equal(api.submissions.length, 2);
  assert.deepEqual(s.budget, { maximum: 20, committed: 6, planned: 0 });
  await run(s, api, persist, { submit: true });
  assert.equal(api.submissions.length, 2);
});
test('lost acknowledgement keeps exact payload/key and requires explicit recovery', async () => {
  const api = fixture(),
    base = api.json.bind(api);
  let lost = true;
  const snapshots = [];
  api.json = async (...args) => {
    const result = await base(...args);
    if (args[0] === 'videos/generations' && lost) {
      lost = false;
      throw new Error('network_response_uncertain');
    }
    return result;
  };
  const s = await plan(manifest(), null, api),
    persist = async (x) => snapshots.push(structuredClone(x));
  await assert.rejects(run(s, api, persist, { submit: true }), /uncertain/);
  assert.equal(
    Object.values(snapshots[0].jobs).filter((j) => j.submitted).length,
    1,
  );
  await assert.rejects(
    run(s, api, persist, { submit: true }),
    /Uncertain submission/,
  );
  assert.equal(api.submissions.length, 1);
  await run(s, api, persist, { submit: true, recoverUncertain: true });
  assert.deepEqual(api.submissions[0], api.submissions[1]);
});
test('single-shot revision reuses other shots and keeps old costs', async () => {
  const api = fixture(),
    m = manifest();
  let s = await plan(m, null, api);
  await run(s, api, async () => {}, { submit: true });
  const old = s.shots[0].job_key;
  m.shots[1].prompt = 'Changed shot';
  m.shots[1].revision = 2;
  s = await plan(m, s, api);
  assert.equal(s.shots[0].job_key, old);
  assert.deepEqual(s.budget, { maximum: 20, committed: 6, planned: 3 });
  await run(s, api, async () => {}, { submit: true });
  assert.equal(api.submissions.length, 3);
});
test('failed/review tasks stop later spending', async () => {
  const api = fixture(),
    base = api.json.bind(api);
  api.json = async (...args) =>
    args[0].startsWith('videos/generations/task_')
      ? { status: 'needs_review' }
      : base(...args);
  const s = await plan(manifest(), null, api);
  await assert.rejects(
    run(s, api, async () => {}, { submit: true }),
    /needs_review/,
  );
  assert.equal(api.submissions.length, 1);
});
test('runtime and origin mismatches are rejected', async () => {
  const m = manifest();
  m.target_seconds = 300;
  assert.throws(() => validateManifest(m), /8s/);
  for (const url of [
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/path',
  ])
    assert.throws(() => apiOrigin(url));
  const s = await plan(manifest(), null, fixture());
  await assert.rejects(
    plan(manifest(), s, { ...fixture(), origin: 'https://example.com' }),
    /pinned/,
  );
});
test('HTTP adapter sends scoped auth, preserves idempotency and downloads bytes', async () => {
  const observed = [],
    apiFixture = fixture();
  let redirect = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    observed.push({
      auth: req.headers.authorization,
      key: req.headers['idempotency-key'],
      path: req.url,
    });
    if (redirect) {
      res.writeHead(302, { Location: 'http://127.0.0.1:1/' });
      res.end();
      return;
    }
    if (req.url.endsWith('/download')) {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(Buffer.from('FIXTURE VIDEO BYTES'));
      return;
    }
    try {
      assert.ok(req.url.startsWith('/api/open/v1/'));
      const result = await apiFixture.json(
        req.url.slice('/api/open/v1/'.length),
        req.method,
        body ? JSON.parse(body) : undefined,
        req.headers['idempotency-key'],
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (error) {
      res.writeHead(error.status || 500, {
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({ success: false, error: { code: error.message } }),
      );
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const old = process.env.CLIPMIVO_API_KEY;
  process.env.CLIPMIVO_API_KEY = 'fixture-not-a-real-key';
  const dir = await mkdtemp(join(tmpdir(), 'clipmivo-film-'));
  try {
    const api = new Api(`http://127.0.0.1:${server.address().port}`),
      s = await plan(manifest(), null, api);
    await run(s, api, async () => {}, { submit: true });
    const timeline = await collect(s, dir, api, async () => {});
    assert.equal(
      await readFile(timeline.clips[0].file, 'utf8'),
      'FIXTURE VIDEO BYTES',
    );
    assert.ok(
      observed.every((r) => r.auth === 'Bearer fixture-not-a-real-key'),
    );
    assert.ok(observed.some((r) => r.key?.startsWith('film-')));
    assert.ok(!JSON.stringify(s).includes('fixture-not-a-real-key'));
    redirect = true;
    await assert.rejects(api.json('models'), /redirect_rejected/);
  } finally {
    if (old === undefined) delete process.env.CLIPMIVO_API_KEY;
    else process.env.CLIPMIVO_API_KEY = old;
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(dir, { recursive: true, force: true });
  }
});
