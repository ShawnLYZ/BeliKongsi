import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
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
      {demo.demoMode ? <MadeUpDataBanner text={demo.bannerText} /> : null}
      <main id="main" className="flex-1 px-4 py-5">
        {narrow ? (
          <PhoneColumn>{children}</PhoneColumn>
        ) : (
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        )}
      </main>
    </div>
  );
}
