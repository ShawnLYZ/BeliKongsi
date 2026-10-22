import type { Prisma } from '@/generated/prisma/client';
import { participationView, type ParticipationView } from '@/lib/views/participations';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { UUID } from '@/server/platform/ids';
import { toPage } from '@/server/platform/pagination';
import { requireShopAccess } from '@/server/platform/permissions';
import { productImageUrl } from '@/server/modules/rounds/read';

export type ParticipationFilter = {
  status: 'active' | 'history';
  cursor: string | null;
  limit: number;
};

/** The postings that give money back to the shop for one line (not the delivery fee, not claims). */
const REFUND_KINDS = [
  'refund_cancelled',
  'refund_difference',
  'refund_dropped',
  'refund_failed',
  'refund_round_cancelled',
  'refund_shortfall',
] as const;

/** A cursor is the last row's cut-off and id; a malformed one starts from the top. */
function parseCursor(cursor: string | null): { cutoffAt: Date; id: string } | null {
  const [iso, id] = (cursor ?? '').split('|');
  if (!iso || !id || !UUID.test(id)) return null;
  const cutoffAt = new Date(iso);
  return Number.isNaN(cutoffAt.getTime()) ? null : { cutoffAt, id };
}

/**
 * A shop's Kongsi lines, newest cut-off first. `active` is the lines still waiting for their
 * round to close; `history` is every other status. Owner only: staff see no money (R6).
 */
export async function listShopParticipations(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  filter: ParticipationFilter,
): Promise<{ items: ParticipationView[]; nextCursor: string | null }> {
  requireShopAccess(caller, shopId, ['owner']);
  const at = parseCursor(filter.cursor);
  const where: Prisma.ParticipationWhereInput = {
    shopId,
    status: filter.status === 'active' ? 'active' : { not: 'active' },
    ...(at && {
      OR: [
        { round: { cutoffAt: { lt: at.cutoffAt } } },
        { round: { cutoffAt: at.cutoffAt }, id: { lt: at.id } },
      ],
    }),
  };
  const rows = await deps.prisma.participation.findMany({
    where,
    include: { round: { include: { product: true } } },
    orderBy: [{ round: { cutoffAt: 'desc' } }, { id: 'desc' }],
    take: filter.limit + 1,
  });
  const page = toPage(rows, filter.limit, (r) => `${r.round.cutoffAt.toISOString()}|${r.id}`);
  const refunds = await deps.prisma.ledgerPosting.groupBy({
    by: ['participationId'],
    where: {
      participationId: { in: page.items.map((r) => r.id) },
      kind: { in: [...REFUND_KINDS] },
    },
    _sum: { amountSen: true },
  });
  const refundOf = new Map(refunds.map((g) => [g.participationId, g._sum.amountSen ?? 0]));
  return {
    items: page.items.map((r) =>
      participationView(r, productImageUrl(deps, r.round.product), refundOf.get(r.id) ?? 0),
    ),
    nextCursor: page.nextCursor,
  };
}
