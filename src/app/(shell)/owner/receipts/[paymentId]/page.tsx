import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReceiptView as Receipt } from '@/lib/views/payments';
import { ReceiptView } from '@/components/checkout/receipt-view';
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from '@/components/common/controls';
import { EmptyState } from '@/components/common/empty-state';
import { getReceipt } from '@/server/modules/payments/views';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { AppError } from '@/server/platform/errors';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerReceiptPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { session } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const { paymentId } = await params;

  let receipt: Receipt;
  try {
    receipt = await getReceipt(deps, personCaller(session), paymentId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    if (error instanceof AppError && error.code === 'PAYMENT_NOT_PAID') {
      return (
        <EmptyState
          title="No receipt yet"
          explanation="A receipt appears here once this payment succeeds. If you haven't paid yet, go back to the checkout."
          example="Condensed milk 6 × RM 164.09 = RM 984.54."
        >
          <Link href={`/checkout/${paymentId}`} className={`${BUTTON_PRIMARY} mt-4 w-full`}>
            Go to checkout
          </Link>
        </EmptyState>
      );
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-4">
      <ReceiptView receipt={receipt} />
      <Link href="/owner/money" className={BUTTON_SECONDARY}>
        Money history
      </Link>
      <Link href="/owner" className={BUTTON_SECONDARY}>
        Back to home
      </Link>
    </div>
  );
}
