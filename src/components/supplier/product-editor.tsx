import Link from 'next/link';
import type { SupplierProductView } from '@/lib/views/supplier';
import { BUTTON_QUIET } from '@/components/common/controls';
import { ProductActiveSwitch } from './product-active-switch';
import { ProductForm } from './product-form';
import { ProductPhoto } from './product-photo';

/** One product's page for its supplier: photo, on sale or not, and every field with its tiers. */
export function ProductEditor({
  supplierId,
  product,
}: {
  supplierId: string;
  product: SupplierProductView;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/supplier/products" className={`${BUTTON_QUIET} self-start px-0`}>
        ← All products
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{product.name}</h1>
        <p className="mt-1 text-base">
          The open round keeps the prices it opened with. What you save here reaches shops from the
          next round.
        </p>
      </div>
      <ProductPhoto supplierId={supplierId} product={product} />
      <ProductActiveSwitch
        supplierId={supplierId}
        productId={product.productId}
        active={product.active}
      />
      <ProductForm supplierId={supplierId} product={product} />
    </div>
  );
}
