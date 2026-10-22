import type { CatalogueItemView } from '@/lib/views/catalogue';
import type { OpenRoundView } from '@/lib/views/rounds';
import { EmptyState } from '@/components/common/empty-state';
import { RoundCard } from '@/components/rounds/round-card';
import { resolveClock } from '@/server/adapters/clock';
import { searchCatalogue } from '@/server/modules/catalogue/catalogue';
import { listOpenRounds } from '@/server/modules/rounds/read';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerRoundsPage() {
  const { session } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  const caller = personCaller(session);
  const [rounds, catalogue, clock] = await Promise.all([
    listOpenRounds(deps, caller) as Promise<OpenRoundView[]>,
    searchCatalogue(deps, caller, null) as Promise<CatalogueItemView[]>,
    resolveClock(deps),
  ]);
  const products = new Map(catalogue.map((p) => [p.productId, p]));
  const serverNow = clock.now().toISOString();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Open Kongsi rounds</h1>
        <p className="text-base">
          The more shops order, the lower the price for everyone. Prices are per unit.
        </p>
      </div>
      {rounds.length === 0 ? (
        <EmptyState
          title="No open rounds right now"
          explanation="Rounds for each product open every week (cups every fortnight). They appear here with their prices and cut-off."
          example="Sweetened condensed milk 390 g, 99 cartons from 14 shops, cut-off Thu 8 pm."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {rounds.map((r) => (
            <li key={r.roundId}>
              <RoundCard
                round={r}
                supplierName={products.get(r.productId)?.supplierName ?? null}
                category={products.get(r.productId)?.category ?? ''}
                serverNow={serverNow}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
