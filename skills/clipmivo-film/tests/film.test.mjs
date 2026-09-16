import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Api, apiOrigin } from '../scripts/api.mjs';
import { imageCandidates } from '../scripts/images.mjs';
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
test('downloads preserve existing outputs and crash leftovers, and reject empty files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clipmivo-film-download-'));
  try {
    const api = new Api('https://clipmivoai.com');
    const output = join(dir, 'clip.mp4');
    api.request = async () => new Response('new video bytes');
    await writeFile(output, 'previous successful clip');
    await writeFile(`${output}.part`, 'previous interrupted download');
    await assert.rejects(api.download('task_fixture', output), {
      code: 'EEXIST',
    });
    assert.equal(await readFile(output, 'utf8'), 'previous successful clip');
    assert.equal(
      await readFile(`${output}.part`, 'utf8'),
      'previous interrupted download',
    );
    const fresh = join(dir, 'fresh.mp4');
    await api.download('task_fixture', fresh);
    assert.equal(await readFile(fresh, 'utf8'), 'new video bytes');
    api.request = async () => new Response('');
    await assert.rejects(
      api.download('task_fixture', join(dir, 'empty.mp4')),
      /empty_download/,
    );
    assert.deepEqual((await readdir(dir)).sort(), [
      'clip.mp4',
      'clip.mp4.part',
      'fresh.mp4',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    let clock = 0;
    const api = new Api(`http://127.0.0.1:${server.address().port}`, { now: () => clock, sleep: async (ms) => { clock += ms; } }),
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

test('request pacing separates scopes and serializes simultaneous admissions', async () => {
  let clock = 0;
  const api = new Api('https://clipmivoai.com', { now: () => clock, sleep: async (ms) => { clock += ms; } });
  const admitted = [];
  await Promise.all(Array.from({ length: 11 }, async () => {
    await api.pace('video:write', true);
    admitted.push(clock);
  }));
  assert.equal(clock, 61000);
  assert.equal(admitted.length, 11);
  await api.pace('image:write', true);
  assert.equal(clock, 61000);
  await api.pace('video:read', false);
  await api.pace('video:read', false);
  assert.equal(clock, 62100);
});

test('unfinished tasks cap submissions at three and completion releases slots', async () => {
  const api = fixture(), base = api.json.bind(api), m = manifest();
  m.shots = Array.from({ length: 5 }, (_, i) => ({ ...m.shots[0], id: `s${i}` }));
  let done = false;
  api.json = async (...args) => args[0].startsWith('videos/generations/task_')
    ? { status: done ? 'succeeded' : 'running' } : base(...args);
  const state = await plan(m, null, api);
  await run(state, api, async () => {}, { submit: true });
  assert.equal(api.submissions.length, 3);
  await run(state, api, async () => {}, { submit: true });
  assert.equal(api.submissions.length, 3);
  done = true;
  await run(state, api, async () => {}, { submit: true });
  assert.equal(api.submissions.length, 5);
});

test('explicit concurrency rejection pauses without reserving an unaccepted task', async () => {
  const api = fixture(), base = api.json.bind(api);
  let busy = true;
  api.json = async (...args) => {
    if (args[0] === 'videos/generations' && busy)
      throw Object.assign(new Error('too_many_concurrent_jobs'), { status: 429 });
    return base(...args);
  };
  const state = await plan(manifest(), null, api);
  const key = state.shots[0].job_key;
  await run(state, api, async () => {}, { submit: true });
  assert.equal(state.jobs[key].submitted, false);
  assert.equal(state.budget.committed, 0);
  assert.equal(state.paused_reason, 'too_many_concurrent_jobs');
  busy = false;
  await run(state, api, async () => {}, { submit: true });
  assert.equal(api.submissions[0].key, state.jobs[key].idempotency_key);
  assert.equal(state.paused_reason, undefined);
});

test('rate rejection during uncertain recovery never releases its reservation', async () => {
  const api = fixture(), base = api.json.bind(api);
  const state = await plan(manifest(), null, api);
  const job = state.jobs[state.shots[0].job_key];
  job.submitted = true;
  job.status = 'submitting';
  api.json = async (...args) => {
    if (args[0] === 'videos/generations')
      throw Object.assign(new Error('rate_limit_exceeded'), { status: 429 });
    return base(...args);
  };
  await assert.rejects(run(state, api, async () => {}, { submit: true, recoverUncertain: true }), /rate_limit/);
  assert.equal(job.submitted, true);
  assert.equal(job.status, 'submitting');
});

function imageFixture() {
  const api = fixture(), base = api.json.bind(api), images = new Map();
  api.imageSubmissions = [];
  api.json = async (path, method, body, key) => {
    if (path === 'images/models') return { enabled: true, models: [{ id: 'fixture-image', available: true,
      maxPrompt: 4000, maxReferences: 0, profiles: [{ ratio: '1:1', resolution: '1K', quality: 'standard', reference: false }] }] };
    if (path === 'images/quote') {
      assert.equal(body.model, 'fixture-image');
      assert.deepEqual(body.asset_ids, []);
      return { credits: 4, estimated: false };
    }
    if (path === 'images/jobs') {
      assert.equal(body.quoted_credits, 4);
      assert.equal(body.settings.prompt, 'Owned fictional character portrait');
      api.imageSubmissions.push({ body: structuredClone(body), key });
      const id = `img_${key.slice(-12)}`;
      images.set(id, { id, status: 'succeeded', asset_id: `asset_${key.slice(-12)}` });
      return { id, status: 'queued' };
    }
    if (path.startsWith('images/jobs/')) return images.get(path.split('/').at(-1));
    if (path === 'models') return { models: [model('cheap', { mode: 'reference-to-video', capabilities: { max_images: 1 } })] };
    return base(path, method, body, key);
  };
  return api;
}
function imageManifest() {
  const m = manifest();
  m.characters = [{ id: 'hero', image: { prompt: 'Owned fictional character portrait', ratio: '1:1', resolution: '1K', quality: 'standard' } }];
  for (const s of m.shots) { s.mode = 'reference-to-video'; s.character_ids = ['hero']; }
  return m;
}
test('generated character reference flows into video quotes with one cumulative budget', async () => {
  const api = imageFixture(), m = imageManifest();
  let state = await plan(m, null, api);
  assert.equal(state.stage, 'references');
  assert.equal(state.budget.planned, 4);
  assert.equal(api.imageSubmissions.length, 0);
  await run(state, api, async () => {});
  assert.equal(api.imageSubmissions.length, 0);
  await run(state, api, async () => {}, { submit: true });
  assert.equal(state.references_ready, true);
  assert.equal(api.submissions.length, 0);
  state = await plan(m, state, api);
  assert.equal(state.stage, 'videos');
  assert.deepEqual(state.budget, { maximum: 20, committed: 4, planned: 6 });
  const ref = state.jobs[state.shots[0].job_key].request.image_urls[0];
  assert.match(ref, /^http:\/\/127.0.0.1:1234\/api\/open\/v1\/assets\/asset_[\w-]+\/file$/);
  await run(state, api, async () => {}, { submit: true });
  assert.equal(api.submissions.length, 2);
  assert.equal(api.imageSubmissions.length, 1);
  assert.deepEqual(state.budget, { maximum: 20, committed: 10, planned: 0 });
  m.shots[1].revision = 2;
  state = await plan(m, state, api);
  assert.deepEqual(state.budget, { maximum: 20, committed: 10, planned: 3 });
  assert.equal(api.imageSubmissions.length, 1);
});
test('image cost prevents a video plan exceeding shared budget', async () => {
  const api = imageFixture(), m = imageManifest();
  m.budget_credits = 9;
  const state = await plan(m, null, api);
  await run(state, api, async () => {}, { submit: true });
  await assert.rejects(plan(m, state, api), /Budget exceeded/);
  assert.equal(state.stage, 'references');
  assert.equal(api.submissions.length, 0);
});
test('lost image acknowledgement reuses original request and key', async () => {
  const api = imageFixture(), base = api.json.bind(api);
  let lost = true;
  api.json = async (...args) => {
    const result = await base(...args);
    if (args[0] === 'images/jobs' && lost) { lost = false; throw new Error('network_response_uncertain'); }
    return result;
  };
  const state = await plan(imageManifest(), null, api);
  await assert.rejects(run(state, api, async () => {}, { submit: true }), /uncertain/);
  await assert.rejects(run(state, api, async () => {}, { submit: true }), /Uncertain image/);
  await run(state, api, async () => {}, { submit: true, recoverUncertain: true });
  assert.deepEqual(api.imageSubmissions[0], api.imageSubmissions[1]);
  assert.equal(state.budget.committed, 4);
});
test('image capability selection excludes unsupported reference profiles and preserves preferences', () => {
  const image = imageManifest().characters[0].image;
  const model = { id: 'x', available: true, maxPrompt: 4000, maxReferences: 1,
    profiles: [{ ratio: '1:1', resolution: '1K', quality: 'standard', reference: false }] };
  assert.equal(imageCandidates(image, [model]).length, 1);
  assert.equal(imageCandidates({ ...image, asset_ids: ['asset_existing'] }, [model]).length, 0);
  assert.equal(imageCandidates({ ...image, model: 'other' }, [model]).length, 0);
});

test('explicit video revision can replace a failed task while preserving its cost', async () => {
  const api = fixture(), base = api.json.bind(api), m = manifest();
  m.shots = [m.shots[0]];
  let fail = true;
  api.json = async (...args) => args[0].startsWith('videos/generations/task_') && fail ? { status: 'failed' } : base(...args);
  let state = await plan(m, null, api);
  await assert.rejects(run(state, api, async () => {}, { submit: true }), /failed/);
  await assert.rejects(run(state, api, async () => {}, { submit: true }), /failed/);
  assert.equal(api.submissions.length, 1);
  fail = false;
  m.shots[0].revision = 2;
  state = await plan(m, state, api);
  await run(state, api, async () => {}, { submit: true });
  assert.equal(api.submissions.length, 2);
  assert.equal(state.budget.committed, 6);
});

test('explicit image revision replaces failed reference without erasing its cost', async () => {
  const api = imageFixture(), base = api.json.bind(api), m = imageManifest();
  let fail = true;
  api.json = async (...args) => args[0].startsWith('images/jobs/') && fail ? { status: 'failed' } : base(...args);
  let state = await plan(m, null, api);
  await assert.rejects(run(state, api, async () => {}, { submit: true }), /failed/);
  await assert.rejects(run(state, api, async () => {}, { submit: true }), /failed/);
  assert.equal(api.imageSubmissions.length, 1);
  fail = false;
  m.characters[0].image.revision = 2;
  state = await plan(m, state, api);
  await run(state, api, async () => {}, { submit: true });
  assert.equal(api.imageSubmissions.length, 2);
  assert.equal(state.budget.committed, 8);
  state = await plan(m, state, api);
  assert.deepEqual(state.budget, { maximum: 20, committed: 8, planned: 6 });
});
