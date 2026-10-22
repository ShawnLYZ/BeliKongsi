import { ProductList } from '@/components/supplier/product-list';
import { listSupplierProducts } from '@/server/modules/supplier-orders/portal';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { requireSupplierPage } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/** The supplier's products and price tiers, read-only. */
export default async function SupplierProductsPage() {
  const { session, supplierId } = requireSupplierPage(await getPageSession());
  const products = await listSupplierProducts(getDeps(), personCaller(session), supplierId);
  return <ProductList products={products} />;
}
