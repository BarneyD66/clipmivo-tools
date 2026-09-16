import { createWriteStream } from 'node:fs';
import { unlink, link, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class ApiError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.status = status;
  }
}
export function apiOrigin(
  value = process.env.CLIPMIVO_API_URL || 'https://clipmivoai.com',
) {
  const url = new URL(value);
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
    throw new Error('Use a trusted HTTPS origin or HTTP loopback origin');
  return url.origin;
}
export class Api {
  constructor(origin, { now = Date.now, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
    this.origin = apiOrigin(origin);
    this.now = now;
    this.sleep = sleep;
    this.next = new Map();
    this.queue = Promise.resolve();
  }
  async pace(scope, write) {
    const gate = this.queue.then(async () => {
      const wait = Math.max(0, (this.next.get(scope) || 0) - this.now());
      if (wait) await this.sleep(wait);
      // Server limits are per key/scope: 10 writes or 60 reads per minute.
      this.next.set(scope, this.now() + (write ? 6100 : 1100));
    });
    this.queue = gate.catch(() => {});
    await gate;
  }
  async request(path, method = 'GET', body, idempotencyKey) {
    const key = process.env.CLIPMIVO_API_KEY;
    if (!key) throw new Error('Set CLIPMIVO_API_KEY in your environment');
    const write = !['GET', 'HEAD'].includes(method);
    const scope = `${path.startsWith('images/') ? 'image' : 'video'}:${write ? 'write' : 'read'}`;
    await this.pace(scope, write);
    let response;
    try {
      // Match the existing CLI: /api/v1 is the site's native contract;
      // /api/open/v1 normalizes public workflow model IDs and quoted_credits.
      response = await fetch(`${this.origin}/api/open/v1/${path}`, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError('network_response_uncertain');
    }
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000;
    if (remaining !== null && Number(remaining) === 0 && Number.isFinite(reset))
      this.next.set(scope, Math.max(this.next.get(scope) || 0, reset + 100));
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ApiError('redirect_rejected', response.status);
    }
    return response;
  }
  async json(path, method, body, idempotencyKey) {
    const response = await this.request(path, method, body, idempotencyKey);
    let value;
    try {
      value = await response.json();
    } catch {
      throw new ApiError('invalid_api_response', response.status);
    }
    if (!response.ok || value.success !== true)
      throw new ApiError(
        /^[a-z0-9_]{1,100}$/.test(value.error?.code || '')
          ? value.error.code
          : 'api_error',
        response.status,
      );
    return value.data;
  }
  async download(id, destination) {
    const response = await this.request(
      `videos/generations/${encodeURIComponent(id)}/download`,
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new ApiError('download_failed', response.status);
    }
    const partial = `${destination}.${randomUUID()}.part`;
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(partial, { flags: 'wx' }),
      );
      if (!(await stat(partial)).size) throw new ApiError('empty_download');
      // Atomic no-overwrite publication; a crashed older attempt cannot block
      // this attempt or have its partial file deleted by it.
      await link(partial, destination);
      await unlink(partial);
    } catch (error) {
      await unlink(partial).catch(() => {});
      throw error;
    }
  }
}
