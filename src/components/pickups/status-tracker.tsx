import { Check } from 'lucide-react';
import type { PickupView } from '@/lib/views/pickups';
import { cn } from '@/lib/utils';
import { trackerSteps } from './steps';

/** Where the goods are: story 71's steps in order, with the current one marked. */
export function StatusTracker({ pickup }: { pickup: PickupView }) {
  const steps = trackerSteps(pickup);
  return (
    <ol aria-label="Where your goods are" className="flex flex-col gap-1">
      {steps.map((step) => (
        <li
          key={step.label}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className={cn(
            'flex min-h-11 items-center gap-3 rounded-xl px-3 text-base',
            step.state === 'current' && 'bg-primary/10 font-bold',
            step.state === 'todo' && 'text-muted-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full border-2',
              step.state === 'done' && 'border-primary bg-primary text-primary-foreground',
              step.state === 'current' && 'border-primary bg-card',
              step.state === 'todo' && 'border-input/50 bg-card',
            )}
          >
            {step.state === 'done' ? <Check className="size-4" /> : null}
            {step.state === 'current' ? <span className="bg-primary size-3 rounded-full" /> : null}
          </span>
          <span>
            {step.label}
            <span className="sr-only">
              {step.state === 'done' ? ' (done)' : step.state === 'current' ? ' (now)' : ''}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
