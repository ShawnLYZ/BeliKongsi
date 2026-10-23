import { describe, expect, it, vi } from 'vitest';
import type { AppDeps } from '@/server/platform/deps';

const sweep = vi.hoisted(() => vi.fn(async () => ({ removed: 0 })));

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
  sendMonthlySummaries: async () => {
    throw new Error('summaries unavailable');
  },
}));
vi.mock('@/server/modules/directory/deletion', () => ({ sweepDeletedPhotos: sweep }));

describe('runDueJobs', () => {
  it('still sweeps deleted photos when the monthly summaries throw', async () => {
    const { runDueJobs } = await import('@/server/modules/jobs/run');
    await expect(runDueJobs({} as AppDeps)).rejects.toThrow('summaries unavailable');
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
