'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export type SubNavItem = { href: string; label: string; exact?: boolean };

/** A row of section links for one role's pages, with the current page marked. */
export function SubNav({ label, items }: { label: string; items: SubNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="mb-5">
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => {
          const current = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring/60 inline-flex min-h-11 items-center rounded-xl border-2 px-4 text-base font-semibold whitespace-nowrap outline-none focus-visible:ring-3',
                  current
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input/50 bg-card hover:bg-muted',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
