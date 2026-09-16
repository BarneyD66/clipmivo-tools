import { createWriteStream } from 'node:fs';
import { unlink, rename } from 'node:fs/promises';
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
  constructor(origin) {
    this.origin = apiOrigin(origin);
  }
  async request(path, method = 'GET', body, idempotencyKey) {
    const key = process.env.CLIPMIVO_API_KEY;
    if (!key) throw new Error('Set CLIPMIVO_API_KEY in your environment');
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
    const partial = `${destination}.part`;
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(partial, { flags: 'wx' }),
      );
      await rename(partial, destination);
    } catch (error) {
      await unlink(partial).catch(() => {});
      throw error;
    }
  }
}
