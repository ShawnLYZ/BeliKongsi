import Link from 'next/link';
import { Money } from '@/components/common/money';

const LINK =
  '-mx-2 focus-visible:ring-ring/60 hover:bg-muted flex min-h-12 items-center rounded-xl px-2 text-base font-semibold underline underline-offset-4 outline-none focus-visible:ring-3';

/** Owner home: the BeliKongsi balance and how many approvals are waiting for the owner. */
export function BalanceCard({
  balanceSen,
  pendingApprovals,
}: {
  balanceSen: number;
  pendingApprovals: number;
}) {
  return (
    <section
      aria-labelledby="balance-card"
      className="bg-card flex flex-col gap-1 rounded-2xl border p-5"
    >
      <h2 id="balance-card" className="text-lg font-semibold">
        Your balance
      </h2>
      <p className="text-2xl font-bold">
        <Money sen={balanceSen} />
      </p>
      <Link href="/owner/money" className={LINK}>
        See your money history
      </Link>
      <h3 className="mt-2 text-base font-semibold">Waiting for you</h3>
      {pendingApprovals > 0 ? (
        <Link href="/approvals" className={LINK}>
          {pendingApprovals === 1 ? '1 approval' : `${pendingApprovals} approvals`} to look at
        </Link>
      ) : (
        <p className="text-base">Nothing is waiting for your approval.</p>
      )}
    </section>
  );
}
