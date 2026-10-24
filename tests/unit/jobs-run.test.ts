import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDeps } from '@/server/platform/deps';

const sweep = vi.hoisted(() => vi.fn(async () => ({ removed: 0 })));
const summaries = vi.hoisted(() =>
  vi.fn(async (): Promise<{ sent: number }> => {
    throw new Error('summaries unavailable');
  }),
);
const retention = vi.hoisted(() => vi.fn(async () => ({ deleted: 0 })));
const deliver = vi.hoisted(() => vi.fn(async () => ({ attempted: 0, succeeded: 0, failed: 0 })));

vi.mock('@/server/modules/rounds/open', () => ({ openDueRounds: async () => ({ opened: 0 }) }));
vi.mock('@/server/modules/baskets/draft', () => ({
  draftWeeklyBaskets: async () => ({ drafted: 0, failed: 0 }),
}));
vi.mock('@/server/modules/baskets/lifecycle', () => ({
  sendBasketReminders: async () => ({ sent: 0 }),
  expireBaskets: async () => ({ expired: 0 }),
}));
vi.mock('@/server/modules/payments/overdue', () => ({
  voidOverduePayments: async () => ({ voided: 0 }),
}));
vi.mock('@/server/modules/rounds/close', () => ({
  closeDueRounds: async () => ({ closed: 0, failed: 0 }),
}));
vi.mock('@/server/modules/savings/monthly-summary', () => ({
  sendMonthlySummaries: summaries,
}));
vi.mock('@/server/modules/fulfilment/late', () => ({
  detectLateDeliveries: async () => ({ detected: 0 }),
}));
vi.mock('@/server/modules/fulfilment/reminders', () => ({
  remindUncollected: async () => ({ reminded: 0 }),
  enforceCheckWindow: async () => ({ reminded: 0, closed: 0 }),
}));
vi.mock('@/server/modules/supplier-orders/reminders', () => ({
  sendOperationalReminders: async () => ({ sent: 0 }),
}));
vi.mock('@/server/modules/directory/deletion', () => ({ sweepDeletedPhotos: sweep }));
vi.mock('@/server/modules/checks/photo-retention', () => ({
  deletePhotosPastRetention: retention,
}));
vi.mock('@/server/modules/integration/webhooks', () => ({
  deliverDueWebhooks: deliver,
}));

describe('runDueJobs', () => {
  beforeEach(() => {
    for (const fn of [sweep, summaries, retention, deliver]) fn.mockClear();
  });

  it('still sweeps deleted photos when the monthly summaries throw', async () => {
    const { runDueJobs } = await import('@/server/modules/jobs/run');
    await expect(runDueJobs({} as AppDeps)).rejects.toThrow('summaries unavailable');
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('still delivers webhooks when the monthly summaries throw', async () => {
    const { runDueJobs } = await import('@/server/modules/jobs/run');
    await expect(runDueJobs({} as AppDeps)).rejects.toThrow('summaries unavailable');
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('runs the summaries, the sweep and webhook delivery when photo retention throws, then reports the first failure', async () => {
    retention.mockRejectedValueOnce(new Error('storage down'));
    const { runDueJobs } = await import('@/server/modules/jobs/run');
    await expect(runDueJobs({} as AppDeps)).rejects.toThrow('storage down');
    expect(summaries).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
