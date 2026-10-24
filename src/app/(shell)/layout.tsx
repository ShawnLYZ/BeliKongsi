import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PhoneColumn } from '@/components/common/phone-column';
import { MadeUpDataBanner } from '@/components/shell/made-up-data-banner';
import { TopBar } from '@/components/shell/top-bar';
import { usesPhoneColumn } from '@/lib/roles';
import { listPendingApprovals } from '@/server/modules/approvals/approvals';
import { getDemoState } from '@/server/modules/demo/demo';
import { listSignInAccounts, sessionView } from '@/server/modules/identity/identity';
import { countUnreadNotifications } from '@/server/modules/notifications/query';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { getPageSession } from '@/server/platform/session-page';

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const session = await getPageSession();
  if (!session) redirect('/sign-in');

  const deps = getDeps();
  const caller = personCaller(session);
  const { role } = session.membership;
  const [demo, view, unreadCount, pendingApprovals] = await Promise.all([
    getDemoState(deps),
    sessionView(deps, session),
    countUnreadNotifications(deps, caller),
    // Staff have no approvals inbox (the API answers 403), so the link is hidden.
    role === 'staff' ? null : listPendingApprovals(deps, caller).then((items) => items.length),
  ]);
  const accounts = demo.demoMode ? await listSignInAccounts(deps) : null;
  const narrow = usesPhoneColumn(role);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="focus:bg-card sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:px-4 focus:py-3 focus:text-base focus:font-semibold"
      >
        Skip to content
      </a>
      <TopBar
        displayName={session.displayName}
        userId={session.userId}
        active={view.activeMembership}
        memberships={view.memberships}
        accounts={accounts}
        unreadCount={unreadCount}
        pendingApprovals={pendingApprovals}
        demoMode={demo.demoMode}
        narrow={narrow}
      />
      {demo.demoMode ? <MadeUpDataBanner text={demo.bannerText} narrow={narrow} /> : null}
      <main
        id="main"
        className={narrow ? 'flex-1 px-4 pt-6 pb-8' : 'flex-1 px-4 pt-7 pb-10 lg:px-6'}
      >
        {narrow ? (
          <PhoneColumn>{children}</PhoneColumn>
        ) : (
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        )}
      </main>
      <footer className="px-4 pb-6">
        <div
          className={cn(
            'text-muted-foreground mx-auto flex w-full flex-wrap items-center justify-between gap-x-4 border-t pt-3',
            narrow ? 'max-w-[430px]' : 'max-w-6xl',
          )}
        >
          <Link
            href="/about"
            className="focus-visible:ring-ring/60 hover:text-foreground inline-flex min-h-11 items-center rounded-lg text-base underline outline-none focus-visible:ring-3"
          >
            About BeliKongsi
          </Link>
          <p className="text-base">An Orbyte module</p>
        </div>
      </footer>
    </div>
  );
}
