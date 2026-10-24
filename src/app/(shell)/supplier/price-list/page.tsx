import { PriceListImport } from '@/components/supplier/price-list-import';
import { requireSupplierPage } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/** Reads a pasted or photographed price list into drafted tiers for the supplier to check. */
export default async function SupplierPriceListPage() {
  const { supplierId } = requireSupplierPage(await getPageSession());
  return <PriceListImport supplierId={supplierId} />;
}
