import Link from 'next/link';
import { BUTTON_PRIMARY } from '@/components/common/controls';
import { EmptyState } from '@/components/common/empty-state';
import { UsualListEditor } from '@/components/usual-list/usual-list-editor';
import { getUsualList } from '@/server/modules/usual-list/usual-list';
import { personCaller } from '@/server/platform/caller';
import { getDeps } from '@/server/platform/deps';
import { scheduleDueWork } from '@/server/platform/due-work';
import { requireOwnerShop } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerUsualListPage() {
  const { session, shopId } = requireOwnerShop(await getPageSession());
  scheduleDueWork(getDeps());
  const list = await getUsualList(getDeps(), personCaller(session), shopId);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-bold">Your usual list</h1>
        <p className="text-base">
          What you order most weeks. Your weekly basket is drafted from it every Monday at 6 am.
        </p>
      </div>
      {list ? (
        <UsualListEditor key={list.confirmedAt} shopId={shopId} list={list} />
      ) : (
        <EmptyState
          title="No usual list yet"
          explanation="Paste an old WhatsApp order in setup, or pick from the catalogue, and your usual list appears here."
          example="6 cartons of condensed milk, usual price RM 165.00, price limit RM 165.00."
        >
          <Link href="/owner/setup" className={`${BUTTON_PRIMARY} mt-4 w-full`}>
            Start setup
          </Link>
        </EmptyState>
      )}
    </div>
  );
}
