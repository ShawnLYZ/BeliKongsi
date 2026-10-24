import Link from 'next/link';
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from '@/components/common/controls';
import { PhoneColumn } from '@/components/common/phone-column';

/**
 * The checkout's 404 (`notFound()` in the page): an unknown payment, most often an old link
 * kept open across "Reset demo data", says what happened and where to go next.
 */
export default function CheckoutNotFound() {
  return (
    <main id="main" className="flex min-h-screen flex-col px-4 py-5">
      <PhoneColumn className="bg-card text-card-foreground flex flex-col gap-4 rounded-2xl p-5">
        <h1 className="text-[1.75rem] leading-tight font-bold">Payment not found</h1>
        <p className="text-base">This payment no longer exists. The demo may have been reset.</p>
        <p className="text-muted-foreground text-base">
          Open your basket to approve and pay again, or go back to your home screen.
        </p>
        <Link href="/owner/basket" className={`${BUTTON_PRIMARY} w-full`}>
          Go to basket
        </Link>
        <Link href="/owner" className={`${BUTTON_SECONDARY} w-full`}>
          Back to home
        </Link>
      </PhoneColumn>
    </main>
  );
}
