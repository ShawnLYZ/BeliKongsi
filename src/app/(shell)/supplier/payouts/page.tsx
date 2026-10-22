import { PayoutList } from '@/components/supplier/payout-list';
import { listSupplierPayouts } from '@/server/modules/supplier-orders/portal';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { requireSupplierPage } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/** Payments released after each hub check, for good units only. No real money moves. */
export default async function SupplierPayoutsPage() {
  const { session, supplierId } = requireSupplierPage(await getPageSession());
  const payouts = await listSupplierPayouts(getDeps(), personCaller(session), supplierId);
  return <PayoutList payouts={payouts} />;
}
