'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import type { PaymentView } from '@/lib/views/payments';
import { ApprovePayButton } from '@/components/baskets/approve-pay-button';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR } from '@/components/common/controls';
import { Money } from '@/components/common/money';
import { Countdown } from '@/components/rounds/countdown';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { PlaceholderQr } from './placeholder-qr';

/** Fictional banks only: no real bank names, logos or branding (PRD §22). */
export const FPX_BANKS = ['Bank Satu Contoh', 'Bank Dua Contoh', 'Koperasi Contoh'] as const;

type Method = 'duitnow_qr' | 'fpx';
type Outcome = 'succeeded' | 'failed';

const TAB =
  'text-foreground min-h-12 flex-1 rounded-lg px-3 text-base font-semibold data-active:bg-card data-active:shadow-sm';
const BANK =
  'has-focus-visible:ring-ring/60 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 px-3 has-focus-visible:ring-3';

/** The simulated checkout: DuitNow QR or FPX, then "Pay (simulated)" or "Simulate failure". */
export function CheckoutScreen({
  payment,
  serverNow,
}: {
  payment: PaymentView;
  serverNow: string;
}) {
  const router = useRouter();
  const id = useId();
  const [status, setStatus] = useState(payment.status);
  const [method, setMethod] = useState<Method>('duitnow_qr');
  const [bank, setBank] = useState<string | null>(null);
  const [bankError, setBankError] = useState(false);
  const [busy, setBusy] = useState<Outcome | null>(null);

  async function simulate(outcome: Outcome) {
    if (method === 'fpx' && !bank) {
      setBankError(true);
      return;
    }
    setBusy(outcome);
    try {
      const result = await apiFetch<PaymentView>(`/api/payments/${payment.paymentId}/simulate`, {
        method: 'POST',
        body: { outcome, method },
        quiet: true,
      });
      if (result.status === 'succeeded') {
        toast.success('Paid (simulated).');
        router.push(`/owner/receipts/${payment.paymentId}`);
        return;
      }
      setStatus(result.status);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PAYMENT_VOIDED') setStatus('voided');
      else
        toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <p
        role="note"
        className="border-accent bg-accent/20 flex items-start gap-2 rounded-xl border-2 p-3 text-base font-semibold"
      >
        <FlaskConical aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        Simulated payment — no real money moves
      </p>

      <div className="flex flex-col gap-1">
        <h1 className="text-[1.75rem] leading-tight font-bold">Checkout</h1>
        <p className="text-base">
          {payment.purpose === 'basket' ? 'Your weekly basket' : 'Joining a Kongsi round'}
        </p>
      </div>

      <section
        aria-labelledby={`${id}-amount`}
        className="bg-card flex flex-col gap-2 rounded-2xl border p-4"
      >
        <h2 id={`${id}-amount`} className="text-lg font-semibold">
          Amount to pay
        </h2>
        <p className="text-3xl font-bold">
          <Money sen={payment.externalSen} />
        </p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-base">
          <dt>Items at the starting price</dt>
          <dd className="text-right">
            <Money sen={payment.linesTotalSen} />
          </dd>
          {payment.deliveryFeeSen > 0 ? (
            <>
              <dt>Delivery fee</dt>
              <dd className="text-right">
                <Money sen={payment.deliveryFeeSen} />
              </dd>
            </>
          ) : null}
          {payment.balanceAppliedSen > 0 ? (
            <>
              <dt>BeliKongsi balance used</dt>
              <dd className="text-right">
                −<Money sen={payment.balanceAppliedSen} />
              </dd>
            </>
          ) : null}
        </dl>
        {status === 'pending' ? (
          <Countdown
            cutoffAt={payment.deadlineAt}
            serverNow={serverNow}
            label="Pay by"
            passedText="The deadline has passed"
          />
        ) : null}
      </section>

      {status === 'failed' ? (
        <section
          role="alert"
          className="border-destructive flex flex-col gap-3 rounded-2xl border-2 p-4"
        >
          <p className="flex items-start gap-2 text-lg font-semibold">
            <AlertTriangle aria-hidden="true" className="text-destructive mt-1 size-5 shrink-0" />
            Payment failed (simulated)
          </p>
          <p className="text-base">
            Nothing was charged.{' '}
            {payment.purpose === 'basket'
              ? 'Your basket is unchanged. Try again to start a new payment.'
              : 'You have not joined the round. Choose it again to try again.'}
          </p>
          {payment.purpose === 'basket' && payment.basketId ? (
            <>
              <ApprovePayButton basketId={payment.basketId} label="Try again" />
              <Link href="/owner/basket" className={BUTTON_SECONDARY}>
                Back to your basket
              </Link>
            </>
          ) : (
            <Link href="/owner/rounds" className={BUTTON_PRIMARY}>
              Try again
            </Link>
          )}
        </section>
      ) : status === 'voided' ? (
        <section
          role="alert"
          className="border-destructive flex flex-col gap-3 rounded-2xl border-2 p-4"
        >
          <p className="text-lg font-semibold">This payment was cancelled</p>
          <p className="text-base">
            The result came after the deadline, so nothing was charged and nothing was ordered.
          </p>
          <Link href="/owner" className={BUTTON_SECONDARY}>
            Back to home
          </Link>
        </section>
      ) : (
        <>
          <Tabs value={method} onValueChange={(v) => setMethod(v as Method)} className="gap-4">
            <TabsList
              aria-label="Payment method"
              className="bg-muted h-auto w-full gap-1 rounded-xl p-1"
            >
              <TabsTrigger value="duitnow_qr" className={TAB}>
                DuitNow QR
              </TabsTrigger>
              <TabsTrigger value="fpx" className={TAB}>
                FPX online banking
              </TabsTrigger>
            </TabsList>
            <TabsContent value="duitnow_qr" className="flex flex-col items-center gap-3 text-base">
              <PlaceholderQr seed={payment.paymentId} />
              <p className="text-center text-base">
                Scan with your banking app. This is a placeholder QR code: nothing is scanned or
                paid.
              </p>
            </TabsContent>
            <TabsContent value="fpx" className="text-base">
              <fieldset
                className="flex flex-col gap-2"
                aria-describedby={bankError ? `${id}-bank-error` : undefined}
              >
                <legend className="mb-2 text-base font-semibold">Choose your bank</legend>
                {FPX_BANKS.map((name) => (
                  <label
                    key={name}
                    className={cn(
                      BANK,
                      bank === name ? 'border-primary bg-primary/10' : 'bg-card border-input/40',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-bank`}
                      value={name}
                      checked={bank === name}
                      onChange={() => {
                        setBank(name);
                        setBankError(false);
                      }}
                      className="accent-primary size-5 shrink-0"
                    />
                    <span className="text-base font-semibold">{name}</span>
                  </label>
                ))}
                {bankError ? (
                  <p id={`${id}-bank-error`} className={FIELD_ERROR}>
                    Choose a bank first.
                  </p>
                ) : null}
              </fieldset>
            </TabsContent>
          </Tabs>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              className={`${BUTTON_PRIMARY} text-lg`}
              disabled={busy !== null}
              onClick={() => simulate('succeeded')}
            >
              {busy === 'succeeded' ? 'Paying…' : 'Pay (simulated)'}
            </button>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={busy !== null}
              onClick={() => simulate('failed')}
            >
              {busy === 'failed' ? 'Failing…' : 'Simulate failure'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
