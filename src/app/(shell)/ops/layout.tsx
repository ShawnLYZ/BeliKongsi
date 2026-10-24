import type { ReactNode } from 'react';
import { SubNav } from '@/components/common/sub-nav';

const ITEMS = [
  { href: '/ops', label: 'Approvals', exact: true },
  { href: '/ops/rounds', label: 'Rounds' },
  { href: '/ops/consignments', label: 'Consignments' },
  { href: '/ops/money', label: 'Money' },
  { href: '/ops/impact', label: 'Impact' },
  { href: '/ops/events', label: 'Integration events' },
  { href: '/activity', label: 'Activity log' },
];

export default function OpsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SubNav label="Ops pages" items={ITEMS} />
      {children}
    </>
  );
}
