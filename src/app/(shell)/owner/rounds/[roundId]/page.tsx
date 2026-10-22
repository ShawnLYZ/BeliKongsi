import { notFound } from 'next/navigation';
import type { CatalogueItemView } from '@/lib/views/catalogue';
import type { ShopSettingsView } from '@/lib/views/directory';
import type { RoundDetailView } from '@/lib/views/rounds';
import { RoundDetail } from '@/components/rounds/round-detail';
import { resolveClock } from '@/server/adapters/clock';
import { searchCatalogue } from '@/server/modules/catalogue/catalogue';
import { getShopSettings } from '@/server/modules/directory/directory';
import { getRoundForCaller } from '@/server/modules/rounds/read';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { AppError } from '@/server/platform/errors';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OwnerRoundPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const { roundId } = await params;
  if (!UUID.test(roundId)) notFound();
  const caller = personCaller(session);

  let round: RoundDetailView;
  try {
    round = (await getRoundForCaller(deps, caller, roundId)) as RoundDetailView;
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  const [catalogue, clock, settings] = await Promise.all([
    searchCatalogue(deps, caller, null) as Promise<CatalogueItemView[]>,
    resolveClock(deps),
    getShopSettings(deps, caller, shopId) as Promise<ShopSettingsView>,
  ]);
  const product = catalogue.find((p) => p.productId === round.productId);

  return (
    <RoundDetail
      round={round}
      supplierName={product?.supplierName ?? null}
      category={product?.category ?? ''}
      serverNow={clock.now().toISOString()}
      settings={settings}
    />
  );
}
