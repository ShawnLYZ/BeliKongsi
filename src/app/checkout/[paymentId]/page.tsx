import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { PaymentView } from '@/lib/views/payments';
import { CheckoutScreen } from '@/components/checkout/checkout-screen';
import { PhoneColumn } from '@/components/common/phone-column';
import { Wordmark } from '@/components/shell/brand-mark';
import { MadeUpDataBanner } from '@/components/shell/made-up-data-banner';
import { resolveClock } from '@/server/adapters/clock';
import { getDemoState } from '@/server/modules/demo/demo';
import { getPaymentForCaller } from '@/server/modules/payments/views';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { AppError } from '@/server/platform/errors';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export const metadata: Metadata = { title: 'Checkout (Simulated) · BeliKongsi' };

// Outside the shell on purpose: a payment screen with nothing else to tap but paying or going back.
export default async function CheckoutPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { session } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const { paymentId } = await params;

  let payment: PaymentView;
  try {
    payment = await getPaymentForCaller(deps, personCaller(session), paymentId);
  } catch (error) {
    // An unknown payment, such as a link kept open across a demo reset: see not-found.tsx.
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  if (payment.status === 'succeeded') redirect(`/owner/receipts/${payment.paymentId}`);
  const [clock, demo] = await Promise.all([resolveClock(deps), getDemoState(deps)]);
  const back = payment.purpose === 'basket' ? '/owner/basket' : '/owner/rounds';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-topbar text-topbar-foreground border-b border-white/[0.06]">
        <PhoneColumn className="flex items-center justify-between gap-3 px-4 py-2.5">
          <Link
            href={back}
            className="focus-visible:ring-ring/60 -ml-2 inline-flex min-h-12 items-center gap-1 rounded-xl px-2 text-base font-semibold outline-none focus-visible:ring-3"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
            Back
          </Link>
          <Wordmark />
        </PhoneColumn>
      </header>
      {demo.demoMode ? <MadeUpDataBanner text={demo.bannerText} narrow /> : null}
      <main id="main" className="flex-1 px-4 py-5">
        <PhoneColumn>
          <CheckoutScreen payment={payment} serverNow={clock.now().toISOString()} />
        </PhoneColumn>
      </main>
    </div>
  );
}
