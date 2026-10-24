import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import type { ActionCode } from '@/server/modules/activity/actions';
import { appendLog } from '@/server/modules/activity/log';
import { systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type TestApp } from './helpers/app';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ seed: 'reference', now: '2026-11-04T04:00:00Z' });
});
afterEach(async () => {
  await app.close();
});

/** Appends one log entry as the system at the given instant. */
async function logAt(
  iso: string,
  action: ActionCode,
  reason?: string,
  subject: { type: string; id: string } = { type: 'round', id: 'r1' },
) {
  app.clock.set(iso);
  await withTransaction(app.deps, systemCaller('test'), (ctx) =>
    appendLog(ctx, {
      action,
      subjectType: subject.type,
      subjectId: subject.id,
      scope: { operator: true },
      ...(reason !== undefined ? { reason } : {}),
    }),
  );
}

/** Reads CSV text (RFC 4180): quoted fields may hold commas, doubled quotes and line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADER =
  'seq,occurred_at_myt,actor_type,actor_role,actor_name,action,subject_type,subject_id,reason,before_json,after_json,hash';

describe('activity log filters', () => {
  it('combines an action with a date range', async () => {
    await logAt('2026-11-01T10:00:00Z', 'round.opened');
    await logAt('2026-11-01T11:00:00Z', 'demo.reset');
    await logAt('2026-11-03T10:00:00Z', 'round.opened');
    const ops = await app.as('nadia');
    const res = await ops.get('/api/activity?action=round.opened&from=2026-11-01&to=2026-11-02');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { occurredAt: string }) => i.occurredAt)).toEqual([
      '2026-11-01T10:00:00.000Z',
    ]);
  });

  it('reads the date range in Malaysia time, inclusive of the whole last day', async () => {
    await logAt('2026-11-01T15:59:00Z', 'round.opened'); // 23:59 on 1 Nov in Malaysia
    await logAt('2026-11-02T15:30:00Z', 'round.opened'); // 23:30 on 2 Nov
    await logAt('2026-11-02T16:00:00Z', 'round.opened'); // 00:00 on 3 Nov
    const ops = await app.as('nadia');
    const days = async (q: string) =>
      (await ops.get(`/api/activity?action=round.opened&${q}`)).body.items
        .map((i: { occurredAt: string }) => i.occurredAt.slice(0, 16))
        .reverse();
    expect(await days('from=2026-11-02&to=2026-11-02')).toEqual(['2026-11-02T15:30']);
    expect(await days('from=2026-11-03')).toEqual(['2026-11-02T16:00']);
    expect(await days('to=2026-11-01')).toEqual(['2026-11-01T15:59']);
  });

  it('refuses a date that is not a real YYYY-MM-DD day', async () => {
    const ops = await app.as('nadia');
    for (const q of ['from=tomorrow', 'to=2026-13-01', 'from=2026-02-30', 'to=2026-1-5']) {
      expect((await ops.get(`/api/activity?${q}`)).status, q).toBe(400);
    }
  });

  it('filters by subject', async () => {
    await logAt('2026-11-01T10:00:00Z', 'round.opened', undefined, { type: 'round', id: 'r1' });
    await logAt('2026-11-01T11:00:00Z', 'round.opened', undefined, { type: 'round', id: 'r2' });
    await logAt('2026-11-01T12:00:00Z', 'round.opened', undefined, { type: 'shop', id: 'r1' });
    const ops = await app.as('nadia');
    const res = await ops.get('/api/activity?action=round.opened&subjectType=round&subjectId=r2');
    expect(res.status).toBe(200);
    expect(
      res.body.items.map((i: { subjectType: string; subjectId: string }) => [
        i.subjectType,
        i.subjectId,
      ]),
    ).toEqual([['round', 'r2']]);
  });

  it('lets Ops filter by the person who acted', async () => {
    await app.as('ahSeng');
    await app.as('rahim');
    const ops = await app.as('nadia');
    const res = await ops.get(`/api/activity?actorUserId=${seedId('user', 'ahSeng')}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(new Set(res.body.items.map((i: { actorName: string }) => i.actorName)).size).toBe(1);
    const ahSeng = await app.prisma.user.findUniqueOrThrow({
      where: { id: seedId('user', 'ahSeng') },
    });
    expect(res.body.items[0].actorName).toBe(ahSeng.displayName);
  });

  it('refuses a person filter that is not a user id', async () => {
    const ops = await app.as('nadia');
    const res = await ops.get('/api/activity?actorUserId=abc');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
    expect((await ops.get('/api/activity/export?actorUserId=abc')).status).toBe(400);
  });

  it('keeps staff to their own actions even when they ask for someone else', async () => {
    const rahim = await app.as('rahim');
    await app.as('ahSeng'); // an owner sign-in is logged too
    const res = await rahim.get(`/api/activity?actorUserId=${seedId('user', 'ahSeng')}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    const own = await rahim.get(`/api/activity?actorUserId=${seedId('user', 'rahim')}`);
    expect(own.body.items.length).toBeGreaterThan(0);
  });
});

describe('activity log CSV export', () => {
  it('starts with a byte order mark and the exact header line', async () => {
    const ops = await app.as('nadia');
    const res = await ops.get('/api/activity/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="activity-log-2026-11-04.csv"',
    );
    expect(Array.from(res.raw.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(res.raw);
    expect(text.startsWith('﻿' + HEADER + '\r\n')).toBe(true);
  });

  it('keeps a reason with a comma, a quote and a newline intact', async () => {
    const reason = 'Late, "damaged"\nsecond line';
    await logAt('2026-11-02T02:00:00Z', 'round.opened', reason);
    const ops = await app.as('nadia');
    const res = await ops.get('/api/activity/export?action=round.opened');
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(res.raw).slice(1);
    const rows = parseCsv(text);
    expect(rows[0]!.join(',')).toBe(HEADER);
    expect(rows).toHaveLength(2);
    const [seq, at, actorType, actorRole, actorName, action, subjectType, subjectId, got] =
      rows[1]!;
    expect(got).toBe(reason);
    expect(at).toBe('2026-11-02 10:00:00');
    expect([actorType, actorRole, actorName]).toEqual(['system', '', '']);
    expect([action, subjectType, subjectId]).toEqual(['round.opened', 'round', 'r1']);
    const stored = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { seq: BigInt(seq!) },
    });
    expect(rows[1]![11]).toBe(stored.hash);
  });

  it('makes a reason that starts like a formula read as plain text', async () => {
    await logAt('2026-11-02T02:00:00Z', 'round.opened', '=HYPERLINK("http://x.example","hi")');
    await logAt('2026-11-02T03:00:00Z', 'round.opened', '+1');
    await logAt('2026-11-02T04:00:00Z', 'round.opened', '-1');
    await logAt('2026-11-02T05:00:00Z', 'round.opened', '@SUM(A1)');
    await logAt('2026-11-02T06:00:00Z', 'round.opened', '\tcmd');
    await logAt('2026-11-02T07:00:00Z', 'round.opened', '\rcmd');
    await logAt('2026-11-02T08:00:00Z', 'round.opened', 'Plain = fine');
    const ops = await app.as('nadia');
    const res = await ops.get('/api/activity/export?action=round.opened');
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(res.raw).slice(1);
    const lines = text.split('\r\n');
    expect(lines[1]).toContain(`,"'=HYPERLINK(""http://x.example"",""hi"")",`);
    const reasons = parseCsv(text)
      .slice(1)
      .map((r) => r[8]);
    expect(reasons).toEqual([
      `'=HYPERLINK("http://x.example","hi")`,
      "'+1",
      "'-1",
      "'@SUM(A1)",
      "'\tcmd",
      "'\rcmd",
      'Plain = fine',
    ]);
  });

  it('filters the export by subject', async () => {
    await logAt('2026-11-02T02:00:00Z', 'round.opened', undefined, { type: 'round', id: 'r1' });
    await logAt('2026-11-02T03:00:00Z', 'round.opened', undefined, { type: 'round', id: 'r2' });
    const ops = await app.as('nadia');
    const res = await ops.get('/api/activity/export?subjectType=round&subjectId=r2');
    const rows = parseCsv(new TextDecoder('utf-8', { ignoreBOM: true }).decode(res.raw).slice(1));
    expect(rows.slice(1).map((r) => [r[6], r[7]])).toEqual([['round', 'r2']]);
    const entry = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'log.exported' },
    });
    expect(entry.after).toEqual({ filters: { subjectType: 'round', subjectId: 'r2' }, rows: 1 });
  });

  it('exports every row in seq order, not just one page, and honours the filters', async () => {
    for (let i = 0; i < 120; i++) await logAt('2026-11-02T02:00:00Z', 'round.opened');
    await logAt('2026-11-03T02:00:00Z', 'demo.reset');
    const ops = await app.as('nadia');
    const all = await ops.get('/api/activity/export?action=round.opened&from=2026-11-02');
    const rows = parseCsv(new TextDecoder('utf-8', { ignoreBOM: true }).decode(all.raw).slice(1));
    expect(rows).toHaveLength(121);
    const seqs = rows.slice(1).map((r) => BigInt(r[0]!));
    expect(seqs).toEqual([...seqs].sort((a, b) => (a < b ? -1 : 1)));
  });

  it('logs the export with its filters and row count', async () => {
    await logAt('2026-11-02T02:00:00Z', 'round.opened');
    const ops = await app.as('nadia');
    await ops.get('/api/activity/export?action=round.opened');
    const entry = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'log.exported' },
    });
    expect(entry).toMatchObject({
      subjectType: 'log',
      subjectId: 'activity',
      operatorScope: true,
      actorUserId: seedId('user', 'nadia'),
      actorRole: 'ops',
    });
    expect(entry.after).toEqual({ filters: { action: 'round.opened' }, rows: 1 });
  });

  it('is closed to owners', async () => {
    const owner = await app.as('ahSeng');
    const res = await owner.get('/api/activity/export');
    expect(res.status).toBe(403);
    expect(await app.prisma.activityLogEntry.count({ where: { action: 'log.exported' } })).toBe(0);
  });
});
