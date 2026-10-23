import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { resolveClock } from '@/server/adapters/clock';
import { mytDate } from '@/lib/time';
import { toCsv, toCsvRow } from '@/server/modules/directory/export';
import { createTestApp, type Client, type TestApp } from './helpers/app';
import { basketIdOf, payBasket, setupKedaiKopi } from './helpers/scenarios';

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const WEEK = '2026-W45';

let app: TestApp;
let ah: Client;

beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await setupKedaiKopi(app);
  await payBasket(app, 'ahSeng', (await basketIdOf('KEDAI_KOPI', WEEK))!);
  await (await app.as('nadia')).post('/api/demo/skip-to-cutoff');
  ah = await app.as('ahSeng');
});
afterEach(async () => {
  await app.close();
});

// fflate's strFromU8 drops a leading byte order mark; these tests need to see it.
const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

const unzipped = async () => {
  const res = await ah.get(`/api/shops/${KEDAI}/export`);
  expect(res.status).toBe(200);
  return { res, files: unzipSync(res.raw) };
};

describe('data export', () => {
  it('exports orders, payments, money history and savings as one ZIP (story 88)', async () => {
    const { res, files } = await unzipped();
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'money-history.csv',
      'orders.csv',
      'payments.csv',
      'savings.csv',
    ]);
    expect(text(files['orders.csv']!).split('\r\n')[0]).toBe(
      '﻿participation_id,round_cycle,product,quantity,status,joined_at,paid_sen,paid_rm,final_all_in_sen,refund_sen',
    );
    expect(text(files['payments.csv']!).split('\r\n')[0]).toBe(
      '﻿payment_id,created_at,purpose,method,total_sen,balance_applied_sen,paid_sen,status',
    );
    expect(text(files['money-history.csv']!).split('\r\n')[0]).toBe(
      '﻿at,kind,label,amount_sen,amount_rm,balance_change_sen,running_balance_sen,reason',
    );
    expect(text(files['savings.csv']!).split('\r\n')[0]).toBe(
      '﻿participation_id,product,status,basis,saving_sen',
    );
    expect(text(files['README.txt']!)).toMatch(/synthetic/i);
    expect(text(files['README.txt']!)).toMatch(/simulated/i);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const today = mytDate((await resolveClock(app.deps)).now());
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="belikongsi-export-${today}.zip"`,
    );
  });

  it('holds the shop rows, with plain decimals for ringgit', async () => {
    const { files } = await unzipped();
    const rows = (name: string) =>
      text(files[name]!)
        .replace(/^﻿/, '')
        .split('\r\n')
        .filter(Boolean)
        .map((r) => r.split(','));
    const orders = rows('orders.csv').slice(1);
    const count = await app.prisma.participation.count({ where: { shopId: KEDAI } });
    expect(orders).toHaveLength(count);
    for (const o of orders) expect(o[7]).toMatch(/^\d+\.\d{2}$/);
    const history = rows('money-history.csv').slice(1);
    expect(history.length).toBeGreaterThan(0);
    for (const h of history) expect(h[4]).toMatch(/^\d+\.\d{2}$/);
    expect(rows('payments.csv').length).toBeGreaterThan(1);
  });

  it('logs the export without names', async () => {
    await unzipped();
    const entry = await app.prisma.activityLogEntry.findFirstOrThrow({
      where: { action: 'data.exported' },
    });
    expect(entry).toMatchObject({ shopId: KEDAI, subjectType: 'shop', subjectId: KEDAI });
    expect(JSON.stringify(entry.after)).not.toMatch(/ah ?seng|kedai/i);
  });

  it('quotes commas, quotes and line breaks in values', () => {
    expect(toCsvRow(['Kopi "O", kaw', 1])).toBe('"Kopi ""O"", kaw",1');
    expect(toCsvRow(['two\nlines', 'a\r\nb', null])).toBe('"two\nlines","a\r\nb",');
    expect(toCsv([['a'], ['b']])).toBe('﻿a\r\nb\r\n');
  });

  it("refuses another shop's export", async () => {
    const siti = await app.as('siti');
    const res = await siti.get(`/api/shops/${KEDAI}/export`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: expect.any(String) });
    expect(await app.prisma.activityLogEntry.count({ where: { action: 'data.exported' } })).toBe(0);
  });
});
