import Link from 'next/link';
import {
  ChevronRight,
  Handshake,
  ListChecks,
  PackageOpen,
  PiggyBank,
  Settings,
  ShoppingBasket,
  Users,
  Wallet,
} from 'lucide-react';
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
  { href: '/owner/basket', label: "This week's basket", icon: ShoppingBasket },
  { href: '/owner/rounds', label: 'Open Kongsi rounds', icon: Users },
  { href: '/owner/kongsi', label: 'My Kongsi', icon: Handshake },
  { href: '/owner/pickups', label: 'Pickups', icon: PackageOpen },
  { href: '/owner/savings', label: 'Savings', icon: PiggyBank },
  { href: '/owner/money', label: 'Money history', icon: Wallet },
  { href: '/owner/usual-list', label: 'Your usual list', icon: ListChecks },
  { href: '/owner/settings', label: 'Settings', icon: Settings },
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
      <h1 className="text-[1.75rem] leading-tight font-bold">{session.membership.orgName}</h1>
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
        <ul className="bg-card flex flex-col divide-y overflow-hidden rounded-2xl border">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="group focus-visible:ring-ring/60 hover:bg-muted/60 flex min-h-13 items-center gap-3 px-4 text-base font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-inset"
              >
                <span className="bg-primary-soft text-primary-hover grid size-8 shrink-0 place-items-center rounded-lg">
                  <Icon aria-hidden="true" className="size-[18px]" />
                </span>
                <span className="mr-auto">{label}</span>
                <ChevronRight
                  aria-hidden="true"
                  className="text-muted-foreground size-5 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
