#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, mkdir, rename, unlink, open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve, basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

const help = `ClipmivoAI CLI
Usage: clipmivo <command> [options]
  models                         List current model/workflow capabilities
  balance                        Read credit balance
  usage [--from UNIX_SECONDS] [--to UNIX_SECONDS] Read account task usage and current-key calls
  upload --file PATH [--duration SECONDS]
  upload-status UPLOAD_ID         Check an upload after a lost response
  assets [--limit N] [--cursor CURSOR]  List owned reference assets
  asset-get ASSET_ID              Read asset details
  asset-download ASSET_ID --output PATH Download original media without overwriting
  asset-delete ASSET_ID           Delete owned asset and queue media cleanup
  quote --file REQUEST.json       Quote a generation without submitting it
  generate --file REQUEST.json --idempotency-key KEY [--wait]
  jobs [--limit N] [--cursor CURSOR] [--status STATUS]
  get TASK_ID                    Read a generation
  wait TASK_ID [--timeout 600]    Wait for completion; no resubmission
  download TASK_ID --output PATH Download without overwriting existing files
  config show                    Show URL and whether a key is configured
  config set-url URL             Save the API origin (never stores your key)
  callbacks                      List registered callback endpoints
  callback-create --url HTTPS_URL Register endpoint; returns secret once
  callback-verify ENDPOINT_ID     Send signed ownership challenge
  callback-disable ENDPOINT_ID    Disable endpoint and cancel pending delivery
  callback-deliveries ENDPOINT_ID Read the latest 100 delivery records
  callback-retry ENDPOINT_ID DELIVERY_ID Retry a failed delivery, same event ID
Options: --api-url URL --json --help --version
Environment: CLIPMIVO_API_KEY, CLIPMIVO_API_URL, CLIPMIVO_CONFIG_DIR
API keys stay in your environment. JSON is written to stdout; errors to stderr.
Exit codes: 0 success, 1 API/network failure, 2 invalid input, 3 wait timeout,
4 generation failed or requires review. Paid submissions are never auto-retried.
`;
class CliError extends Error {
  constructor(code, exit = 1, details = {}) {
    super(code);
    this.exit = exit;
    this.details = details;
  }
}
const configPath = resolve(
  process.env.CLIPMIVO_CONFIG_DIR || resolve(homedir(), '.config', 'clipmivo'),
  'config.json',
);
function originFor(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError('invalid_api_url', 2);
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  )
    throw new CliError('api_url_must_be_https_origin_or_loopback', 2);
  return url.origin;
}
function positive(value, fallback, maximum) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum)
    throw new CliError('invalid_number', 2);
  return number;
}
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        'api-url': { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
        file: { type: 'string' },
        output: { type: 'string' },
        duration: { type: 'string' },
        timeout: { type: 'string' },
        limit: { type: 'string' },
        cursor: { type: 'string' },
        status: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        'idempotency-key': { type: 'string' },
        wait: { type: 'boolean' },
        url: { type: 'string' },
      },
    });
  } catch {
    throw new CliError('invalid_arguments', 2);
  }
  const { values: v, positionals: p } = parsed;
  if (v.help || (!p.length && !v.version)) {
    process.stdout.write(help);
    return;
  }
  if (v.version) {
    emit({ version: '0.2.7' });
    return;
  }
  const [command, id] = p;
  const commands = [
    'models',
    'balance',
    'usage',
    'upload',
    'upload-status',
    'assets',
    'asset-get',
    'asset-download',
    'asset-delete',
    'quote',
    'generate',
    'jobs',
    'get',
    'wait',
    'download',
    'config',
    'callbacks',
    'callback-create',
    'callback-verify',
    'callback-disable',
    'callback-deliveries',
    'callback-retry',
  ];
  if (!commands.includes(command)) throw new CliError('unknown_command', 2);
  const commandOptions = {
    assets: ['limit', 'cursor'],
    usage: ['from', 'to'],
    upload: ['file', 'duration'],
    quote: ['file'],
    generate: ['file', 'idempotency-key', 'wait', 'timeout'],
    jobs: ['limit', 'cursor', 'status'],
    wait: ['timeout'],
    download: ['output'],
    'asset-download': ['output'],
    'callback-create': ['url'],
  };
  const allowed = [
    'api-url',
    'json',
    'help',
    'version',
    ...(commandOptions[command] || []),
  ];
  if (Object.keys(v).some((option) => !allowed.includes(option)))
    throw new CliError('option_not_valid_for_command', 2);
  // Reject an invalid wait configuration before any possibly paid submission.
  if (v.timeout !== undefined) positive(v.timeout, 600, 86400);
  if (
    p.length >
    (command === 'config' || command === 'callback-retry'
      ? 3
      : [
            'get',
            'upload-status',
            'asset-get',
            'asset-download',
            'asset-delete',
            'wait',
            'download',
            'callback-verify',
            'callback-disable',
            'callback-deliveries',
          ].includes(command)
        ? 2
        : 1)
  )
    throw new CliError('unexpected_argument', 2);
  let config = {};
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new CliError('invalid_config_file', 2);
  }
  const origin = originFor(
    v['api-url'] ||
      process.env.CLIPMIVO_API_URL ||
      config.api_url ||
      'https://clipmivoai.com',
  );
  const key = process.env.CLIPMIVO_API_KEY;
  if (command === 'config') {
    if (id === 'show' && p.length === 2) {
      emit({ api_url: origin, key_configured: !!key });
      return;
    }
    if (id !== 'set-url' || !p[2])
      throw new CliError('invalid_config_command', 2);
    const api_url = originFor(p[2]);
    await mkdir(dirname(configPath), { recursive: true });
    const handle = await open(configPath, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ api_url }) + '\n');
    } finally {
      await handle.close();
    }
    emit({ api_url });
    return;
  }
  if (!key?.startsWith('ff_') || /[\r\n]/.test(key))
    throw new CliError('set_CLIPMIVO_API_KEY', 2);
  if (command === 'upload-status') {
    if (!/^asset_[a-f0-9]{32}$/.test(id || '')) throw new CliError('invalid_upload_id', 2);
    return emit(await json(`uploads/${id}`));
  }
  if (['asset-get','asset-download','asset-delete'].includes(command)
    && !/^asset_[a-f0-9]{32}$/.test(id || '')) throw new CliError('invalid_asset_id', 2);
  if (
    ['get', 'wait', 'download'].includes(command) &&
    !/^[A-Za-z0-9_-]{1,200}$/.test(id || '')
  )
    throw new CliError('invalid_task_id', 2);
  if (
    [
      'callback-verify',
      'callback-disable',
      'callback-deliveries',
      'callback-retry',
    ].includes(command) &&
    !/^cb_[A-Za-z0-9_-]{1,160}$/.test(id || '')
  )
    throw new CliError('invalid_callback_id', 2);
  if (
    command === 'callback-retry' &&
    !/^del_[A-Za-z0-9_-]{1,180}$/.test(p[2] || '')
  )
    throw new CliError('invalid_delivery_id', 2);
  async function request(
    path,
    method = 'GET',
    body,
    headers = {},
    timeoutMs = 30000,
  ) {
    const options = {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${key}`, ...headers },
    };
    if (body !== undefined) {
      options.body = body;
      options.duplex = 'half';
    }
    let response;
    try {
      response = await fetch(`${origin}/api/open/v1/${path}`, options);
    } catch {
      throw new CliError(
        method === 'POST' && path === 'videos/generations'
          ? 'submission_uncertain_reuse_same_idempotency_key'
          : 'network_request_failed',
      );
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new CliError('redirect_rejected');
    }
    return response;
  }
  async function json(path, method = 'GET', body, headers = {}, timeoutMs) {
    const response = await request(
      path,
      method,
      body === undefined ? undefined : JSON.stringify(body),
      { 'Content-Type': 'application/json', ...headers },
      timeoutMs,
    );
    let result;
    try {
      result = await response.json();
    } catch {
      throw new CliError('invalid_api_response', 1, {
        status: response.status,
      });
    }
    if (!response.ok || result.success !== true)
      throw new CliError(
        /^[a-z0-9_]{1,100}$/.test(result.error?.code || '')
          ? result.error.code
          : 'api_request_failed',
        1,
        {
          status: response.status,
          ...(response.headers.get('retry-after')
            ? { retry_after: response.headers.get('retry-after') }
            : {}),
        },
      );
    return result;
  }
  async function waitFor(taskId) {
    const deadline = Date.now() + positive(v.timeout, 600, 86400) * 1000;
    while (Date.now() < deadline) {
      const result = await json(
        `videos/generations/${taskId}`,
        'GET',
        undefined,
        {},
        Math.max(1, Math.min(30000, deadline - Date.now())),
      );
      const status = result.data?.status;
      if (status === 'completed' || status === 'succeeded') return result;
      if (
        ['failed', 'needs_review', 'cancelled', 'canceled', 'expired'].includes(
          status,
        )
      )
        throw new CliError('generation_' + status, 4, { task_id: taskId });
      await new Promise((done) =>
        setTimeout(done, Math.max(0, Math.min(2000, deadline - Date.now()))),
      );
    }
    throw new CliError('wait_timeout', 3, { task_id: taskId });
  }
  if (command === 'models') return emit(await json('models'));
  if (command === 'assets') {
    const query = new URLSearchParams();
    if (v.limit !== undefined) {
      const limit = Number(v.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200)
        throw new CliError('invalid_limit', 2);
      query.set('limit', String(limit));
    }
    if (v.cursor !== undefined) {
      const match = /^(\d+):(asset_[a-f0-9]{32})$/.exec(v.cursor);
      if (!match || !Number.isSafeInteger(Number(match[1])))
        throw new CliError('invalid_cursor', 2);
      query.set('cursor', v.cursor);
    }
    return emit(await json('assets' + (query.size ? `?${query}` : '')));
  }
  if (command === 'asset-get') return emit(await json(`assets/${id}`));
  if (command === 'asset-delete') return emit(await json(`assets/${id}`, 'DELETE'));
  if (command === 'usage') {
    const query = new URLSearchParams();
    for (const name of ['from', 'to']) {
      if (v[name] === undefined) continue;
      if (!/^\d{1,10}$/.test(v[name])) throw new CliError('invalid_usage_period', 2);
      query.set(name, v[name]);
    }
    if (v.from !== undefined && v.to !== undefined &&
      (Number(v.from) >= Number(v.to) || Number(v.to) - Number(v.from) > 31 * 86400))
      throw new CliError('invalid_usage_period', 2);
    return emit(await json('usage' + (query.size ? '?' + query : '')));
  }
  if (command === 'balance') return emit(await json('credits/balance'));
  if (command === 'jobs') {
    const query = new URLSearchParams({
      limit: String(positive(v.limit, 20, 100)),
    });
    if (v.cursor) query.set('cursor', v.cursor);
    if (v.status) query.set('status', v.status);
    return emit(await json('videos/generations?' + query));
  }
  if (command === 'callbacks') return emit(await json('callbacks'));
  if (command === 'callback-create') {
    let url;
    try {
      url = new URL(v.url);
    } catch {
      throw new CliError('invalid_callback_url', 2);
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      url.port
    )
      throw new CliError('invalid_callback_url', 2);
    return emit(await json('callbacks', 'POST', { url: url.href }));
  }
  if (command === 'callback-verify')
    return emit(await json(`callbacks/${id}/verify`, 'POST', {}));
  if (command === 'callback-disable')
    return emit(await json(`callbacks/${id}`, 'DELETE'));
  if (command === 'callback-deliveries')
    return emit(await json(`callbacks/${id}/deliveries`));
  if (command === 'callback-retry')
    return emit(
      await json(`callbacks/${id}/deliveries/${p[2]}/retry`, 'POST', {}),
    );
  if (command === 'get') return emit(await json(`videos/generations/${id}`));
  if (command === 'wait') return emit(await waitFor(id));
  if (command === 'quote' || command === 'generate') {
    if (!v.file) throw new CliError('request_file_required', 2);
    let body;
    try {
      body = JSON.parse(await readFile(resolve(v.file), 'utf8'));
    } catch {
      throw new CliError('invalid_request_file', 2);
    }
    if (!body || Array.isArray(body) || typeof body !== 'object')
      throw new CliError('request_must_be_object', 2);
    if (command === 'quote')
      return emit(await json('videos/generations/quote', 'POST', body));
    const idem = v['idempotency-key'];
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(idem || ''))
      throw new CliError('idempotency_key_required', 2);
    const result = await json('videos/generations', 'POST', body, {
      'Idempotency-Key': idem,
    });
    if (v.wait) {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(result.data?.id || ''))
        throw new CliError('invalid_task_response');
      process.stderr.write(
        JSON.stringify({ task_id: result.data.id, idempotency_key: idem }) +
          '\n',
      );
      return emit(await waitFor(result.data.id));
    }
    return emit({ ...result, idempotency_key: idem });
  }
  if (command === 'upload') {
    if (!v.file) throw new CliError('file_required', 2);
    const types = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
    };
    const mime = types[extname(v.file).toLowerCase()];
    if (!mime) throw new CliError('unsupported_file_type', 2);
    const duration = mime.startsWith('image/') ? 0 : Number(v.duration);
    if (
      !Number.isFinite(duration) ||
      duration < 0 ||
      (!mime.startsWith('image/') && duration <= 0)
    )
      throw new CliError('media_duration_required', 2);
    const handle = await open(resolve(v.file), 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > 50 * 1024 * 1024)
        throw new CliError('file_size_out_of_range', 2);
      const reserved = await json('uploads', 'POST', {
        name: basename(v.file),
        size: stat.size,
        mime,
        duration,
      });
      const data = reserved.data;
      if (
        !/^uploads\/[A-Za-z0-9_-]+$/.test(data?.path || '') ||
        typeof data.token !== 'string'
      )
        throw new CliError('invalid_upload_response');
      try {
      const response = await request(
        data.path,
        'PUT',
        handle.createReadStream({ autoClose: false }),
        {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'X-Upload-Token': data.token,
        },
        120000,
      );
      let result;
      try {
        result = await response.json();
      } catch {
        throw new CliError('invalid_upload_response');
      }
      if (!response.ok || !result.success)
        throw new CliError(
          ['invalid_media_duration', 'upload_size_mismatch', 'unsupported_file',
            'upload_expired', 'upload_not_found', 'upload_failed',
            'invalid_api_key', 'insufficient_scope', 'rate_limited'].includes(result?.error?.code)
            ? result.error.code : 'upload_failed',
          1,
          { status: response.status },
        );
      emit(result);
      } catch (error) {
        const uploadId = data.path.slice('uploads/'.length);
        throw new CliError(error instanceof CliError ? error.message : 'upload_response_uncertain', 1, {
          ...(error instanceof CliError ? error.details : {}),
          ...(/^asset_[a-f0-9]{32}$/.test(uploadId) ? { upload_id: uploadId, recovery_command: `clipmivo upload-status ${uploadId}` } : {}),
        });
      }
    } finally {
      await handle.close();
    }
    return;
  }
  if (command === 'download' || command === 'asset-download') {
    const assetDownload = command === 'asset-download';
    if (!v.output) throw new CliError('output_required', 2);
    const output = resolve(v.output),
      temporary = output + '.part-' + randomUUID();
    let handle,
      reserved = false;
    try {
      // Reserve destination exclusively before any network request; never overwrite.
      handle = await open(output, 'wx', 0o600);
      reserved = true;
      const response = await request(assetDownload ? `assets/${id}/file` : `videos/generations/${id}/download`);
      if (
        !response.ok ||
        !response.body ||
        !(assetDownload ? /^(image\/(png|jpeg|webp|bmp)|video\/(mp4|webm)|audio\/(mp4|webm|mpeg|wav|x-wav)|application\/octet-stream)(;|$)/i : /^(video\/|application\/octet-stream)/i).test(
          response.headers.get('content-type') || '',
        )
      ) {
        await response.body?.cancel();
        throw new CliError('download_failed', 1, { status: response.status });
      }
      const tempHandle = await open(temporary, 'wx', 0o600);
      try {
        await pipeline(
          Readable.fromWeb(response.body),
          tempHandle.createWriteStream({ autoClose: true }),
        );
      } finally {
        await tempHandle.close();
      }
      const size = (await stat(temporary)).size;
      const declared = response.headers.get('content-length');
      if (size === 0 || (declared !== null && Number(declared) !== size))
        throw new CliError('download_size_mismatch');
      await handle.close();
      handle = undefined;
      await rename(temporary, output);
      reserved = false;
      emit({ ...(assetDownload ? {asset_id:id} : {task_id:id}), output });
    } catch (error) {
      if (handle) {
        await handle.close();
      }
      if (reserved) await unlink(output).catch(() => {});
      await unlink(temporary).catch(() => {});
      if (error.code === 'EEXIST') throw new CliError('output_exists', 2);
      throw error;
    }
  }
}
main().catch((error) => {
  const known = error instanceof CliError;
  process.stderr.write(
    JSON.stringify({
      success: false,
      error: {
        code: known ? error.message : 'local_operation_failed',
        ...(known ? error.details : {}),
      },
    }) + '\n',
  );
  process.exitCode = known ? error.exit : 1;
});
