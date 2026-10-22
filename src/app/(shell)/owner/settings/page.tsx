import type { ShopSettingsView } from '@/lib/views/directory';
import { FulfilmentPicker } from '@/components/fulfilment/fulfilment-picker';
import { getShopSettings, listPickupPointsForShop } from '@/server/modules/directory/directory';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerSettingsPage() {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const caller = personCaller(session);
  const [settings, points] = await Promise.all([
    getShopSettings(deps, caller, shopId) as Promise<ShopSettingsView>,
    listPickupPointsForShop(deps, caller),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <h2 className="mt-3 text-xl font-semibold">How you get your goods</h2>
        <p className="text-base">
          Your usual choice for every basket. You can still switch for a single week.
        </p>
      </div>
      <FulfilmentPicker shopId={shopId} settings={settings} points={points} submitLabel="Save" />
    </div>
  );
}
