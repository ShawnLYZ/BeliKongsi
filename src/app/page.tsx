import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/roles';
import { getPageSession } from '@/server/platform/session-page';

export default async function HomePage() {
  const session = await getPageSession();
  redirect(session ? homeFor(session.membership.role) : '/sign-in');
}
