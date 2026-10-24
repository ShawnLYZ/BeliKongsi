import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { resolveClock } from '@/server/adapters/clock';
import { systemCaller, type Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { AppError, badRequest, notFound } from '@/server/platform/errors';
import { requireOps } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';
import { appendLog } from '../activity/log';
import { cleanAppId } from './engine-api';
import { EVENT_TYPES } from './events';
import { assertPublicHttpsUrl, assertSafeWebhookUrl, isDemoReceiverUrl } from './ssrf';

/** Waits before retries 1 to 5. Six attempts in all; after the sixth failure the delivery is failed. */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;
/** A receiver that has not answered within this long counts as a failed attempt. */
export const DELIVERY_TIMEOUT_MS = 5_000;
const DELIVERY_BATCH = 50;
/**
 * Claimed deliveries are pushed this far ahead while they are being sent, so another run skips
 * them; if the server dies mid-batch they are retried after it, without counting an attempt.
 */
const CLAIM_LEASE_MS = 5 * 60_000;
const MAX_URL_LENGTH = 2_048;

const caller = systemCaller('webhooks');

export const registerWebhookSchema = z.strictObject({
  url: z.string().trim().min(1).max(MAX_URL_LENGTH),
  eventTypes: z.array(z.enum(EVENT_TYPES)).min(1).max(EVENT_TYPES.length),
});
export type RegisterWebhookInput = z.infer<typeof registerWebhookSchema>;

/** `'v1=' + hex(HMAC-SHA256(secret, `${timestamp}.${body}`))`. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** The calling Orbyte app, from the simulated app credential header; 401 without it. */
export function requireAppId(request: Request): string {
  const id = cleanAppId(request)?.trim();
  if (!id) {
    throw new AppError(
      'APP_ID_REQUIRED',
      401,
      'Send your Orbyte app id in the X-Orbyte-App-Id header.',
    );
  }
  return id;
}

export type WebhookView = {
  id: string;
  url: string;
  eventTypes: string[];
  createdAt: string;
};

/** The secret is returned here and nowhere else. */
export async function registerWebhook(
  deps: AppDeps,
  appId: string,
  input: RegisterWebhookInput,
  ownOrigin: string,
): Promise<{ id: string; url: string; eventTypes: string[]; secret: string }> {
  await assertSafeWebhookUrl(deps, input.url, ownOrigin);
  const eventTypes = [...new Set(input.eventTypes)];
  const secret = randomBytes(32).toString('base64url');
  const sub = await withTransaction(deps, caller, async (ctx) => {
    const created = await ctx.tx.webhookSubscription.create({
      data: {
        appId,
        url: input.url,
        eventTypes,
        secret,
        isDemoReceiver: isDemoReceiverUrl(input.url, ownOrigin),
      },
    });
    await appendLog(ctx, {
      action: 'webhook.subscribed',
      subjectType: 'webhook_subscription',
      subjectId: created.id,
      scope: { operator: true },
      after: { appId, eventTypes },
    });
    return created;
  });
  return { id: sub.id, url: sub.url, eventTypes: sub.eventTypes, secret };
}

export async function listWebhooks(deps: AppDeps, appId: string): Promise<WebhookView[]> {
  const rows = await deps.prisma.webhookSubscription.findMany({
    where: { appId, active: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, url: true, eventTypes: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Another app's subscription, or one already removed, is 404. Its pending deliveries are failed. */
export async function deleteWebhook(deps: AppDeps, appId: string, id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) throw notFound('Webhook');
  await withTransaction(deps, caller, async (ctx) => {
    const { count } = await ctx.tx.webhookSubscription.updateMany({
      where: { id, appId, active: true },
      data: { active: false },
    });
    if (count === 0) throw notFound('Webhook');
    await ctx.tx.webhookDelivery.updateMany({
      where: { subscriptionId: id, status: 'pending' },
      data: { status: 'failed', lastError: 'The webhook was removed.' },
    });
    await appendLog(ctx, {
      action: 'webhook.unsubscribed',
      subjectType: 'webhook_subscription',
      subjectId: id,
      scope: { operator: true },
      after: { appId },
    });
  });
}

type Outcome = { ok: boolean; statusCode: number | null; error: string | null };

type ClaimedDelivery = Prisma.WebhookDeliveryGetPayload<{
  include: {
    subscription: { select: { url: true; secret: true; isDemoReceiver: true } };
    event: true;
  };
}>;

const TIMED_OUT = `No answer within ${DELIVERY_TIMEOUT_MS / 1000} seconds.`;

/** Settles like `work`, or rejects as soon as `signal` aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    work.then(resolve, reject);
  });
}

async function attemptDelivery(deps: AppDeps, d: ClaimedDelivery): Promise<Outcome> {
  const { subscription: sub } = d;
  // One 5-second deadline covers the address check (its DNS lookup) and the request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    if (!sub.isDemoReceiver) {
      try {
        await untilAborted(assertPublicHttpsUrl(deps, sub.url), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return { ok: false, statusCode: null, error: TIMED_OUT };
        const message = error instanceof AppError ? error.message : 'The webhook URL was refused.';
        return { ok: false, statusCode: null, error: message };
      }
    }
    return await send(deps, d, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function send(deps: AppDeps, d: ClaimedDelivery, signal: AbortSignal): Promise<Outcome> {
  const { subscription: sub, event } = d;
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    version: event.version,
    occurredAt: event.occurredAt.toISOString(),
    data: event.data,
  });
  // Receivers compare this with their own clock, so it is the real time: the base clock without
  // the demo offset. Claims and retries stay on the demo clock.
  const timestamp = Math.floor(deps.clock.now().getTime() / 1000);
  try {
    const res = await deps.http.fetch(sub.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-belikongsi-event': event.type,
        'x-belikongsi-delivery': d.id,
        'x-belikongsi-timestamp': String(timestamp),
        'x-belikongsi-signature': signWebhook(sub.secret, timestamp, body),
      },
      body,
      signal,
      // A redirect could point anywhere, unchecked: it counts as a failure instead.
      redirect: 'manual',
    });
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, statusCode: res.status, error: null };
    }
    return { ok: false, statusCode: res.status, error: `The receiver answered ${res.status}.` };
  } catch {
    const error = signal.aborted ? TIMED_OUT : 'The request could not be sent.';
    return { ok: false, statusCode: null, error };
  }
}

/**
 * Sends up to 50 due deliveries. A 2xx answer succeeds; anything else (an error status, a
 * redirect, a timeout, a refused address) is a failed attempt, retried on RETRY_DELAYS_MS.
 * `failed` counts failed attempts, including those that will be retried.
 */
export async function deliverDueWebhooks(
  deps: AppDeps,
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const { now, claimed } = await withTransaction(deps, caller, async (ctx) => {
    const rows = await ctx.tx.$queryRaw<{ id: string }[]>`
      SELECT d.id FROM webhook_deliveries d
      JOIN webhook_subscriptions s ON s.id = d.subscription_id
      WHERE d.status = 'pending' AND d.next_attempt_at <= ${ctx.now} AND s.active
      ORDER BY d.next_attempt_at, d.id
      LIMIT ${DELIVERY_BATCH}
      FOR UPDATE OF d SKIP LOCKED`;
    if (rows.length === 0) return { now: ctx.now, claimed: [] };
    const ids = rows.map((r) => r.id);
    await ctx.tx.webhookDelivery.updateMany({
      where: { id: { in: ids } },
      data: { nextAttemptAt: new Date(ctx.now.getTime() + CLAIM_LEASE_MS) },
    });
    const claimed = await ctx.tx.webhookDelivery.findMany({
      where: { id: { in: ids } },
      include: {
        subscription: { select: { url: true, secret: true, isDemoReceiver: true } },
        event: true,
      },
    });
    return { now: ctx.now, claimed };
  });

  const outcomes = await Promise.all(claimed.map((d) => attemptDelivery(deps, d)));
  let succeeded = 0;
  for (const [i, d] of claimed.entries()) {
    const outcome = outcomes[i]!;
    const attempt = d.attempt + 1;
    const recorded = { attempt, lastStatusCode: outcome.statusCode, lastError: outcome.error };
    let data: Prisma.WebhookDeliveryUpdateManyMutationInput;
    if (outcome.ok) {
      succeeded++;
      data = { ...recorded, status: 'succeeded' };
    } else if (attempt > RETRY_DELAYS_MS.length) {
      data = { ...recorded, status: 'failed' };
    } else {
      const delay = RETRY_DELAYS_MS[attempt - 1]!;
      data = { ...recorded, nextAttemptAt: new Date(now.getTime() + delay) };
    }
    await deps.prisma.webhookDelivery.updateMany({
      where: { id: d.id, status: 'pending', attempt: d.attempt },
      data,
    });
  }
  return { attempted: claimed.length, succeeded, failed: claimed.length - succeeded };
}

const invalidSignature = () =>
  new AppError('INVALID_SIGNATURE', 401, 'The webhook signature did not match.');

function signatureMatches(secret: string, timestamp: string | null, body: string, given: string) {
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  const expected = Buffer.from(signWebhook(secret, Number(timestamp), body));
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The demo receiver (demo mode is checked by the route): verifies the signature against the
 * subscription the delivery belongs to and stores what arrived. A bad signature is stored too, so
 * the Ops page can show it, and answered 401.
 */
export async function receiveDemoWebhook(
  deps: AppDeps,
  request: Request,
): Promise<{ received: true; signatureValid: true }> {
  const deliveryId = request.headers.get('x-belikongsi-delivery') ?? '';
  if (!z.uuid().safeParse(deliveryId).success) throw notFound('Delivery');
  const delivery = await deps.prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    select: { id: true, subscription: { select: { secret: true, isDemoReceiver: true } } },
  });
  if (!delivery?.subscription.isDemoReceiver) throw notFound('Delivery');

  const text = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest('The request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('The request body must be a JSON object.');
  }
  const signatureValid = signatureMatches(
    delivery.subscription.secret,
    request.headers.get('x-belikongsi-timestamp'),
    text,
    request.headers.get('x-belikongsi-signature') ?? '',
  );
  await deps.prisma.demoWebhookReceipt.create({
    data: {
      deliveryId: delivery.id,
      receivedAt: (await resolveClock(deps)).now(),
      signatureValid,
      body: body as Prisma.InputJsonObject,
    },
  });
  if (!signatureValid) throw invalidSignature();
  return { received: true, signatureValid: true };
}

export type WebhookActivity = {
  subscriptions: {
    id: string;
    appId: string;
    url: string;
    eventTypes: string[];
    active: boolean;
    isDemoReceiver: boolean;
    createdAt: string;
  }[];
  deliveries: {
    id: string;
    appId: string;
    eventType: string;
    eventSeq: string;
    attempt: number;
    status: 'pending' | 'succeeded' | 'failed';
    nextAttemptAt: string;
    lastStatusCode: number | null;
    lastError: string | null;
    updatedAt: string;
  }[];
  receipts: {
    id: string;
    deliveryId: string;
    eventType: string;
    receivedAt: string;
    signatureValid: boolean;
  }[];
};

/** For the Ops events page: subscriptions, the latest delivery attempts and demo receipts. */
export async function listWebhookActivity(deps: AppDeps, who: Caller): Promise<WebhookActivity> {
  requireOps(who);
  const [subscriptions, deliveries, receipts] = await Promise.all([
    deps.prisma.webhookSubscription.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        appId: true,
        url: true,
        eventTypes: true,
        active: true,
        isDemoReceiver: true,
        createdAt: true,
      },
    }),
    deps.prisma.webhookDelivery.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 50,
      include: {
        subscription: { select: { appId: true } },
        event: { select: { type: true, seq: true } },
      },
    }),
    deps.prisma.demoWebhookReceipt.findMany({
      orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
      take: 20,
      include: { delivery: { select: { event: { select: { type: true } } } } },
    }),
  ]);
  return {
    subscriptions: subscriptions.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
    deliveries: deliveries.map((d) => ({
      id: d.id,
      appId: d.subscription.appId,
      eventType: d.event.type,
      eventSeq: d.event.seq.toString(),
      attempt: d.attempt,
      status: d.status,
      nextAttemptAt: d.nextAttemptAt.toISOString(),
      lastStatusCode: d.lastStatusCode,
      lastError: d.lastError,
      updatedAt: d.updatedAt.toISOString(),
    })),
    receipts: receipts.map((r) => ({
      id: r.id,
      deliveryId: r.deliveryId,
      eventType: r.delivery.event.type,
      receivedAt: r.receivedAt.toISOString(),
      signatureValid: r.signatureValid,
    })),
  };
}
