// Shared sender/receiver protocol. Verify the exact request bytes before parsing.
const encoder = new TextEncoder();
const eventIdPattern = /^evt_[a-zA-Z0-9_-]{16,100}$/;
const signaturePattern = /^v1=([a-f0-9]{64})$/;
export class WebhookVerificationError extends Error {
  constructor() {
    super('invalid_webhook');
    this.name = 'WebhookVerificationError';
  }
}
function bytes(value) {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  throw new WebhookVerificationError();
}
function envelope(body, eventId, timestamp) {
  if (
    !eventIdPattern.test(eventId) ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0
  )
    throw new WebhookVerificationError();
  const raw = bytes(body);
  if (raw.byteLength > 65536) throw new WebhookVerificationError();
  const prefix = encoder.encode(`${eventId}.${timestamp}.`);
  const message = new Uint8Array(prefix.length + raw.length);
  message.set(prefix);
  message.set(raw, prefix.length);
  return message;
}
async function keyFor(secret, operation) {
  // Secrets are independent of account/API keys and must contain 32+ UTF-8 bytes.
  if (
    typeof secret !== 'string' ||
    encoder.encode(secret).length < 32 ||
    secret.length > 1024
  )
    throw new WebhookVerificationError();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [operation],
  );
}
export async function signWebhook({ body, eventId, timestamp, secret }) {
  const message = envelope(body, eventId, timestamp);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await keyFor(secret, 'sign'), message),
  );
  return {
    'webhook-id': eventId,
    'webhook-timestamp': String(timestamp),
    'webhook-signature':
      'v1=' +
      Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      ),
  };
}
export async function verifyWebhook({
  body,
  headers,
  secret,
  previousSecret,
  now = Math.floor(Date.now() / 1000),
  tolerance = 300,
}) {
  try {
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !Number.isSafeInteger(tolerance) ||
      tolerance < 0 ||
      tolerance > 300
    )
      throw new WebhookVerificationError();
    const h = new Headers(headers);
    const eventId = h.get('webhook-id') || '';
    const stamp = h.get('webhook-timestamp') || '';
    const match = signaturePattern.exec(h.get('webhook-signature') || '');
    if (!/^(0|[1-9][0-9]{0,15})$/.test(stamp) || !match)
      throw new WebhookVerificationError();
    const timestamp = Number(stamp);
    if (Math.abs(now - timestamp) > tolerance)
      throw new WebhookVerificationError();
    const rawBody = bytes(body);
    if (rawBody.byteLength > 65536) throw new WebhookVerificationError();
    const authenticatedBody = rawBody.slice();
    const message = envelope(authenticatedBody, eventId, timestamp);
    const signature = Uint8Array.from(match[1].match(/../g), (byte) =>
      parseInt(byte, 16),
    );
    const secrets =
      previousSecret === undefined ? [secret] : [secret, previousSecret];
    let verified = false;
    for (const candidate of secrets) {
      const valid = await crypto.subtle.verify(
        'HMAC',
        await keyFor(candidate, 'verify'),
        signature,
        message,
      );
      verified = valid || verified;
    }
    if (!verified) throw new WebhookVerificationError();
    // Returning authenticated raw bytes avoids accidental reliance on unverified JSON.
    return { eventId, timestamp, body: authenticatedBody };
  } catch {
    // Never include bodies, supplied signatures or secrets in exception messages.
    throw new WebhookVerificationError();
  }
}
