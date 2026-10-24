import Link from 'next/link';
import type { ReactNode } from 'react';
import { Bell, History, Inbox } from 'lucide-react';
import { homeFor } from '@/lib/roles';
import type { AccountLike } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { AccountSwitcher, type SwitcherMembership } from './account-switcher';
import { Wordmark } from './brand-mark';
import { DemoMenu } from './demo-menu';

const ICON_LINK =
  'relative inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-2.5 text-base font-medium text-topbar-muted transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-3 focus-visible:ring-white focus-visible:outline-none';

function CountBadge({ count, word }: { count: number; word: string }) {
  if (count <= 0) return null;
  // Icon-only (narrow): a corner badge on the icon. With the label showing (lg): inline after it.
  return (
    <span className="bg-accent text-accent-foreground ring-topbar absolute top-0.5 right-0 min-w-5 rounded-full px-1 text-center text-xs leading-5 font-bold tabular-nums ring-2 lg:static lg:ring-0">
      {count > 99 ? '99+' : count}
      <span className="sr-only"> {word}</span>
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
  // The name is the visible text (label, then count), so it matches what sighted users see.
  return (
    <Link href={href} title={label} className={ICON_LINK}>
      {icon}
      <span className="sr-only lg:not-sr-only">{label}</span>
      {count !== undefined ? <CountBadge count={count} word={countWord} /> : null}
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
    <header className="bg-topbar text-topbar-foreground border-b border-white/[0.06]">
      <div
        className={cn(
          'mx-auto flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5',
          narrow ? 'max-w-[430px]' : 'max-w-6xl',
        )}
      >
        <Link
          href={homeFor(active.role)}
          aria-label="BeliKongsi"
          className="mr-auto inline-flex min-h-11 items-center rounded-lg pr-1 focus-visible:ring-3 focus-visible:ring-white focus-visible:outline-none"
        >
          <Wordmark />
        </Link>
        <div className={cn('order-last w-full', !narrow && 'sm:order-none sm:mr-2 sm:w-auto')}>
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
