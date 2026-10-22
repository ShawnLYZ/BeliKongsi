import type { ApprovalType } from '@/generated/prisma/client';

/** The screen where an approval's subject is handled. */
export function approvalLink(type: ApprovalType, subjectId: string, approvalId: string): string {
  if (type === 'supplier_confirmation') return `/supplier/orders/${subjectId}`;
  // Ops decide a supplier order from the inbox on the Ops home page.
  if (type === 'supplier_order') return '/ops';
  return `/approvals/${approvalId}`;
}
