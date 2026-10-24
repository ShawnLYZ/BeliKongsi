import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Says what will appear here, with an example (PRD §22 states). */
export function EmptyState({
  title,
  explanation,
  example,
  children,
  className,
}: {
  title: string;
  explanation: string;
  example?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'border-input/45 bg-card/55 text-card-foreground rounded-2xl border border-dashed p-5',
        className,
      )}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-base">{explanation}</p>
      {example ? (
        <p className="text-muted-foreground mt-2 text-base tabular-nums">
          <span className="text-foreground font-medium">Example:</span> {example}
        </p>
      ) : null}
      {children}
    </section>
  );
}
