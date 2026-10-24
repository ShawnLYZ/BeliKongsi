import { OpenRoundList } from '@/components/supplier/open-round-list';
import { listSupplierRounds } from '@/server/modules/supplier-orders/portal';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireSupplierPage } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/** Open Kongsi rounds for this supplier's products: totals and shop counts only (PRD §15). */
export default async function SupplierRoundsPage() {
  const { session, supplierId } = requireSupplierPage(await getPageSession());
  const deps = getDeps();
  scheduleDueWork(deps);
  const rounds = await listSupplierRounds(deps, personCaller(session), supplierId);
  return <OpenRoundList rounds={rounds} />;
}
