import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { ArrowRight, CalendarCheck, EyeOff, PackageCheck } from 'lucide-react';
import { Wordmark } from '@/components/shell/brand-mark';
import { MadeUpDataBanner } from '@/components/shell/made-up-data-banner';
import { SignInPanel } from '@/components/shell/sign-in-panel';
import { TierLadder } from '@/components/shell/tier-ladder';
import { getDemoState } from '@/server/modules/demo/demo';
import { listSignInAccounts } from '@/server/modules/identity/identity';
import { getDeps } from '@/server/platform/deps';

const PRINCIPLES = [
  {
    icon: CalendarCheck,
    title: 'One approval a week',
    text: 'The usual list becomes a ready basket.',
  },
  {
    icon: EyeOff,
    title: 'Shops stay anonymous',
    text: 'No shop or supplier sees who else joined.',
  },
  {
    icon: PackageCheck,
    title: 'Delivered or refunded',
    text: 'Every unit paid for arrives or comes back.',
  },
] as const;

export const metadata: Metadata = { title: 'Sign in · BeliKongsi' };

export default async function SignInPage() {
  await connection(); // the account list and demo banner are read per request, not at build
  const deps = getDeps();
  const [demo, accounts] = await Promise.all([getDemoState(deps), listSignInAccounts(deps)]);
  return (
    <div className="flex min-h-screen flex-col">
      {demo.demoMode ? <MadeUpDataBanner text={demo.bannerText} /> : null}
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <header className="bg-topbar text-topbar-foreground">
          <div className="mx-auto flex max-w-xl flex-col gap-8 px-5 pt-6 pb-8 sm:px-8 lg:sticky lg:top-0 lg:min-h-[calc(100vh-2.5rem)] lg:justify-between lg:py-12">
            <Wordmark />
            <div className="flex flex-col gap-5">
              <p lang="ms" className="text-accent text-lg font-semibold">
                Beli sama-sama, harga borong.
              </p>
              <p className="text-[2.25rem] leading-[1.08] font-bold tracking-[-0.03em] text-balance text-white sm:text-5xl">
                Buy together, pay wholesale.
              </p>
              <p className="text-topbar-muted max-w-[34rem] text-lg leading-relaxed">
                Small food businesses pool their weekly restock into one Kongsi. The combined order
                reaches the supplier&apos;s cheaper price tier, and the owner approves it once a
                week.
              </p>
            </div>
            <TierLadder />
            <ul className="text-topbar-muted hidden gap-x-6 gap-y-3 text-base sm:grid sm:grid-cols-3">
              {PRINCIPLES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex flex-col gap-1">
                  <Icon aria-hidden className="text-accent size-5" />
                  <span className="font-semibold text-white">{title}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </header>
        <main className="px-4 py-8 sm:px-8 lg:py-12">
          <div className="mx-auto flex w-full max-w-[440px] flex-col gap-6">
            <div>
              <h1 className="text-3xl font-bold">Sign in</h1>
              <p className="text-muted-foreground mt-1.5 text-base">
                Choose a demo account to see BeliKongsi as an owner, staff, supplier or Ops.
              </p>
            </div>
            <SignInPanel accounts={accounts} />
            <p className="border-t pt-4">
              <Link
                href="/about"
                className="focus-visible:ring-ring/60 hover:text-primary-hover inline-flex min-h-11 items-center gap-1.5 rounded-lg text-base font-semibold underline outline-none focus-visible:ring-3"
              >
                About BeliKongsi
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
