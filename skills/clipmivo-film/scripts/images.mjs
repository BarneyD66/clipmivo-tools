import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };

export function projectBudget(state) {
  const jobs = { ...state.jobs, ...state.image_jobs };
  const committed = Object.values(jobs).filter((j) => j.submitted).reduce((sum, j) => sum + j.credits, 0);
  const keys = new Set([...(state.shots || []), ...(state.images || [])].map((item) => item.job_key));
  const planned = [...keys].filter((key) => !jobs[key].submitted).reduce((sum, key) => sum + jobs[key].credits, 0);
  const maximum = state.manifest.budget_credits;
  check(committed + planned <= maximum, `Budget exceeded: ${committed} committed + ${planned} planned > ${maximum}`);
  return { maximum, committed, planned };
}

export function imageCandidates(image, models) {
  check(image && typeof image.prompt === 'string' && image.prompt.trim(), 'Image prompt required');
  const assets = image.asset_ids || [];
  check(Array.isArray(assets) && new Set(assets).size === assets.length && assets.every((id) => /^asset_[\w-]+$/.test(id)), 'Invalid image reference asset IDs');
  return models.filter((m) => m.available !== false && (!image.model || image.model === m.id)
    && image.prompt.length <= m.maxPrompt && assets.length <= m.maxReferences
    && (!m.requiresReference || assets.length)
    && m.profiles?.some((p) => p.ratio === image.ratio && p.resolution === image.resolution
      && p.quality === image.quality && p.reference === (assets.length > 0)))
    .map((m) => ({ model: m.id, prompt: image.prompt.trim(), ratio: image.ratio,
      resolution: image.resolution, quality: image.quality, asset_ids: assets }));
}

export async function planImages(manifest, state, api) {
  state.image_jobs ||= {};
  const resolved = structuredClone(manifest);
  const needed = new Set(manifest.shots.flatMap((s) => s.character_ids || []));
  const generated = (manifest.characters || []).filter((c) => needed.has(c.id) && c.image);
  const oldImages = state.images || [];
  state.images = [];
  let catalog;
  for (const character of generated) {
    check(!character.asset_url, `Character ${character.id}: choose existing asset_url or image generation`);
    const signature = hash(character.image);
    let entry = oldImages.find((e) => e.id === character.id && e.signature === signature);
    if (!entry || !state.image_jobs[entry.job_key]?.submitted) {
      catalog ||= await api.json('images/models');
      check(catalog.enabled && Array.isArray(catalog.models), 'Image generation unavailable');
      const quoted = [];
      for (const settings of imageCandidates(character.image, catalog.models)) {
        try {
          const q = await api.json('images/quote', 'POST', settings);
          check(Number.isSafeInteger(q.credits) && q.credits > 0, 'Invalid image quote');
          quoted.push({ settings, credits: q.credits, estimated: q.estimated === true });
        } catch (error) {
          if (![400, 409, 422, 503].includes(error.status)) throw error;
        }
      }
      check(quoted.length, `No quotable image model for character ${character.id}`);
      const order = character.image.preferred_models || [];
      const rank = (q) => order.includes(q.settings.model) ? order.indexOf(q.settings.model) : Infinity;
      quoted.sort((a, b) => (order.length ? rank(a) - rank(b) : 0) || a.credits - b.credits || a.settings.model.localeCompare(b.settings.model));
      const selected = quoted[0];
      const request = { settings: selected.settings, quoted_credits: selected.credits };
      const key = hash({ instance: state.instance, character: character.id, signature, request });
      state.image_jobs[key] ||= { request, credits: selected.credits, estimated: selected.estimated,
        idempotency_key: `film-image-${key}`, submitted: false, status: 'planned' };
      entry = { id: character.id, signature, job_key: key };
    }
    state.images.push(entry);
    const job = state.image_jobs[entry.job_key];
    if (job.status === 'succeeded') {
      check(/^asset_[\w-]+$/.test(job.asset_id || ''), 'Successful image is missing an owned asset ID');
      resolved.characters.find((c) => c.id === character.id).asset_url = `${api.origin}/api/open/v1/assets/${job.asset_id}/file`;
    }
  }
  return { manifest: resolved, ready: state.images.every((e) => state.image_jobs[e.job_key].status === 'succeeded') };
}

export async function runImages(state, api, persist, { submit = false, recoverUncertain = false } = {}) {
  check(state.origin === api.origin, 'Project origin mismatch');
  const checkpoint = async () => { state.budget = projectBudget(state); await persist(state); };
  const poll = async (job) => {
    const result = await api.json(`images/jobs/${encodeURIComponent(job.task_id)}`);
    check(typeof result.status === 'string', 'Invalid image task status');
    job.status = result.status;
    if (result.status === 'succeeded') {
      check(/^asset_[\w-]+$/.test(result.asset_id || ''), 'Successful image missing asset ID');
      job.asset_id = result.asset_id;
    }
    await checkpoint();
    check(!['failed', 'needs_review', 'cancelled', 'expired'].includes(job.status), `Image ${job.task_id}: ${job.status}. No automatic paid regeneration.`);
  };
  projectBudget(state);
  for (const job of Object.values(state.image_jobs)) {
    if (job.task_id && job.status !== 'succeeded') await poll(job);
  }
  for (const entry of state.images) {
    const job = state.image_jobs[entry.job_key];
    if (job.task_id || !submit) continue;
    check(!job.submitted || recoverUncertain, 'Uncertain image submission: use --submit --recover-uncertain');
    if (!job.submitted && Object.values(state.image_jobs).filter((j) => j.submitted && j.status !== 'succeeded').length >= 2) continue;
    const wasSubmitted = job.submitted;
    job.submitted = true;
    job.status = 'submitting';
    await checkpoint();
    let result;
    try {
      result = await api.json('images/jobs', 'POST', job.request, job.idempotency_key);
    } catch (error) {
      if (!wasSubmitted && ((error.status === 409 && error.message === 'image_admission_unavailable') || (error.status === 429 && error.message === 'rate_limit_exceeded'))) {
        job.submitted = false;
        job.status = 'planned';
        state.paused_reason = error.message;
        await checkpoint();
        return state;
      }
      throw error;
    }
    check(typeof result.id === 'string' && /^[\w-]{1,200}$/.test(result.id), 'Invalid image task ID; submission remains uncertain');
    job.task_id = result.id;
    job.status = 'queued';
    await checkpoint();
    await poll(job);
  }
  state.references_ready = state.images.every((e) => state.image_jobs[e.job_key].status === 'succeeded');
  await checkpoint();
  return state;
}
