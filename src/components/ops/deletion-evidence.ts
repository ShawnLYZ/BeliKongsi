/** What a deletion request carries (written by requestDeletion) and what a refused approve returns. */
export type DeletionEvidence = {
  activeRounds: number;
  openPickups: number;
  openClaims: number;
  pendingPayments: number;
  balanceSen: number;
  canApprove: boolean;
};

const count = (x: unknown): number =>
  typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;

/**
 * Reads deletion evidence or a DELETION_BLOCKED `details` object. Missing or malformed counts are
 * zero, so a partial object never leaves a blank row. `canApprove` is only true when the server
 * said so (a refused approve is never approvable).
 */
export function deletionEvidenceOf(
  evidence: unknown,
  opts: { refused?: boolean } = {},
): DeletionEvidence {
  const e = evidence && typeof evidence === 'object' ? (evidence as Record<string, unknown>) : {};
  return {
    activeRounds: count(e.activeRounds),
    openPickups: count(e.openPickups),
    openClaims: count(e.openClaims),
    pendingPayments: count(e.pendingPayments),
    balanceSen: count(e.balanceSen),
    canApprove: !opts.refused && e.canApprove === true,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Open items still in the way, as a comma list; empty when there are none. */
export function blockersText(e: DeletionEvidence): string {
  const parts: string[] = [];
  if (e.activeRounds) parts.push(plural(e.activeRounds, 'active round'));
  if (e.openPickups) parts.push(plural(e.openPickups, 'open pickup'));
  if (e.openClaims) parts.push(plural(e.openClaims, 'open claim'));
  if (e.pendingPayments) parts.push(plural(e.pendingPayments, 'pending payment'));
  return parts.join(', ');
}

/** Open items in all, for the inbox table. */
export function openItemCount(e: DeletionEvidence): number {
  return e.activeRounds + e.openPickups + e.openClaims + e.pendingPayments;
}
