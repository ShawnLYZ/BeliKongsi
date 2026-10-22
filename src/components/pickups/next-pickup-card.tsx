import Link from 'next/link';
import type { PickupView } from '@/lib/views/pickups';
import { BUTTON_SECONDARY } from '@/components/common/controls';
import { formatMytDate } from '@/lib/format';
import { PickupCode } from './pickup-code';
import { PickupStatusBadge } from './status-badge';
import { placeLabel } from './steps';

/** The owner home's "Next pickup": place, date, where the goods are and the code. */
export function NextPickupCard({ pickup }: { pickup: PickupView }) {
  return (
    <section
      aria-labelledby="next-pickup-title"
      className="bg-card flex flex-col gap-2 rounded-2xl border p-5"
    >
      <h2 id="next-pickup-title" className="text-lg font-semibold">
        Next pickup
      </h2>
      <p className="text-xl font-bold">{placeLabel(pickup)}</p>
      <p className="text-base">
        <time dateTime={pickup.deliveryDate}>{formatMytDate(pickup.deliveryDate)}</time>
        {pickup.openingHours ? ` · Open ${pickup.openingHours}` : ''}
      </p>
      <p>
        <PickupStatusBadge pickup={pickup} />
      </p>
      {pickup.code ? <PickupCode code={pickup.code} className="mt-1" /> : null}
      <Link
        href={pickup.pickupId ? `/owner/pickups/${pickup.pickupId}` : '/owner/pickups'}
        className={`${BUTTON_SECONDARY} mt-2`}
      >
        {pickup.pickupId ? 'See this pickup' : 'See your pickups'}
      </Link>
    </section>
  );
}
