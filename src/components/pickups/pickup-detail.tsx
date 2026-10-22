import type { PickupView } from '@/lib/views/pickups';
import { PickupCode } from './pickup-code';
import { PickupFacts } from './pickup-facts';
import { StatusTracker } from './status-tracker';
import { canHandOver, isHandedOver } from './steps';

function codeNote(pickup: PickupView): string {
  if (isHandedOver(pickup)) return 'This code has been used.';
  if (canHandOver(pickup)) {
    return pickup.destinationType === 'door'
      ? 'Give this code to the driver when your goods arrive.'
      : 'Show this code at the counter to collect your goods.';
  }
  return 'Keep this code. It works once your goods are ready.';
}

/** The owner's view of one pickup: the large code, where the goods are, and what is in it. */
export function PickupDetail({ pickup }: { pickup: PickupView }) {
  return (
    <div className="flex flex-col gap-4">
      {pickup.code ? (
        <section
          aria-label="Pickup code"
          className="border-primary bg-card flex flex-col gap-2 rounded-2xl border-2 p-5"
        >
          <PickupCode code={pickup.code} />
          <p className="text-base">{codeNote(pickup)}</p>
        </section>
      ) : null}
      <PickupFacts pickup={pickup} />
      <section
        aria-labelledby="pickup-tracker"
        className="bg-card flex flex-col gap-2 rounded-2xl border p-5"
      >
        <h2 id="pickup-tracker" className="text-lg font-semibold">
          Where your goods are
        </h2>
        <StatusTracker pickup={pickup} />
      </section>
    </div>
  );
}
