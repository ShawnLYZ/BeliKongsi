import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as demoReceiver } from '@/app/api/demo/webhook-receiver/route';
import { emitEvent } from '@/server/modules/integration/events';
import {
  deliverDueWebhooks,
  listWebhookActivity,
  RETRY_DELAYS_MS,
  signWebhook,
} from '@/server/modules/integration/webhooks';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { personCaller, systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type TestApp } from './helpers/app';
import { session } from './helpers/sessions';

const BASE = '/api/integrations/v1/webhooks';
const RECEIVER = 'http://localhost/api/demo/webhook-receiver';
const PUBLIC_IP = '93.184.216.34';

let app: TestApp;

const headers = (appId: string) => ({ 'x-orbyte-app-id': appId });

function register(appId: string, url: string, eventTypes: string[] = ['round.closed']) {
  return app.anonymous().post(BASE, { url, eventTypes }, headers(appId));
}

function emitRoundClosed() {
  return withTransaction(app.deps, systemCaller('test'), (ctx) =>
    emitEvent(ctx, 'round.closed', { roundId: 'r-1', outcome: 'formed' }),
  );
}

const onlyDelivery = () => app.prisma.webhookDelivery.findFirstOrThrow();

function useHttp(http: Partial<TestApp['deps']['http']>) {
  app.deps.http = { ...app.deps.http, ...http };
}

describe('webhooks', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'none' });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it('signs deliveries the receiver can verify', () => {
    expect(signWebhook('s3cret', 1762380000, '{"a":1}')).toBe(
      'v1=' + createHmac('sha256', 's3cret').update('1762380000.{"a":1}').digest('hex'),
    );
  });

  it('needs the Orbyte app id header', async () => {
    const res = await app.anonymous().post(BASE, {
      url: 'https://hooks.example.com/in',
      eventTypes: ['round.closed'],
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('APP_ID_REQUIRED');
  });

  it('shows the secret once, at registration, and logs the subscription without it', async () => {
    const res = await register('orbyte-pos', 'https://hooks.example.com/in');
    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const list = await app.anonymous().get(BASE, undefined, headers('orbyte-pos'));
    expect(list.body.items).toEqual([
      expect.objectContaining({ id: res.body.id, url: 'https://hooks.example.com/in' }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain(res.body.secret);

    const entry = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'webhook.subscribed' },
    });
    expect(entry.after).toMatchObject({ appId: 'orbyte-pos' });
    expect(JSON.stringify([entry.before, entry.after])).not.toContain(res.body.secret);
  });

  it('refuses a hostname that resolves to a private address at registration and again at delivery', async () => {
    useHttp({ lookup: async () => ['10.0.0.5'] });
    const refused = await register('orbyte-pos', 'https://hooks.example.com/in');
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('UNSAFE_WEBHOOK_URL');

    useHttp({ lookup: async () => [PUBLIC_IP] });
    expect((await register('orbyte-pos', 'https://hooks.example.com/in')).status).toBe(201);
    await emitRoundClosed();

    // The DNS answer changes after registration.
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    useHttp({ lookup: async () => ['127.0.0.1'], fetch });
    expect(await deliverDueWebhooks(app.deps)).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    expect(fetch).not.toHaveBeenCalled();
    const delivery = await onlyDelivery();
    expect(delivery).toMatchObject({ status: 'pending', attempt: 1, lastStatusCode: null });
    expect(delivery.lastError).toMatch(/private|loopback/i);
    expect(delivery.nextAttemptAt.getTime() - app.clock.now().getTime()).toBe(60_000);
  });

  it('queues deliveries in the same transaction as the event', async () => {
    expect((await register('orbyte-pos', 'https://hooks.example.com/in')).status).toBe(201);
    await expect(
      withTransaction(app.deps, systemCaller('test'), async (ctx) => {
        await emitEvent(ctx, 'round.closed', { roundId: 'r-1' });
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    expect(await app.prisma.webhookDelivery.count()).toBe(0);

    await emitRoundClosed();
    expect(await onlyDelivery()).toMatchObject({
      status: 'pending',
      attempt: 0,
      nextAttemptAt: app.clock.now(),
    });
  });

  it('retries on the schedule and gives up after the last retry', async () => {
    await register('orbyte-pos', 'https://hooks.example.com/in');
    await emitRoundClosed();
    useHttp({ fetch: async () => new Response('down', { status: 500 }) });

    const deltas: number[] = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      expect(await deliverDueWebhooks(app.deps)).toEqual({
        attempted: 1,
        succeeded: 0,
        failed: 1,
      });
      const delivery = await onlyDelivery();
      expect(delivery.attempt).toBe(attempt);
      expect(delivery.lastStatusCode).toBe(500);
      if (attempt < 6) {
        expect(delivery.status).toBe('pending');
        deltas.push(delivery.nextAttemptAt.getTime() - app.clock.now().getTime());
        app.clock.set(delivery.nextAttemptAt.toISOString());
      } else {
        expect(delivery.status).toBe('failed');
      }
    }
    expect(deltas).toEqual([...RETRY_DELAYS_MS]);
    expect(deltas).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
    expect(await deliverDueWebhooks(app.deps)).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
  });

  it('treats a 5-second timeout as a failed attempt', async () => {
    await register('orbyte-pos', 'https://hooks.example.com/in');
    await emitRoundClosed();
    let called!: () => void;
    const fetchCalled = new Promise<void>((resolve) => (called = resolve));
    useHttp({
      // A receiver that never answers: the request only ends when the signal aborts.
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          called();
        }),
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = deliverDueWebhooks(app.deps);
    await fetchCalled;
    await vi.advanceTimersByTimeAsync(4_999);
    expect((await app.prisma.webhookDelivery.findFirstOrThrow()).attempt).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await run).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    vi.useRealTimers();

    const delivery = await onlyDelivery();
    expect(delivery).toMatchObject({ status: 'pending', attempt: 1 });
    expect(delivery.lastError).toMatch(/5 seconds/);
    expect(delivery.nextAttemptAt.getTime() - app.clock.now().getTime()).toBe(60_000);
  });

  it('treats a DNS lookup that hangs past 5 seconds as a failed attempt', async () => {
    useHttp({ lookup: async () => [PUBLIC_IP] });
    await register('orbyte-pos', 'https://hooks.example.com/in');
    await emitRoundClosed();
    let called!: () => void;
    const lookupCalled = new Promise<void>((resolve) => (called = resolve));
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    useHttp({
      // A resolver that never answers.
      lookup: () =>
        new Promise<string[]>(() => {
          called();
        }),
      fetch,
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const run = deliverDueWebhooks(app.deps);
    await lookupCalled;
    await vi.advanceTimersByTimeAsync(4_999);
    expect((await app.prisma.webhookDelivery.findFirstOrThrow()).attempt).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await run).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    vi.useRealTimers();

    expect(fetch).not.toHaveBeenCalled();
    const delivery = await onlyDelivery();
    expect(delivery).toMatchObject({ status: 'pending', attempt: 1, lastStatusCode: null });
    expect(delivery.lastError).toMatch(/5 seconds/);
    expect(delivery.nextAttemptAt.getTime() - app.clock.now().getTime()).toBe(60_000);
  });

  it('treats a redirect as a failed attempt', async () => {
    await register('orbyte-pos', 'https://hooks.example.com/in');
    await emitRoundClosed();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/' } }),
    );
    useHttp({ fetch });
    expect(await deliverDueWebhooks(app.deps)).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
    expect(await onlyDelivery()).toMatchObject({ status: 'pending', lastStatusCode: 302 });
  });

  it("never lets one app remove another app's subscription", async () => {
    const { body } = await register('orbyte-pos', 'https://hooks.example.com/in');
    const other = await app
      .anonymous()
      .delete(`${BASE}/${body.id}`, undefined, headers('orbyte-crm'));
    expect(other.status).toBe(404);
    const list = await app.anonymous().get(BASE, undefined, headers('orbyte-pos'));
    expect(list.body.items).toHaveLength(1);

    const own = await app
      .anonymous()
      .delete(`${BASE}/${body.id}`, undefined, headers('orbyte-pos'));
    expect(own.status).toBe(204);
    expect((await app.anonymous().get(BASE, undefined, headers('orbyte-pos'))).body.items).toEqual(
      [],
    );
    expect(
      await app.prisma.activityLogEntry.count({ where: { action: 'webhook.unsubscribed' } }),
    ).toBe(1);
  });

  it('shows Ops the subscriptions and attempts, never the secret, and nobody else', async () => {
    const { body } = await register('orbyte-pos', 'https://hooks.example.com/in');
    await emitRoundClosed();
    useHttp({ fetch: async () => new Response(null, { status: 204 }) });
    await deliverDueWebhooks(app.deps);

    const ops = personCaller(session('nadia', 'ops', { operatorId: 'op' }, 'operator'));
    const activity = await listWebhookActivity(app.deps, ops);
    expect(activity.subscriptions).toEqual([
      expect.objectContaining({ appId: 'orbyte-pos', url: 'https://hooks.example.com/in' }),
    ]);
    expect(activity.deliveries).toEqual([
      expect.objectContaining({ eventType: 'round.closed', status: 'succeeded', attempt: 1 }),
    ]);
    expect(JSON.stringify(activity)).not.toContain(body.secret);

    const owner = personCaller(session('ahSeng', 'owner', { shopId: 's' }, 'shop'));
    await expect(listWebhookActivity(app.deps, owner)).rejects.toMatchObject({ status: 403 });
  });
});

describe('the demo receiver', () => {
  beforeEach(async () => {
    app = await createTestApp({ seed: 'demo' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('delivers to the demo receiver and shows the signature as valid (story 161)', async () => {
    const res = await register('orbyte-pos', RECEIVER);
    expect(res.status).toBe(201);
    app.clock.set('2026-11-05T12:01:00Z');
    await closeDueRounds(app.deps);

    // The app posts to itself: hand the request to the receiver's route handler.
    useHttp({ fetch: async (url, init) => demoReceiver(new Request(url, init)) });
    const report = await deliverDueWebhooks(app.deps);
    expect(report.attempted).toBeGreaterThan(0);
    expect(report).toMatchObject({ succeeded: report.attempted, failed: 0 });

    const receipts = await app.prisma.demoWebhookReceipt.findMany();
    expect(receipts).toHaveLength(report.attempted);
    expect(receipts.every((r) => r.signatureValid)).toBe(true);
    expect(receipts[0]!.body).toMatchObject({ type: 'round.closed', version: 1 });
  });

  it('signs with the real time, not the demo clock', async () => {
    const offsetMs = 3 * 86_400_000;
    await withTransaction(app.deps, systemCaller('test'), (ctx) =>
      ctx.tx.demoSettings.update({
        where: { id: 1 },
        data: { clockOffsetMs: BigInt(offsetMs) },
      }),
    );
    useHttp({ lookup: async () => [PUBLIC_IP] });
    await register('orbyte-pos', 'https://hooks.example.com/in');
    await emitRoundClosed();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    useHttp({ fetch });
    expect(await deliverDueWebhooks(app.deps)).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    const sent = fetch.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(sent['x-belikongsi-timestamp']).toBe(
      String(Math.floor(app.clock.now().getTime() / 1000)),
    );
    // The claim lease and retries still follow the demo clock.
    expect(await onlyDelivery()).toMatchObject({ status: 'succeeded', attempt: 1 });
  });

  it('marks a receipt whose signature does not match as invalid and refuses it', async () => {
    await register('orbyte-pos', RECEIVER);
    await emitRoundClosed();
    const delivery = await onlyDelivery();
    const res = await demoReceiver(
      new Request(RECEIVER, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-belikongsi-delivery': delivery.id,
          'x-belikongsi-timestamp': '1762380000',
          'x-belikongsi-signature': signWebhook('not-the-secret', 1762380000, '{"a":1}'),
        },
        body: '{"a":1}',
      }),
    );
    expect(res.status).toBe(401);
    expect((await app.prisma.demoWebhookReceipt.findFirstOrThrow()).signatureValid).toBe(false);
  });
});
