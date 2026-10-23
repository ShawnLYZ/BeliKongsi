import Link from 'next/link';
import type { TimeSavedView } from '@/lib/views/savings';
import { LINK } from '@/components/ops/labels';
import { duration } from '@/lib/duration';

/** The owner's time saved this month, always labelled Estimated (it rests on their own guess). */
export function TimeSavedCard({ view }: { view: TimeSavedView }) {
  return (
    <section
      aria-labelledby="time-saved"
      className="bg-card flex flex-col gap-1 rounded-2xl border p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="time-saved" className="text-lg font-semibold">
          Time saved
        </h3>
        <span className="bg-accent text-accent-foreground rounded-md px-2 py-0.5 text-base font-semibold">
          Estimated
        </span>
      </div>
      {view.oldMinutesPerWeek === null ? (
        <p className="text-base">
          Tell us how long ordering used to take you and we will estimate the time you save.{' '}
          <Link href="/owner/settings" className={LINK}>
            Add it in Settings
          </Link>
        </p>
      ) : (
        <>
          <p className="text-3xl font-bold tabular-nums">{duration(view.totalSavedMinutes)}</p>
          <p className="text-base tabular-nums">
            Compared with the {duration(view.oldMinutesPerWeek)} a week you said ordering used to
            take. It counts the time from opening your basket to paying it.
          </p>
          {view.weeks.length > 0 ? (
            <ul className="mt-2 flex flex-col divide-y text-base tabular-nums">
              {view.weeks.map((w) => (
                <li key={w.week} className="flex flex-wrap justify-between gap-x-3 py-2">
                  <span>
                    Week {Number(w.week.slice(-2))}: took {duration(w.measuredMinutes)}
                  </span>
                  <span className="font-semibold">saved {duration(w.savedMinutes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-base">No paid baskets this month yet.</p>
          )}
        </>
      )}
    </section>
  );
}
