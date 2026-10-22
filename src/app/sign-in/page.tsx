import type { Metadata } from 'next';
import { connection } from 'next/server';
import { PhoneColumn } from '@/components/common/phone-column';
import { MadeUpDataBanner } from '@/components/shell/made-up-data-banner';
import { SignInPanel } from '@/components/shell/sign-in-panel';
import { getDemoState } from '@/server/modules/demo/demo';
import { listSignInAccounts } from '@/server/modules/identity/identity';
import { getDeps } from '@/server/platform/deps';

export const metadata: Metadata = { title: 'Sign in · BeliKongsi' };

export default async function SignInPage() {
  await connection(); // the account list and demo banner are read per request, not at build
  const deps = getDeps();
  const [demo, accounts] = await Promise.all([getDemoState(deps), listSignInAccounts(deps)]);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-topbar text-topbar-foreground">
        <PhoneColumn className="px-4 py-3">
          <p className="text-xl font-bold tracking-tight">BeliKongsi</p>
        </PhoneColumn>
      </header>
      {demo.demoMode ? <MadeUpDataBanner text={demo.bannerText} /> : null}
      <main className="flex-1 px-4 py-6">
        <PhoneColumn className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-bold">Sign in</h1>
            <p className="mt-1 text-base">
              Beli sama-sama, harga borong. Buy together, pay wholesale.
            </p>
          </div>
          <SignInPanel accounts={accounts} />
        </PhoneColumn>
      </main>
    </div>
  );
}
