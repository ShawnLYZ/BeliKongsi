import Link from 'next/link';
import { BUTTON_PRIMARY } from '@/components/common/controls';

/** `notFound()` in a shell page: an unknown id, most often an old link kept across a demo reset. */
export default function ShellNotFound() {
  return (
    <section className="bg-card text-card-foreground flex max-w-xl flex-col gap-4 rounded-2xl border p-5">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="text-base">
        This page no longer exists, or the link is wrong. The demo may have been reset.
      </p>
      <Link href="/" className={`${BUTTON_PRIMARY} w-full sm:w-auto sm:self-start`}>
        Back to home
      </Link>
    </section>
  );
}
