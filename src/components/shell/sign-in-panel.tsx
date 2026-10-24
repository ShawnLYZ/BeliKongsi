'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import type { Role } from '@/generated/prisma/enums';
import { apiFetch } from '@/components/common/api-client';
import { groupAccounts, homeFor, type AccountLike } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { RoleBadge } from './account-switcher';

type Provider = 'microsoft' | 'google';
type SessionViewJson = { activeMembership: { role: Role } };

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'microsoft', label: 'Continue with Microsoft' },
  { id: 'google', label: 'Continue with Google' },
];

/** Simulated Orbyte sign-in: pick a provider, then one of the seeded accounts. No passwords. */
export function SignInPanel({ accounts }: { accounts: AccountLike[] }) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>('microsoft');
  const [busy, setBusy] = useState<string | null>(null);

  async function signInAs(userId: string) {
    setBusy(userId);
    try {
      const view = await apiFetch<SessionViewJson>('/api/session', {
        body: { userId, provider },
      });
      router.push(homeFor(view.activeMembership.role));
      router.refresh();
    } catch {
      // apiFetch has already shown the error.
      setBusy(null);
    }
  }

  const groups = groupAccounts(accounts);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="provider-title" className="flex flex-col gap-2.5">
        <h2 id="provider-title" className="text-lg font-semibold">
          1. Choose how to sign in
        </h2>
        {PROVIDERS.map((p) => {
          const chosen = provider === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={chosen}
              onClick={() => setProvider(p.id)}
              className={cn(
                'focus-visible:ring-ring/60 flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 text-left text-base font-semibold transition-colors outline-none focus-visible:ring-3',
                chosen
                  ? 'border-primary bg-primary-soft ring-primary ring-1 ring-inset'
                  : 'border-input/45 bg-card hover:bg-muted/60',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full border-2',
                  chosen ? 'border-primary' : 'border-input/60',
                )}
              >
                {chosen ? <span className="bg-primary size-2.5 rounded-full" /> : null}
              </span>
              <span className="mr-auto">{p.label}</span>
              <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-sm font-semibold">
                Simulated
              </span>
            </button>
          );
        })}
        <p className="text-muted-foreground text-base">
          This is a simulated Orbyte sign-in. No password is asked for and nothing is sent to
          Microsoft or Google.
        </p>
      </section>

      <section aria-labelledby="accounts-title" className="flex flex-col gap-4">
        <h2 id="accounts-title" className="text-lg font-semibold">
          2. Choose an account
        </h2>
        {groups.map((g) => (
          <div key={`${g.orgType}:${g.orgName}`}>
            <h3 className="text-muted-foreground text-base font-semibold">{g.orgName}</h3>
            <ul className="bg-card mt-1.5 flex flex-col divide-y overflow-hidden rounded-2xl border">
              {g.accounts.map((a) => (
                <li key={`${a.userId}:${a.orgName}`}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => signInAs(a.userId)}
                    className="group hover:bg-muted/60 focus-visible:ring-ring/60 flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left text-base transition-colors outline-none focus-visible:ring-3 focus-visible:ring-inset disabled:opacity-60"
                  >
                    <span className="mr-auto font-semibold">
                      {a.displayName}
                      {busy === a.userId ? (
                        <span className="text-muted-foreground font-normal"> · signing in…</span>
                      ) : null}
                    </span>
                    <RoleBadge role={a.role} />
                    <ChevronRight
                      aria-hidden
                      className="text-muted-foreground size-5 shrink-0 transition-transform group-hover:translate-x-0.5"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
