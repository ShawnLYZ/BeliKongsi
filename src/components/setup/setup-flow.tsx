'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import type { PickupPointView, ShopSettingsView } from '@/lib/views/directory';
import type { ParseView, UsualListView } from '@/lib/views/usual-list';
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from '@/components/common/controls';
import { FulfilmentPicker } from '@/components/fulfilment/fulfilment-picker';
import { PasteStep } from './paste-step';
import { ReviewList } from './review-list';
import { draftLinesFromParse } from './review-lines';

type Stage =
  | { step: 1; phase: 'paste' }
  | { step: 1; phase: 'review'; parse: ParseView | null; attempt: number }
  | { step: 2; list: UsualListView }
  | { step: 3; list: UsualListView; settings: ShopSettingsView };

const STEP_TITLES = ['Your usual order', 'Pickup or delivery', 'Done'] as const;

function StepHeader({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-base font-medium">
        Step {step} of 3: {STEP_TITLES[step - 1]}
      </p>
      <ol aria-hidden="true" className="flex gap-2">
        {[1, 2, 3].map((n) => (
          <li
            key={n}
            className={
              n <= step ? 'bg-primary h-2 flex-1 rounded-full' : 'bg-muted h-2 flex-1 rounded-full'
            }
          />
        ))}
      </ol>
    </div>
  );
}

/** Owner setup (PRD §22): paste and review the usual list, choose pickup or delivery, done. */
export function SetupFlow({
  shopId,
  settings,
  points,
  alreadyDone,
}: {
  shopId: string;
  settings: ShopSettingsView;
  points: PickupPointView[];
  alreadyDone: boolean;
}) {
  const [stage, setStage] = useState<Stage>({ step: 1, phase: 'paste' });
  const [attempts, setAttempts] = useState(0);

  function review(parse: ParseView | null) {
    setAttempts((n) => n + 1);
    setStage({ step: 1, phase: 'review', parse, attempt: attempts + 1 });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-[1.75rem] leading-tight font-bold">Set up BeliKongsi</h1>
        {alreadyDone && stage.step === 1 ? (
          <p className="text-base">
            Your setup is already done. Going through it again replaces your usual list.
          </p>
        ) : null}
      </div>
      <StepHeader step={stage.step} />

      {stage.step === 1 && stage.phase === 'paste' ? (
        <PasteStep shopId={shopId} onRead={review} onUseForm={() => review(null)} />
      ) : null}

      {stage.step === 1 && stage.phase === 'review' ? (
        <ReviewList
          key={stage.attempt}
          shopId={shopId}
          initialLines={stage.parse ? draftLinesFromParse(stage.parse) : []}
          suggestionRunId={stage.parse?.suggestionRunId ?? null}
          ignoredText={stage.parse?.ignoredText ?? []}
          onConfirmed={(list) => setStage({ step: 2, list })}
          onStartOver={() => setStage({ step: 1, phase: 'paste' })}
        />
      ) : null}

      {stage.step === 2 ? (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-semibold">Pickup or delivery</h2>
            <p className="text-base">
              Your usual list is saved ({stage.list.items.length}{' '}
              {stage.list.items.length === 1 ? 'item' : 'items'}). Now choose how you get your goods
              each week. You can change this for any week later.
            </p>
          </div>
          <FulfilmentPicker
            shopId={shopId}
            settings={settings}
            points={points}
            submitLabel="Save and continue"
            onSaved={(saved) => setStage({ step: 3, list: stage.list, settings: saved })}
          />
        </div>
      ) : null}

      {stage.step === 3 ? (
        <section className="bg-card flex flex-col gap-4 rounded-2xl border p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <CheckCircle2 aria-hidden="true" className="text-primary size-6 shrink-0" />
            You&apos;re all set
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-base">
            <li>
              Your usual list has {stage.list.items.length}{' '}
              {stage.list.items.length === 1 ? 'item' : 'items'}.
            </li>
            <li>
              {stage.settings.defaultFulfilment === 'door'
                ? 'Your goods are delivered to your door.'
                : `You collect your goods from ${stage.settings.pickupPoint?.name ?? 'your pickup point'}.`}
            </li>
            <li>
              Your usual list is saved. Each week your basket will be drafted from it, for you to
              check and approve before the cut-off.
            </li>
          </ul>
          <Link href="/owner/basket" className={BUTTON_PRIMARY}>
            Go to my basket
          </Link>
          <Link href="/owner/rounds" className={BUTTON_SECONDARY}>
            See open Kongsi rounds
          </Link>
        </section>
      ) : null}
    </div>
  );
}
