import { cn } from '@/lib/utils';

function Block({ className }: { className?: string }) {
  return <div className={cn('bg-muted rounded-2xl motion-safe:animate-pulse', className)} />;
}

/** The loading state for every page (PRD §22: loading uses skeletons): a title and three cards. */
export function PageSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading…</span>
      <Block className="h-8 w-2/3 rounded-lg" />
      <Block className="h-40" />
      <Block className="h-28" />
      <Block className="h-28" />
    </div>
  );
}
