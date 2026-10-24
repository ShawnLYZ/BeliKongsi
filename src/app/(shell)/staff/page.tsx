import Link from 'next/link';
import { PackageCheck, PlusCircle } from 'lucide-react';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

const BIG =
  'focus-visible:ring-ring/60 flex min-h-28 items-center gap-4 rounded-2xl px-5 py-4 text-xl font-bold outline-none focus-visible:ring-3';

// Staff see no money anywhere: nothing on this page shows an amount.
export default async function StaffHomePage() {
  const session = requirePageRole(await getPageSession(), ['staff']);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[1.75rem] leading-tight font-bold">Hi, {session.displayName}</h1>
      <nav aria-label="Staff tasks" className="flex flex-col gap-4">
        <Link
          href="/staff/add"
          className={`${BIG} bg-primary text-primary-foreground hover:bg-primary-hover`}
        >
          <PlusCircle aria-hidden="true" className="size-9 shrink-0" />
          Add to next basket
        </Link>
        <Link
          href="/staff/deliveries"
          className={`${BIG} border-input/50 bg-card hover:bg-muted border-2`}
        >
          <PackageCheck aria-hidden="true" className="size-9 shrink-0" />
          Confirm delivery
        </Link>
      </nav>
    </div>
  );
}
