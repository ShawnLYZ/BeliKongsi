import Link from 'next/link';
import type { ReactNode } from 'react';
import { Bell, History, Inbox } from 'lucide-react';
import { homeFor } from '@/lib/roles';
import type { AccountLike } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { AccountSwitcher, type SwitcherMembership } from './account-switcher';
import { DemoMenu } from './demo-menu';

const ICON_LINK =
  'relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-base font-medium hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white focus-visible:outline-none';

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className="bg-accent text-accent-foreground absolute top-0.5 right-0.5 min-w-5 rounded-full px-1 text-center text-xs leading-5 font-bold tabular-nums"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function ShellLink({
  href,
  label,
  icon,
  count,
  countWord = 'new',
}: {
  href: string;
  label: string;
  icon: ReactNode;
  count?: number;
  countWord?: string;
}) {
  const accessible = count && count > 0 ? `${label}, ${count} ${countWord}` : label;
  return (
    <Link href={href} aria-label={accessible} title={label} className={ICON_LINK}>
      {icon}
      <span aria-hidden className="hidden lg:inline">
        {label}
      </span>
      {count !== undefined ? <CountBadge count={count} /> : null}
    </Link>
  );
}

/**
 * The Orbyte-style top bar: wordmark, business and role switcher with the role badge, the bell,
 * the approvals inbox (not for staff), the activity log and, in demo mode, the demo menu.
 */
export function TopBar({
  displayName,
  userId,
  active,
  memberships,
  accounts,
  unreadCount,
  pendingApprovals,
  demoMode,
  narrow,
}: {
  displayName: string;
  userId: string;
  active: SwitcherMembership;
  memberships: SwitcherMembership[];
  accounts: AccountLike[] | null;
  unreadCount: number;
  /** null hides the approvals link (staff have no approvals). */
  pendingApprovals: number | null;
  demoMode: boolean;
  narrow: boolean;
}) {
  return (
    <header className="bg-topbar text-topbar-foreground">
      <div
        className={cn(
          'mx-auto flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2',
          narrow ? 'max-w-[430px]' : 'max-w-6xl',
        )}
      >
        <Link
          href={homeFor(active.role)}
          className="mr-auto inline-flex min-h-11 items-center rounded-lg text-xl font-bold tracking-tight focus-visible:ring-3 focus-visible:ring-white focus-visible:outline-none"
        >
          BeliKongsi
        </Link>
        <div className={cn('order-last w-full', !narrow && 'sm:order-none sm:w-auto')}>
          <AccountSwitcher
            displayName={displayName}
            userId={userId}
            active={active}
            memberships={memberships}
            accounts={accounts}
          />
        </div>
        <nav aria-label="Shell" className="flex items-center gap-0.5">
          <ShellLink
            href="/notifications"
            label="Notifications"
            icon={<Bell aria-hidden className="size-5" />}
            count={unreadCount}
            countWord="unread"
          />
          {pendingApprovals !== null ? (
            <ShellLink
              href="/approvals"
              label="Approvals"
              icon={<Inbox aria-hidden className="size-5" />}
              count={pendingApprovals}
              countWord="pending"
            />
          ) : null}
          <ShellLink
            href="/activity"
            label="Activity log"
            icon={<History aria-hidden className="size-5" />}
          />
          {demoMode ? <DemoMenu /> : null}
        </nav>
      </div>
    </header>
  );
}
