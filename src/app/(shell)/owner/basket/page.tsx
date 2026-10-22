import Link from 'next/link';
import type { OwnerBasketView } from '@/lib/views/baskets';
import type { ShopSettingsView } from '@/lib/views/directory';
import { BasketScreen } from '@/components/baskets/basket-screen';
import { BUTTON_PRIMARY } from '@/components/common/controls';
import { EmptyState } from '@/components/common/empty-state';
import { resolveClock } from '@/server/adapters/clock';
import { getCurrentBasket } from '@/server/modules/baskets/basket';
import { getShopSettings } from '@/server/modules/directory/directory';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerBasketPage() {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const caller = personCaller(session);
  const [basket, settings, clock] = await Promise.all([
    getCurrentBasket(deps, caller, shopId) as Promise<OwnerBasketView | null>,
    getShopSettings(deps, caller, shopId) as Promise<ShopSettingsView>,
    resolveClock(deps),
  ]);

  if (!basket) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">This week&apos;s basket</h1>
        <EmptyState
          title="No basket this week yet"
          explanation="Your weekly basket is drafted from your usual list every Monday at 6 am. You approve and pay it here."
          example="5 items, pay now RM 1,848.60, Estimated RM 1,790.10 after cut-off."
        >
          {!settings.setupCompleted ? (
            <Link href="/owner/setup" className={`${BUTTON_PRIMARY} mt-4 w-full`}>
              Finish setup
            </Link>
          ) : null}
        </EmptyState>
      </div>
    );
  }
  return <BasketScreen basket={basket} settings={settings} serverNow={clock.now().toISOString()} />;
}
