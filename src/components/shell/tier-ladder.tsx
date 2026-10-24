import { cn } from '@/lib/utils';

/** The PRD glossary's example tiers for one product, in cartons. Illustration only. */
const TIERS = [
  { min: 20, price: 'RM 158.00' },
  { min: 50, price: 'RM 152.00' },
  { min: 100, price: 'RM 146.00' },
] as const;

/** Three made-up shops' cartons in one round. */
const SHOPS = [18, 28, 18] as const;
const SCALE = 120;
const COMBINED = SHOPS.reduce((a, b) => a + b, 0);
const REACHED = [...TIERS].reverse().find((t) => COMBINED >= t.min)!;

const pct = (n: number) => `${(n / SCALE) * 100}%`;

/**
 * Shows the Kongsi mechanism on the sign-in page: several small orders fill one bar until the
 * combined quantity crosses a cheaper price tier. The bar fills once on load (CSS only).
 */
export function TierLadder({ className }: { className?: string }) {
  return (
    <figure
      className={cn(
        'rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/10 ring-inset sm:p-6',
        className,
      )}
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-base font-semibold text-white">One round, three shops</span>
        <span className="text-topbar-muted text-sm">Example · made-up numbers</span>
      </figcaption>

      <div className="relative mt-9 mb-2" aria-hidden="true">
        {TIERS.map((t) => (
          <span
            key={t.min}
            className="absolute -top-7 -translate-x-1/2 text-sm font-medium text-white/70 tabular-nums"
            style={{ left: pct(t.min) }}
          >
            {t.min}+
          </span>
        ))}
        <div className="relative h-4 overflow-hidden rounded-full bg-white/10">
          <div className="tier-fill flex h-full" style={{ width: pct(COMBINED) }}>
            {SHOPS.map((qty, i) => (
              <span
                key={i}
                className={cn(
                  'h-full border-r-2 border-[#10243f] last:border-r-0',
                  i === 1 ? 'bg-[#2bb3a5]' : 'bg-[#14a094]',
                )}
                style={{ width: `${(qty / COMBINED) * 100}%` }}
              />
            ))}
          </div>
        </div>
        {TIERS.map((t) => (
          <span
            key={t.min}
            className="absolute top-[-4px] h-6 w-0.5 -translate-x-1/2 rounded-full bg-white/45"
            style={{ left: pct(t.min) }}
          />
        ))}
      </div>

      <p className="text-topbar-muted mt-3 text-base">
        Three shops order {SHOPS.join(', ')} cartons. Together that is{' '}
        <strong className="font-semibold text-white tabular-nums">{COMBINED} cartons</strong>, past
        the 50+ tier.
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {TIERS.map((t) => {
          const reached = t === REACHED;
          return (
            <div
              key={t.min}
              className={cn(
                'rounded-xl px-3 py-2.5 ring-1 ring-inset',
                reached ? 'bg-accent text-accent-foreground ring-transparent' : 'ring-white/12',
              )}
            >
              <dt className={cn('text-sm', reached ? 'font-semibold' : 'text-topbar-muted')}>
                {t.min}+ cartons
              </dt>
              <dd
                className={cn(
                  'text-base font-bold tabular-nums',
                  reached ? 'text-accent-foreground' : 'text-white/80',
                )}
              >
                {t.price}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-topbar-muted mt-3 text-sm">
        Everyone in the round pays the tier price reached at cut-off. Anything paid above it goes
        back to each shop&apos;s balance.
      </p>
    </figure>
  );
}
