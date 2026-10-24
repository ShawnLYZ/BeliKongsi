import type { ParticipationStatus } from '@/generated/prisma/client';
import type { DeliveryResultView, SavingsView } from '@/lib/views/savings';

/** One of a shop's Kongsi lines, as its owner sees it in My Kongsi. All amounts are in sen. */
export interface ParticipationView {
  participationId: string;
  roundId: string;
  productId: string;
  productName: string;
  shortName: string;
  unitName: string;
  imageUrl: string | null;
  quantity: number;
  status: ParticipationStatus;
  /** "pickup" or "door". */
  destinationType: string;
  /** ISO instants. */
  cutoffAt: string;
  expectedReadyAt: string;
  /** Per unit, all-in, when the line joined. */
  startingAllInSen: number;
  /** Per unit, all-in, at the close; null while the round is open or the line never closed. */
  finalAllInSen: number | null;
  paidSen: number;
  /** Everything refunded to the shop's balance for this line. */
  refundSen: number;
  outcomeReason: string | null;
  /** What the delivery check found; null until the line is checked. */
  deliveryResult: DeliveryResultView | null;
  /** Null before the cut-off and for refunded lines. */
  savings: SavingsView | null;
}

export function participationView(
  p: {
    id: string;
    roundId: string;
    quantity: number;
    status: ParticipationStatus;
    destinationType: string;
    startingAllInSen: number;
    finalAllInSen: number | null;
    paidSen: number;
    outcomeReason: string | null;
    round: {
      cutoffAt: Date;
      expectedReadyAt: Date;
      unitName: string;
      product: { id: string; name: string; shortName: string };
    };
  },
  imageUrl: string | null,
  refundSen: number,
  extra: Pick<ParticipationView, 'deliveryResult' | 'savings'>,
): ParticipationView {
  const { round } = p;
  return {
    participationId: p.id,
    roundId: p.roundId,
    productId: round.product.id,
    productName: round.product.name,
    shortName: round.product.shortName,
    unitName: round.unitName,
    imageUrl,
    quantity: p.quantity,
    status: p.status,
    destinationType: p.destinationType,
    cutoffAt: round.cutoffAt.toISOString(),
    expectedReadyAt: round.expectedReadyAt.toISOString(),
    startingAllInSen: p.startingAllInSen,
    finalAllInSen: p.finalAllInSen,
    paidSen: p.paidSen,
    refundSen,
    outcomeReason: p.outcomeReason,
    ...extra,
  };
}
