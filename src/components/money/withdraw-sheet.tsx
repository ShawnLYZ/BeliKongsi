'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, apiFetch, isDefiniteRejection } from '@/components/common/api-client';
import { BottomSheet } from '@/components/common/bottom-sheet';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR } from '@/components/common/controls';
import { MoneyInput } from '@/components/common/money-input';
import { SimulatedBadge } from '@/components/common/simulated-badge';
import { formatRM } from '@/lib/format';
import { senToRinggitInput } from '@/lib/money-input';
import { readWithdrawAmount } from './withdraw-amount';

type Withdrawal = { withdrawalId: string; amountSen: number; balanceSen: number };

/**
 * Sends part or all of the available balance to the shop's bank account (Simulated). Balance a
 * started payment plans to use is set aside and cannot be withdrawn.
 */
export function WithdrawSheet({
  shopId,
  balanceSen,
  availableSen,
  open,
  onOpenChange,
  onDone,
}: {
  shopId: string;
  balanceSen: number;
  availableSen: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt, reused when a retry may already have been applied (network error or 5xx).
  const attempt = useRef<{ key: string; amountSen: number } | null>(null);

  async function send() {
    const read = readWithdrawAmount(text, availableSen);
    if ('error' in read) {
      setError(read.error);
      return;
    }
    const { amountSen } = read;
    if (attempt.current?.amountSen !== amountSen) {
      attempt.current = { key: crypto.randomUUID(), amountSen };
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch<Withdrawal>(`/api/shops/${shopId}/balance/withdraw`, {
        method: 'POST',
        body: { amountSen },
        headers: { 'Idempotency-Key': attempt.current.key },
        quiet: true,
      });
      attempt.current = null;
      toast.success(`${formatRM(amountSen)} is on its way to your bank (Simulated).`);
      setText('');
      onOpenChange(false);
      onDone();
    } catch (e) {
      if (isDefiniteRejection(e)) attempt.current = null;
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Withdraw to your bank"
      description={
        availableSen < balanceSen
          ? `You have ${formatRM(balanceSen)} in your BeliKongsi balance. ${formatRM(balanceSen - availableSen)} is set aside for a payment you have started, so you can withdraw up to ${formatRM(availableSen)}.`
          : `You have ${formatRM(balanceSen)} in your BeliKongsi balance.`
      }
    >
      <p className="flex flex-wrap items-center gap-2 text-base">
        <SimulatedBadge /> No real money moves. The payout is made-up for the demo.
      </p>
      <MoneyInput
        id="withdraw-amount"
        label="Amount to withdraw"
        value={text}
        onChange={(t) => {
          setText(t);
          setError(null);
        }}
      />
      <button
        type="button"
        className={BUTTON_SECONDARY}
        onClick={() => {
          setText(senToRinggitInput(availableSen));
          setError(null);
        }}
      >
        Withdraw everything
      </button>
      {error ? (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      ) : null}
      <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={send}>
        {busy ? 'Sending…' : 'Withdraw (Simulated)'}
      </button>
    </BottomSheet>
  );
}
