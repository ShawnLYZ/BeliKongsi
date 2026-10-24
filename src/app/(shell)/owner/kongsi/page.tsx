import Link from 'next/link';
import { BUTTON_PRIMARY } from '@/components/common/controls';
import { EmptyState } from '@/components/common/empty-state';
import { KongsiTabs, type KongsiTab } from '@/components/kongsi/kongsi-tabs';
import { ParticipationList } from '@/components/kongsi/participation-list';
import { resolveClock } from '@/server/adapters/clock';
import { listShopParticipations } from '@/server/modules/payments/participations';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

const PAGE_SIZE = 20;

const INTRO: Record<KongsiTab, string> = {
  active:
    'Your orders waiting for their cut-off. You can cancel a line before its cut-off for a full refund to your balance.',
  history:
    'Your orders after their cut-off: how each round closed, what you paid and what came back to your balance.',
};

export default async function OwnerKongsiPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const query = await searchParams;
  const tab: KongsiTab = query.tab === 'history' ? 'history' : 'active';
  const [page, clock] = await Promise.all([
    listShopParticipations(deps, personCaller(session), shopId, {
      status: tab,
      cursor: null,
      limit: PAGE_SIZE,
    }),
    resolveClock(deps),
  ]);
  const serverNow = clock.now().toISOString();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-bold">My Kongsi</h1>
        <p className="text-base">{INTRO[tab]}</p>
      </div>
      <KongsiTabs current={tab} />
      {page.items.length === 0 ? (
        tab === 'active' ? (
          <EmptyState
            title="No Kongsi orders waiting"
            explanation="When you pay your weekly basket or join a round, each order shows here until its cut-off."
            example="6 cartons of condensed milk, paid RM 984.54. Waiting for cut-off."
          >
            <Link href="/owner/rounds" className={`${BUTTON_PRIMARY} mt-4 w-full`}>
              See open rounds
            </Link>
          </EmptyState>
        ) : (
          <EmptyState
            title="No results yet"
            explanation="After a cut-off, each order shows here with how its round closed and any money back in your balance."
            example="Kept at tier 3: RM 151.85 all-in. Refund: RM 73.44."
          />
        )
      ) : (
        <ParticipationList
          // A refresh (after a cancel or a skip) starts the list again from the server's page.
          key={serverNow}
          shopId={shopId}
          status={tab}
          initialItems={page.items}
          initialCursor={page.nextCursor}
          serverNow={serverNow}
        />
      )}
    </div>
  );
}
