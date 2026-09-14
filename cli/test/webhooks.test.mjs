import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  signWebhook,
  verifyWebhook,
  WebhookVerificationError,
} from '../lib/webhooks.mjs';
const secret = '0123456789abcdef0123456789abcdef';
const eventId = 'evt_0123456789abcdef';
const timestamp = 1788948000;
const body = Buffer.from('{"status":"succeeded","title":"测试🎬"}\n');
function independentlySigned(raw = body, id = eventId, time = timestamp) {
  const digest = createHmac('sha256', secret)
    .update(`${id}.${time}.`)
    .update(raw)
    .digest('hex');
  return {
    'webhook-id': id,
    'webhook-timestamp': String(time),
    'webhook-signature': `v1=${digest}`,
  };
}
void test('webhook protocol interoperates with an independent Node HMAC sender', async () => {
  const headers = independentlySigned();
  assert.deepEqual(
    await signWebhook({ body, eventId, timestamp, secret }),
    headers,
  );
  const verified = await verifyWebhook({
    body,
    headers,
    secret,
    now: timestamp,
  });
  assert.equal(verified.eventId, eventId);
  assert.deepEqual(Buffer.from(verified.body), body);
  assert.equal(verified.timestamp, timestamp);
});
void test('webhooks reject raw-body mutation, event substitution, bad signatures and duplicate headers', async () => {
  const headers = independentlySigned();
  for (const input of [
    { body: body.toString().trim(), headers },
    { body, headers: { ...headers, 'webhook-id': 'evt_abcdefghijklmnop' } },
    {
      body,
      headers: { ...headers, 'webhook-timestamp': String(timestamp + 1) },
    },
    {
      body,
      headers: { ...headers, 'webhook-signature': 'v1=' + '0'.repeat(64) },
    },
    {
      body,
      headers: {
        ...headers,
        'webhook-signature':
          headers['webhook-signature'] + ', ' + headers['webhook-signature'],
      },
    },
    { body, headers: { ...headers, 'webhook-timestamp': '0' + timestamp } },
    {
      body,
      headers: {
        ...headers,
        'webhook-timestamp': `${timestamp}, ${timestamp}`,
      },
    },
    { body, headers: {} },
  ])
    await assert.rejects(
      verifyWebhook({ ...input, secret, now: timestamp }),
      WebhookVerificationError,
    );
});
void test('webhook freshness covers both stale and future timestamps and bounded tolerance', async () => {
  const headers = independentlySigned();
  for (const offset of [-300, 300])
    await verifyWebhook({ body, headers, secret, now: timestamp + offset });
  for (const offset of [-301, 301])
    await assert.rejects(
      verifyWebhook({ body, headers, secret, now: timestamp + offset }),
      WebhookVerificationError,
    );
  for (const tolerance of [301, -1, Infinity, NaN])
    await assert.rejects(
      verifyWebhook({ body, headers, secret, now: timestamp, tolerance }),
      WebhookVerificationError,
    );
});
void test('webhook rotation and input bounds fail without exposing payloads or secrets', async () => {
  const headers = independentlySigned();
  await verifyWebhook({
    body,
    headers,
    secret: 'a'.repeat(32),
    previousSecret: secret,
    now: timestamp,
  });
  for (const candidate of ['', 'short', 'x'.repeat(1025)]) {
    await assert.rejects(
      verifyWebhook({ body, headers, secret: candidate, now: timestamp }),
      (error) => error.message === 'invalid_webhook',
    );
  }
  const large = Buffer.alloc(65537);
  await assert.rejects(
    verifyWebhook({
      body: large,
      headers: independentlySigned(large),
      secret,
      now: timestamp,
    }),
    WebhookVerificationError,
  );
  await assert.rejects(
    signWebhook({ body, eventId: 'invalid', timestamp, secret }),
    WebhookVerificationError,
  );
});
void test('verification returns a snapshot of the authenticated bytes across asynchronous crypto', async () => {
  const mutable = Uint8Array.from(body);
  const pending = verifyWebhook({
    body: mutable,
    headers: independentlySigned(),
    secret,
    now: timestamp,
  });
  mutable.fill(0);
  const verified = await pending;
  assert.deepEqual(Buffer.from(verified.body), body);
});
