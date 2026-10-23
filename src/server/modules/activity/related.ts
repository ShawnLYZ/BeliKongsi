import type { PrismaClient } from '@/generated/prisma/client';

export type Subject = { type: string; id: string };

/**
 * The log subjects that tell one item's story. A Kongsi line's steps are logged on the line, its
 * pickup, the delivery check and the claim, so its timeline reads across all of them. Unknown
 * types and ids give just the subject itself.
 */
export async function relatedSubjects(
  prisma: PrismaClient,
  subjectType: string,
  subjectId: string,
): Promise<Subject[]> {
  const self: Subject = { type: subjectType, id: subjectId };
  if (!UUID.test(subjectId)) return [self];

  if (subjectType === 'weekly_basket') {
    const lines = await prisma.basketLine.findMany({
      where: { basketId: subjectId },
      select: { id: true },
    });
    return [self, ...lines.map((l) => ({ type: 'basket_line', id: l.id }))];
  }

  if (subjectType === 'participation') {
    const allocation = await prisma.allocation.findUnique({
      where: { participationId: subjectId },
      select: { pickupId: true },
    });
    return [self, ...(await pickupChain(prisma, { pickupId: allocation?.pickupId ?? null }))];
  }

  if (subjectType === 'pickup') {
    return [self, ...(await pickupChain(prisma, { pickupId: subjectId }, false))];
  }

  if (subjectType === 'claim') {
    const claim = await prisma.claim.findUnique({
      where: { id: subjectId },
      select: { deliveryCheck: { select: { id: true, pickupId: true } } },
    });
    const check = claim?.deliveryCheck;
    if (!check) return [self];
    return [self, { type: 'delivery_check', id: check.id }, { type: 'pickup', id: check.pickupId }];
  }

  return [self];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The pickup (when `withPickup`), its delivery check and the claim that check opened. */
async function pickupChain(
  prisma: PrismaClient,
  { pickupId }: { pickupId: string | null },
  withPickup = true,
): Promise<Subject[]> {
  if (!pickupId) return [];
  const check = await prisma.deliveryCheck.findUnique({
    where: { pickupId },
    select: { id: true, claim: { select: { id: true } } },
  });
  return [
    ...(withPickup ? [{ type: 'pickup', id: pickupId }] : []),
    ...(check ? [{ type: 'delivery_check', id: check.id }] : []),
    ...(check?.claim ? [{ type: 'claim', id: check.claim.id }] : []),
  ];
}
