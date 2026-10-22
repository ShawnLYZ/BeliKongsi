'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
      <section aria-labelledby="provider-title" className="flex flex-col gap-2">
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
                'focus-visible:ring-ring/60 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border-2 px-4 text-left text-base font-semibold outline-none focus-visible:ring-3',
                chosen ? 'border-primary bg-primary/10' : 'border-input/50 bg-card hover:bg-muted',
              )}
            >
              <span>{p.label}</span>
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
            <ul className="mt-1 flex flex-col gap-2">
              {g.accounts.map((a) => (
                <li key={`${a.userId}:${a.orgName}`}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => signInAs(a.userId)}
                    className="bg-card hover:bg-muted focus-visible:ring-ring/60 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 py-2 text-left text-base outline-none focus-visible:ring-3 disabled:opacity-60"
                  >
                    <span className="font-medium">
                      {a.displayName}
                      {busy === a.userId ? (
                        <span className="text-muted-foreground"> · signing in…</span>
                      ) : null}
                    </span>
                    <RoleBadge role={a.role} />
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
