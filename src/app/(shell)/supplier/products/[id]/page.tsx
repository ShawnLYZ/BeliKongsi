import { notFound } from 'next/navigation';
import { ProductEditor } from '@/components/supplier/product-editor';
import { listSupplierProducts } from '@/server/modules/supplier-orders/portal';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { requireSupplierPage } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/** One of the supplier's products, to edit. */
export default async function SupplierProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, supplierId } = requireSupplierPage(await getPageSession());
  const { id } = await params;
  const products = await listSupplierProducts(getDeps(), personCaller(session), supplierId);
  // Only this supplier's own products are listed, so another supplier's id is simply not found.
  const product = products.find((p) => p.productId === id);
  if (!product) notFound();
  return <ProductEditor supplierId={supplierId} product={product} />;
}
