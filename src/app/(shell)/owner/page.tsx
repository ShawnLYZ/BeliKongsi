import { EmptyState } from '@/components/common/empty-state';
import { requirePageRole } from '@/server/platform/page-auth';
import { getPageSession } from '@/server/platform/session-page';

export default async function OwnerHomePage() {
  const session = requirePageRole(await getPageSession(), ['owner']);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{session.membership.orgName}</h1>
      <EmptyState
        title="This week's basket"
        explanation="Your weekly basket appears here every Monday at 6 am."
        example="5 items, RM 1,630.20."
      />
      <EmptyState
        title="Next pickup"
        explanation="Once you have paid, where and when to collect your goods appears here, with your pickup code."
        example="Ipoh pickup point, Tue 11 Nov, code 482 913."
      />
      <EmptyState
        title="Savings this month"
        explanation="What buying together saved you this month appears here. It is Estimated until the rounds close."
        example="Estimated RM 118.40 saved across 5 Kongsi rounds."
      />
    </div>
  );
}
