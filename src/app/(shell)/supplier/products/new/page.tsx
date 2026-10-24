import Link from 'next/link';
import { BUTTON_QUIET } from '@/components/common/controls';
import { ProductForm } from '@/components/supplier/product-form';
import { requireSupplierPage } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

/** Adds a product to the supplier's catalogue. */
export default async function NewSupplierProductPage() {
  const { supplierId } = requireSupplierPage(await getPageSession());
  return (
    <div className="flex flex-col gap-4">
      <Link href="/supplier/products" className={`${BUTTON_QUIET} self-start px-0`}>
        ← All products
      </Link>
      <div>
        <h1 className="text-[1.75rem] leading-tight font-bold">Add a product</h1>
        <p className="mt-1 text-base">
          Its first Kongsi round opens as soon as you add it. You can add a photo afterwards.
        </p>
      </div>
      <ProductForm supplierId={supplierId} />
    </div>
  );
}
