'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, LogOut, X } from 'lucide-react';
import type { Role } from '@/generated/prisma/enums';
import { apiFetch } from '@/components/common/api-client';
import { groupAccounts, homeFor, roleLabel, type AccountLike } from '@/lib/roles';
import { cn } from '@/lib/utils';

export type SwitcherMembership = { id: string; role: Role; orgName: string };

type SessionViewJson = { activeMembership: { id: string; role: Role } };

const ROW =
  'flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/60';

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <span
      className={cn(
        'bg-accent text-accent-foreground inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-sm font-semibold',
        className,
      )}
    >
      {roleLabel(role)}
    </span>
  );
}

/**
 * The top bar's business and role switcher. It lists the signed-in person's own memberships and,
 * in demo mode, every seeded account grouped by business (switching person needs demo mode).
 */
export function AccountSwitcher({
  displayName,
  userId,
  active,
  memberships,
  accounts,
}: {
  displayName: string;
  userId: string;
  active: SwitcherMembership;
  memberships: SwitcherMembership[];
  accounts: AccountLike[] | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const close = () => dialog.current?.close();

  async function switchTo(key: string, payload: { membershipId: string } | { userId: string }) {
    setBusy(key);
    try {
      const view = await apiFetch<SessionViewJson>('/api/session/active-membership', {
        body: payload,
      });
      close();
      router.push(homeFor(view.activeMembership.role));
      router.refresh();
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy('sign-out');
    try {
      await apiFetch('/api/session', { method: 'DELETE' });
      close();
      router.push('/sign-in');
      router.refresh();
    } catch {
      // apiFetch has already shown the error.
    } finally {
      setBusy(null);
    }
  }

  const otherMemberships = memberships.filter((m) => m.id !== active.id);
  const groups = accounts ? groupAccounts(accounts) : [];

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-left hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white focus-visible:outline-none sm:w-auto"
      >
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-base font-semibold">{active.orgName}</span>
          <span className="truncate text-sm opacity-90">{displayName}</span>
        </span>
        <RoleBadge role={active.role} className="ml-auto" />
        <ChevronDown aria-hidden className="size-5 shrink-0" />
        <span className="sr-only">: switch business or role</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="switcher-title"
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        className="bg-popover text-popover-foreground mx-auto mt-4 w-[calc(100%-2rem)] max-w-md rounded-2xl p-0 shadow-xl backdrop:bg-black/50 sm:mt-16"
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
            <h2 id="switcher-title" className="text-lg font-semibold">
              Switch business or role
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="hover:bg-muted focus-visible:ring-ring/60 inline-flex size-11 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>

          <div className="overflow-y-auto px-2 py-3">
            <section aria-labelledby="switcher-yours" className="px-2">
              <h3 id="switcher-yours" className="text-muted-foreground text-sm font-semibold">
                {displayName}&apos;s businesses
              </h3>
              <ul className="mt-1 flex flex-col gap-1">
                <li>
                  <div aria-current="true" className={cn(ROW, 'bg-muted')}>
                    <span className="font-medium">{active.orgName}</span>
                    <span className="flex items-center gap-2">
                      <RoleBadge role={active.role} />
                      <Check aria-label="Active" className="text-primary size-5" />
                    </span>
                  </div>
                </li>
                {otherMemberships.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => switchTo(m.id, { membershipId: m.id })}
                      className={cn(ROW, 'hover:bg-muted disabled:opacity-60')}
                    >
                      <span className="font-medium">{m.orgName}</span>
                      <RoleBadge role={m.role} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {groups.length > 0 ? (
              <section aria-labelledby="switcher-demo" className="mt-4 px-2">
                <h3 id="switcher-demo" className="text-muted-foreground text-sm font-semibold">
                  Every seeded account (demo)
                </h3>
                {groups.map((g) => (
                  <div key={`${g.orgType}:${g.orgName}`} className="mt-2">
                    <h4 className="px-3 text-base font-semibold">{g.orgName}</h4>
                    <ul className="mt-1 flex flex-col gap-1">
                      {g.accounts.map((a) => {
                        const current = a.userId === userId;
                        return (
                          <li key={`${a.userId}:${a.orgName}`}>
                            <button
                              type="button"
                              disabled={busy !== null || current}
                              aria-current={current ? 'true' : undefined}
                              onClick={() => switchTo(a.userId, { userId: a.userId })}
                              className={cn(
                                ROW,
                                'hover:bg-muted disabled:cursor-default',
                                current ? 'bg-muted' : 'disabled:opacity-60',
                              )}
                            >
                              <span>
                                {a.displayName}
                                {current ? (
                                  <span className="text-muted-foreground"> (you)</span>
                                ) : null}
                                {busy === a.userId ? (
                                  <span className="text-muted-foreground"> · switching…</span>
                                ) : null}
                              </span>
                              <RoleBadge role={a.role} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            ) : null}
          </div>

          <div className="border-t p-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={signOut}
              className={cn(ROW, 'hover:bg-muted justify-start disabled:opacity-60')}
            >
              <LogOut aria-hidden className="size-5" />
              Sign out
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
