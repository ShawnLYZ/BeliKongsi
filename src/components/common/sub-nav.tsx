'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export type SubNavItem = { href: string; label: string; exact?: boolean };

/** A row of section links for one role's pages, with the current page marked. */
export function SubNav({ label, items }: { label: string; items: SubNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-4 mb-6 border-b px-4 lg:mx-0 lg:px-0">
      <ul className="-mb-px flex [scrollbar-width:none] gap-1 overflow-x-auto">
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
                  'focus-visible:ring-ring/60 inline-flex min-h-12 items-center rounded-t-lg border-b-[3px] px-3 text-base font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-inset',
                  current
                    ? 'border-primary text-primary-hover'
                    : 'text-muted-foreground hover:border-input/40 hover:text-foreground border-transparent',
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
