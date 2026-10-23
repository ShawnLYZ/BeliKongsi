'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, apiFetch } from '@/components/common/api-client';
import { BottomSheet } from '@/components/common/bottom-sheet';
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_ERROR,
  FIELD_LABEL,
} from '@/components/common/controls';
import { MoneyInput } from '@/components/common/money-input';
import { SimulatedBadge } from '@/components/common/simulated-badge';
import { formatMyt, formatRM } from '@/lib/format';
import { parseRinggitInput, senToRinggitInput } from '@/lib/money-input';
import { cn } from '@/lib/utils';
import type { AutoApproveRuleView } from '@/server/modules/baskets/auto-approve';

/**
 * Approve the Monday basket automatically when it fits the owner's rule. The rule is checked
 * once, right after the draft, and lines can still be cancelled before cut-off. Switching it on
 * for the first time asks for the DuitNow AutoDebit mandate (Simulated); only a mandate
 * reference is kept, never bank details.
 */
export function AutoApproveCard({
  shopId,
  initial,
}: {
  shopId: string;
  initial: AutoApproveRuleView;
}) {
  const ids = useId();
  const [rule, setRule] = useState(initial);
  const [capText, setCapText] = useState(senToRinggitInput(initial.capSen));
  const [below, setBelow] = useState(initial.requireBelowUsual);
  const [consentOpen, setConsentOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cap = parseRinggitInput(capText);
  const capError =
    cap === undefined || cap === null ? 'Enter an amount in ringgit, for example 500.' : null;

  async function put(enabled: boolean, agreeToMandate: boolean) {
    if (enabled && (cap === undefined || cap === null)) {
      setError(capError);
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await apiFetch<AutoApproveRuleView>(`/api/shops/${shopId}/auto-approve`, {
        method: 'PUT',
        body: {
          enabled,
          ...(typeof cap === 'number' ? { capSen: cap } : {}),
          requireBelowUsual: below,
          ...(agreeToMandate ? { agreeToMandate: true } : {}),
        },
        quiet: true,
      });
      setRule(saved);
      setCapText(senToRinggitInput(saved.capSen));
      toast.success(enabled ? 'Auto-approve is on.' : 'Auto-approve is off.');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MANDATE_REQUIRED') {
        setConsentOpen(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    if (rule.enabled) {
      void put(false, false);
    } else if (!rule.mandateReference) {
      if (capError) setError(capError);
      else setConsentOpen(true);
    } else {
      void put(true, false);
    }
  }

  async function agree() {
    if (await put(true, true)) {
      setConsentOpen(false);
      setAgreed(false);
    }
  }

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="bg-card flex flex-col gap-3 rounded-2xl border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${ids}-title`} className="text-xl font-semibold">
          Approve my basket automatically
        </h2>
        <SimulatedBadge />
      </div>
      <p className="text-base">
        On Monday, after your basket is drafted, BeliKongsi checks it once. If it fits your rule, it
        is approved and paid for you. You can still cancel a line before cut-off.
      </p>

      <div className="flex items-center justify-between gap-3">
        <span id={`${ids}-switch`} className={FIELD_LABEL}>
          Auto-approve is {rule.enabled ? 'on' : 'off'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-labelledby={`${ids}-switch`}
          disabled={busy}
          onClick={toggle}
          className={cn(
            'focus-visible:ring-ring/60 inline-flex h-12 w-20 shrink-0 items-center rounded-full border-2 px-1 outline-none focus-visible:ring-3 disabled:opacity-60',
            rule.enabled ? 'bg-primary border-primary justify-end' : 'bg-muted border-input/60',
          )}
        >
          <span aria-hidden="true" className="bg-card size-8 rounded-full border shadow-sm" />
        </button>
      </div>

      <MoneyInput
        id={`${ids}-cap`}
        label="Only if the basket is no more than"
        value={capText}
        onChange={(t) => {
          setCapText(t);
          setError(null);
        }}
        error={error && capError ? error : null}
        hint="Anything above this waits for you to approve it."
      />

      <label className="flex min-h-12 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={below}
          onChange={(e) => setBelow(e.target.checked)}
          className="accent-primary mt-1 size-6 shrink-0"
        />
        <span className="text-base">
          Only if every item&apos;s starting all-in price is below my usual price
        </span>
      </label>

      {rule.mandateReference ? (
        <p className="text-muted-foreground text-base">
          Mandate reference <span className="font-semibold">{rule.mandateReference}</span>
          {rule.mandateAgreedAt ? <>, agreed {formatMyt(new Date(rule.mandateAgreedAt))}</> : null}.
          Saved cap {formatRM(rule.capSen)}.
        </p>
      ) : null}

      {error && !capError ? (
        <p role="alert" className={FIELD_ERROR}>
          {error}
        </p>
      ) : null}
      {rule.enabled ? (
        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={busy}
          onClick={() => void put(true, false)}
        >
          {busy ? 'Saving…' : 'Save rule'}
        </button>
      ) : null}

      <BottomSheet
        open={consentOpen}
        onOpenChange={setConsentOpen}
        title="DuitNow AutoDebit — Simulated"
        description="Let BeliKongsi pay your approved baskets by DuitNow AutoDebit."
      >
        <p className="text-base">
          This is a simulation: no real money moves. BeliKongsi keeps only a mandate reference,
          never your bank details. You can switch the rule off any time on this screen.
        </p>
        <label className="flex min-h-12 cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="accent-primary mt-1 size-6 shrink-0"
          />
          <span className="text-base">I agree to the DuitNow AutoDebit mandate (Simulated)</span>
        </label>
        {error ? (
          <p role="alert" className={FIELD_ERROR}>
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={!agreed || busy}
            onClick={() => void agree()}
          >
            {busy ? 'Saving…' : 'Agree and switch on'}
          </button>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setConsentOpen(false)}>
            Not now
          </button>
        </div>
      </BottomSheet>
    </section>
  );
}
