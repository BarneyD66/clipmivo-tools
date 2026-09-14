export class WebhookVerificationError extends Error {}
export type WebhookPayload = {
  body: string | Uint8Array;
  eventId: string;
  timestamp: number;
  secret: string;
};
export function signWebhook(
  input: WebhookPayload,
): Promise<Record<string, string>>;
export function verifyWebhook(input: {
  body: string | Uint8Array;
  headers: HeadersInit;
  secret: string;
  previousSecret?: string;
  now?: number;
  tolerance?: number;
}): Promise<{ eventId: string; timestamp: number; body: Uint8Array }>;
