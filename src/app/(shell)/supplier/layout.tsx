import type { ReactNode } from 'react';
import { SubNav } from '@/components/common/sub-nav';

const ITEMS = [
  { href: '/supplier', label: 'Orders', exact: true },
  { href: '/supplier/rounds', label: 'Open rounds' },
  { href: '/supplier/products', label: 'Products' },
  { href: '/supplier/payouts', label: 'Payouts' },
];

export default function SupplierLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SubNav label="Supplier pages" items={ITEMS} />
      {children}
    </>
  );
}
