#!/usr/bin/env node
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  open,
  unlink,
  stat,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Api, apiOrigin } from './api.mjs';
import { planImages, runImages, projectBudget } from './images.mjs';

const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = async (path) =>
  JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const exists = async (path) => !!(await stat(path).catch(() => null));
async function save(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  await rename(temp, path);
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}
export function validateManifest(m) {
  check(
    m.version === 1 && /^[a-zA-Z0-9_-]{1,60}$/.test(m.id || ''),
    'Invalid manifest version/id',
  );
  check(
    ['16:9', '9:16'].includes(m.aspect_ratio),
    'First release supports 16:9 and 9:16 editing',
  );
  check(
    typeof m.quality === 'string' && m.quality.length > 0,
    'quality is required',
  );
  check(
    Number.isSafeInteger(m.budget_credits) && m.budget_credits > 0,
    'Positive integer budget_credits required',
  );
  check(
    ['economy', 'balanced', 'quality'].includes(m.preference || 'economy'),
    'Invalid preference',
  );
  check(
    Array.isArray(m.shots) && m.shots.length > 0 && m.shots.length <= 120,
    'Use 1–120 shots',
  );
  const ids = new Set();
  check(m.characters === undefined || Array.isArray(m.characters), 'characters must be an array');
  const characterIds = new Set();
  for (const c of m.characters || []) {
    check(/^[a-zA-Z0-9_-]{1,60}$/.test(c.id || '') && !characterIds.has(c.id), 'Invalid or duplicate character id');
    characterIds.add(c.id);
  }
  for (const s of m.shots) {
    check(
      /^[a-zA-Z0-9_-]{1,60}$/.test(s.id || '') && !ids.has(s.id),
      'Invalid or duplicate shot id',
    );
    ids.add(s.id);
    check(
      typeof s.prompt === 'string' && s.prompt.trim(),
      `Missing prompt: ${s.id}`,
    );
    check(
      Number.isInteger(s.duration) && s.duration >= 1 && s.duration <= 60,
      `Invalid duration: ${s.id}`,
    );
    check(
      ['text-to-video', 'image-to-video', 'reference-to-video'].includes(
        s.mode,
      ),
      `Invalid mode: ${s.id}`,
    );
    check(
      s.generate_audio === undefined || typeof s.generate_audio === 'boolean',
      'generate_audio must be boolean',
    );
    check(
      s.caption === undefined ||
        (typeof s.caption === 'string' && !s.caption.includes('#')),
      'Captions must be plain text without MLT # expressions',
    );
    check(
      s.image_urls === undefined ||
        (Array.isArray(s.image_urls) &&
          s.image_urls.every((x) => typeof x === 'string')),
      'image_urls must be strings',
    );
    check(
      s.character_ids === undefined || Array.isArray(s.character_ids),
      'character_ids must be an array',
    );
    check((s.character_ids || []).every((id) => characterIds.has(id)), `Unknown character in shot ${s.id}`);
    check(s.mode !== 'text-to-video' || !(s.character_ids?.length || s.image_urls?.length), 'Text workflow cannot silently ignore references');
  }
  const seconds = m.shots.reduce((n, s) => n + s.duration, 0);
  check(
    !m.target_seconds || m.target_seconds === seconds,
    `Shot durations total ${seconds}s, not target_seconds`,
  );
  return m;
}
function references(m, shot, origin) {
  const refs = [...(shot.image_urls || [])];
  for (const id of shot.character_ids || []) {
    const c = (m.characters || []).find((x) => x.id === id);
    check(
      c?.asset_url,
      `Character ${id} needs an owned reference image. Add asset_url or an image generation specification.`,
    );
    refs.push(c.asset_url);
  }
  for (const ref of refs) {
    const url = new URL(ref, origin);
    check(
      url.origin === origin &&
        !url.search &&
        !url.hash &&
        /^\/api\/(v1|open\/v1|studio)\/assets\/asset_[\w-]+\/file$/.test(
          url.pathname,
        ),
      'Upload references to ClipmivoAI first; use owned asset URLs',
    );
  }
  check(
    shot.mode !== 'text-to-video' || refs.length === 0,
    'Text workflow cannot silently ignore references',
  );
  check(
    shot.mode === 'text-to-video' || refs.length > 0,
    'Image/reference workflow needs reference images',
  );
  return [...new Set(refs)];
}
export function candidates(m, shot, models, origin) {
  const refs = references(m, shot, origin);
  return models
    .filter((model) => {
      const lengths =
        model.durations_by_quality?.[m.quality] || model.durations;
      return (
        model.available !== false &&
        model.mode === shot.mode &&
        (!shot.model || model.id === shot.model) &&
        model.qualities?.includes(m.quality) &&
        lengths?.includes(shot.duration) &&
        model.aspect_ratios?.includes(m.aspect_ratio) &&
        refs.length <= (model.capabilities?.max_images || 0) &&
        (shot.generate_audio === undefined ||
          model.capabilities?.generate_audio === true) &&
        shot.prompt.length >= (model.prompt_min_length || 0) &&
        shot.prompt.length <= (model.prompt_max_length || Infinity)
      );
    })
    .map((model) => ({
      model,
      request: {
        model: model.id,
        prompt: shot.prompt,
        duration: shot.duration,
        quality: m.quality,
        aspect_ratio: m.aspect_ratio,
        ...(refs.length ? { image_urls: refs } : {}),
        ...(shot.generate_audio !== undefined
          ? { generate_audio: shot.generate_audio }
          : {}),
      },
    }));
}
export async function plan(manifest, state, api) {
  validateManifest(manifest);
  const originalManifest = structuredClone(manifest);
  check(
    !state || state.origin === api.origin,
    'Project origin is pinned; create a separate project for another deployment',
  );
  check(!state || state.id === manifest.id, 'Project id cannot change');
  state ||= {
    version: 1,
    id: manifest.id,
    instance: randomUUID(),
    origin: api.origin,
    jobs: {},
    shots: [],
  };
  // Plan on a copy so a failed quote or budget validation cannot mutate callers.
  state = structuredClone(state);
  state.manifest = originalManifest;
  const imagePlan = await planImages(manifest, state, api);
  manifest = imagePlan.manifest;
  if (!imagePlan.ready) {
    state.shots = [];
    state.stage = 'references';
    state.references_ready = false;
    state.budget = projectBudget(state);
    return state;
  }
  const discovery = await api.json('models');
  const models = Array.isArray(discovery) ? discovery : discovery?.models;
  check(Array.isArray(models), 'Invalid model catalog');
  const next = [],
    problems = [];
  for (const shot of manifest.shots) {
    const signature = hash({
      shot,
      quality: manifest.quality,
      aspect_ratio: manifest.aspect_ratio,
      characters: manifest.characters || [],
    });
    const previous = state.shots.find(
      (s) => s.id === shot.id && s.signature === signature,
    );
    if (previous && state.jobs[previous.job_key]?.submitted) {
      next.push(previous);
      continue;
    }
    const options = candidates(manifest, shot, models, api.origin),
      quoted = [];
    for (const option of options) {
      try {
        const quote = await api.json(
          'videos/generations/quote',
          'POST',
          option.request,
        );
        check(
          Number.isSafeInteger(quote?.credits_to_hold) &&
            quote.credits_to_hold > 0,
          'Invalid quote',
        );
        quoted.push({ ...option, credits: quote.credits_to_hold });
      } catch (error) {
        if (![400, 409, 422, 503].includes(error.status)) throw error;
        problems.push({
          shot: shot.id,
          model: option.model.id,
          error: error.message,
        });
      }
    }
    check(
      quoted.length,
      `No quotable model for shot ${shot.id}; check references, settings and API availability`,
    );
    // Quality rankings require user-provided evidence/preferences; never invent benchmark scores.
    const order = manifest.preferred_models || [];
    quoted.sort((a, b) => {
      const rank = (x) => {
        const i = order.indexOf(x.model.id);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      return (
        (manifest.preference !== 'economy' && order.length
          ? rank(a) - rank(b)
          : 0) ||
        a.credits - b.credits ||
        a.model.id.localeCompare(b.model.id)
      );
    });
    const selected = quoted[0],
      request = { ...selected.request, quoted_credits: selected.credits };
    const job_key = hash({
      instance: state.instance,
      shot: shot.id,
      revision: shot.revision || 1,
      request,
    });
    state.jobs[job_key] ||= {
      request,
      credits: selected.credits,
      idempotency_key: `film-${job_key}`,
      submitted: false,
      status: 'planned',
    };
    next.push({
      id: shot.id,
      signature,
      job_key,
      duration: shot.duration,
      caption: shot.caption || '',
      reason:
        manifest.preference !== 'economy' && order.length
          ? 'User model preference, then live quote'
          : 'Compatible capabilities, then lowest available quote',
      alternatives: quoted.map((q) => ({
        model: q.model.id,
        credits: q.credits,
      })),
    });
  }
  const committed = [...Object.values(state.jobs), ...Object.values(state.image_jobs || {})]
    .filter((j) => j.submitted)
    .reduce((n, j) => n + j.credits, 0);
  const newCredits = next
    .filter((s) => !state.jobs[s.job_key].submitted)
    .reduce((n, s) => n + state.jobs[s.job_key].credits, 0);
  check(
    committed + newCredits <= manifest.budget_credits,
    `Budget exceeded: ${committed} committed + ${newCredits} planned > ${manifest.budget_credits}. Failed/uncertain jobs remain conservatively reserved.`,
  );
  Object.assign(state, {
    manifest: originalManifest,
    stage: 'videos',
    shots: next,
    quote_time: new Date().toISOString(),
    budget: {
      maximum: manifest.budget_credits,
      committed,
      planned: newCredits,
    },
    quote_problems: problems,
  });
  return state;
}
export async function run(
  state,
  api,
  persist,
  { submit = false, recoverUncertain = false } = {},
) {
  check(state.origin === api.origin, 'Project origin mismatch');
  delete state.paused_reason;
  if (state.stage === 'references') return runImages(state, api, persist, { submit, recoverUncertain });
  const committed = [...Object.values(state.jobs), ...Object.values(state.image_jobs || {})]
    .filter((j) => j.submitted)
    .reduce((n, j) => n + j.credits, 0);
  const planned = state.shots
    .filter((s) => !state.jobs[s.job_key].submitted)
    .reduce((n, s) => n + state.jobs[s.job_key].credits, 0);
  check(
    committed + planned <= state.manifest.budget_credits,
    'Budget exceeded',
  );
  const checkpoint = async () => {
    const held = [...Object.values(state.jobs), ...Object.values(state.image_jobs || {})]
      .filter((j) => j.submitted)
      .reduce((n, j) => n + j.credits, 0);
    const pending = state.shots
      .filter((s) => !state.jobs[s.job_key].submitted)
      .reduce((n, s) => n + state.jobs[s.job_key].credits, 0);
    state.budget = {
      maximum: state.manifest.budget_credits,
      committed: held,
      planned: pending,
    };
    await persist(state);
  };
  const successful = (job) => ['succeeded', 'completed'].includes(job.status);
  const failed = (job) => ['failed', 'cancelled', 'canceled', 'expired'].includes(job.status);
  const currentKeys = new Set(state.shots.map((s) => s.job_key));
  const poll = async (job, label, current = true) => {
    const result = await api.json(`videos/generations/${encodeURIComponent(job.task_id)}`);
    check(typeof result?.status === 'string', 'Invalid task status');
    job.status = result.status;
    job.updated = new Date().toISOString();
    await checkpoint();
    if (job.status === 'needs_review' || (current && failed(job)))
      throw new Error(`Shot ${label}: ${job.status}. No automatic paid regeneration.`);
  };
  // Refresh all outstanding historical jobs before admitting more work. A revised
  // shot does not cancel its old remote task or free its concurrency slot.
  for (const [key, job] of Object.entries(state.jobs)) {
    if (currentKeys.has(key) && failed(job)) throw new Error(`Shot ${key}: ${job.status}. No automatic paid regeneration.`);
    if (job.task_id && !successful(job) && !failed(job)) await poll(job, key, currentKeys.has(key));
  }
  for (const shot of state.shots) {
    const job = state.jobs[shot.job_key];
    if (!job.task_id && (!job.submitted || job.status === 'submitting')) {
      if (!submit) continue;
      if (job.submitted && !recoverUncertain)
        throw new Error(
          'Uncertain submission: use --recover-uncertain with --submit to reuse the saved request/key',
        );
      const active = Object.values(state.jobs).filter((j) => j.submitted && !successful(j) && !failed(j)).length;
      if (!job.submitted && active >= 3) continue;
      // Write-ahead record: a crash cannot accidentally create a new billable task.
      const wasSubmitted = job.submitted;
      job.submitted = true;
      job.status = 'submitting';
      await checkpoint();
      let result;
      try { result = await api.json(
        'videos/generations',
        'POST',
        job.request,
        job.idempotency_key,
      ); } catch (error) {
        if (!wasSubmitted && error.status === 429 && ['too_many_concurrent_jobs', 'rate_limit_exceeded'].includes(error.message)) {
          // These explicit server rejections create no task. Keep the exact
          // request/key for the next user-authorized run; never auto-retry here.
          job.submitted = false;
          job.status = 'planned';
          state.paused_reason = error.message;
          await checkpoint();
          return state;
        }
        throw error;
      }
      check(
        typeof result?.id === 'string' && /^[\w-]{1,200}$/.test(result.id),
        'Invalid task id; submission remains uncertain',
      );
      job.task_id = result.id;
      job.status = result.status || 'queued';
      await checkpoint();
    }
    if (job.task_id && !successful(job)) await poll(job, shot.id);
  }
  return state;
}
export async function collect(state, directory, api, persist) {
  check(state.stage !== 'references', 'Reference stage: finish images and run plan again before collecting video');
  const mediaDir = join(directory, 'media');
  await mkdir(mediaDir, { recursive: true });
  const clips = [];
  for (const shot of state.shots) {
    const job = state.jobs[shot.job_key];
    check(
      ['succeeded', 'completed'].includes(job.status),
      `Shot ${shot.id} is not complete; run status again`,
    );
    const path = join(mediaDir, `${shot.job_key}.mp4`);
    if (!(await exists(path))) await api.download(job.task_id, path);
    check((await stat(path)).size > 0, 'Empty downloaded file');
    job.local_file = path;
    await persist(state);
    clips.push({
      id: shot.id,
      file: path,
      duration: shot.duration,
      caption: shot.caption,
    });
  }
  const timeline = {
    version: 1,
    title: state.manifest.title || state.id,
    aspect_ratio: state.manifest.aspect_ratio,
    clips,
    ...(state.manifest.audio ? { audio: state.manifest.audio } : {}),
  };
  await save(join(directory, 'timeline.json'), timeline);
  return timeline;
}
async function main() {
  const { values: v, positionals: p } = parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: 'string' },
      project: { type: 'string' },
      'api-url': { type: 'string' },
      submit: { type: 'boolean' },
      'recover-uncertain': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (v.help || !p.length) {
    console.log(
      'Clipmivo Film (preview)\nplan --manifest FILE --project DIR [--api-url ORIGIN]\nrun --project DIR [--submit] [--recover-uncertain]\ncollect --project DIR\nstatus --project DIR\nPlanning/status do not generate. --submit spends the budget authorized in the manifest.',
    );
    return;
  }
  check(
    p.length === 1 && ['plan', 'run', 'collect', 'status'].includes(p[0]),
    'Unknown command',
  );
  check(v.project, '--project is required');
  const directory = resolve(v.project);
  await mkdir(directory, { recursive: true });
  const stateFile = join(directory, 'project.json'),
    lock = join(directory, '.film.lock');
  let handle;
  try {
    handle = await open(lock, 'wx');
  } catch {
    throw new Error(
      'Project is locked. If its process stopped, inspect and remove .film.lock before resuming.',
    );
  }
  await handle.writeFile(
    JSON.stringify({ pid: process.pid, started: new Date().toISOString() }),
  );
  try {
    let state = (await exists(stateFile)) ? await read(stateFile) : null;
    const api = new Api(v['api-url'] || state?.origin || apiOrigin());
    const persist = (s) => save(stateFile, s);
    if (p[0] === 'plan') {
      check(v.manifest, '--manifest is required');
      state = await plan(await read(resolve(v.manifest)), state, api);
      await persist(state);
    } else {
      check(state, 'Run plan first');
      if (p[0] === 'run')
        state = await run(state, api, persist, {
          submit: !!v.submit,
          recoverUncertain: !!v['recover-uncertain'],
        });
      if (p[0] === 'collect') await collect(state, directory, api, persist);
    }
    console.log(
      JSON.stringify(
        {
          project: stateFile,
          stage: state.stage || 'videos',
          next_step: state.stage === 'references' && state.references_ready ? 'Run plan again with the manifest to quote dependent videos' : undefined,
          paused_reason: state.paused_reason,
          budget: state.budget,
          images: (state.images || []).map((item) => ({ id: item.id, status: state.image_jobs[item.job_key].status, credits: state.image_jobs[item.job_key].credits, asset_id: state.image_jobs[item.job_key].asset_id })),
          shots: state.shots.map((s) => ({
            id: s.id,
            model: state.jobs[s.job_key].request.model,
            credits: state.jobs[s.job_key].credits,
            status: state.jobs[s.job_key].status,
            reason: s.reason,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await handle.close();
    await unlink(lock);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  });
