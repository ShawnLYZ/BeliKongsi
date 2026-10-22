import Link from 'next/link';
import { cn } from '@/lib/utils';

export type KongsiTab = 'active' | 'history';

const TABS: { tab: KongsiTab; label: string }[] = [
  { tab: 'active', label: 'Active' },
  { tab: 'history', label: 'History' },
];

/** "Active" and "History" on My Kongsi, as links so each tab has its own address. */
export function KongsiTabs({ current }: { current: KongsiTab }) {
  return (
    <nav aria-label="My Kongsi" className="bg-muted flex gap-1 rounded-xl p-1">
      {TABS.map(({ tab, label }) => {
        const selected = tab === current;
        return (
          <Link
            key={tab}
            href={tab === 'active' ? '/owner/kongsi' : '/owner/kongsi?tab=history'}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-ring/60 inline-flex min-h-12 flex-1 items-center justify-center rounded-lg px-3 text-base font-semibold outline-none focus-visible:ring-3',
              selected
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-card/60',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
