import type { ShopSettingsView } from '@/lib/views/directory';
import { SetupFlow } from '@/components/setup/setup-flow';
import { getShopSettings, listPickupPointsForShop } from '@/server/modules/directory/directory';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerSetupPage() {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  const caller = personCaller(session);
  const [settings, points] = await Promise.all([
    getShopSettings(deps, caller, shopId) as Promise<ShopSettingsView>,
    listPickupPointsForShop(deps, caller),
  ]);
  return (
    <SetupFlow
      shopId={shopId}
      settings={settings}
      points={points}
      alreadyDone={settings.setupCompleted}
    />
  );
}
