import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ShopSettingsView } from '@/lib/views/directory';
import { BasketCard } from '@/components/baskets/basket-card';
import { BUTTON_PRIMARY } from '@/components/common/controls';
import { EmptyState } from '@/components/common/empty-state';
import { BalanceCard } from '@/components/home/balance-card';
import { SavingsCard } from '@/components/home/savings-card';
import { NextPickupCard } from '@/components/pickups/next-pickup-card';
import { resolveClock } from '@/server/adapters/clock';
import { getShopSettings } from '@/server/modules/directory/directory';
import { homeSummary } from '@/server/modules/savings/savings';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

const LINKS = [
  { href: '/owner/basket', label: "This week's basket" },
  { href: '/owner/rounds', label: 'Open Kongsi rounds' },
  { href: '/owner/kongsi', label: 'My Kongsi' },
  { href: '/owner/pickups', label: 'Pickups' },
  { href: '/owner/savings', label: 'Savings' },
  { href: '/owner/money', label: 'Money history' },
  { href: '/owner/usual-list', label: 'Your usual list' },
  { href: '/owner/settings', label: 'Settings' },
] as const;

export default async function OwnerHomePage() {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const caller = personCaller(session);
  const [settings, home, clock] = await Promise.all([
    getShopSettings(deps, caller, shopId) as Promise<ShopSettingsView>,
    homeSummary(deps, caller, shopId),
    resolveClock(deps),
  ]);
  const { basket, nextPickup, savingsThisMonth } = home;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{session.membership.orgName}</h1>
      {!settings.setupCompleted ? (
        <section className="border-accent bg-accent/15 flex flex-col gap-3 rounded-2xl border-2 p-5">
          <h2 className="text-lg font-semibold">Finish setup</h2>
          <p className="text-base">
            Paste an old order to build your usual list, then choose a pickup point. It takes about
            two minutes.
          </p>
          <Link href="/owner/setup" className={BUTTON_PRIMARY}>
            Finish setup
          </Link>
        </section>
      ) : null}
      {basket ? (
        <BasketCard basket={basket} serverNow={clock.now().toISOString()} />
      ) : (
        <EmptyState
          title="This week's basket"
          explanation="Your weekly basket appears here every Monday at 6 am."
          example="5 items, RM 1,630.20."
        />
      )}
      {nextPickup ? (
        <NextPickupCard pickup={nextPickup} />
      ) : (
        <EmptyState
          title="Next pickup"
          explanation="Once you have paid, where and when to collect your goods appears here, with your pickup code."
          example="Ipoh pickup point, Tue 11 Nov, code 482 913."
        />
      )}
      <SavingsCard
        verifiedSen={savingsThisMonth.verifiedSen}
        estimatedSen={savingsThisMonth.estimatedSen}
      />
      <BalanceCard balanceSen={home.balanceSen} pendingApprovals={home.pendingApprovals} />
      <nav aria-label="Owner pages">
        <ul className="bg-card flex flex-col divide-y rounded-2xl border">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="focus-visible:ring-ring/60 hover:bg-muted flex min-h-12 items-center justify-between rounded-2xl px-4 text-base font-semibold outline-none focus-visible:ring-3"
              >
                {l.label}
                <ChevronRight aria-hidden="true" className="size-5" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
