import { cn } from '@/lib/utils';

/**
 * A money check result as ✅ or ❌, with words for screen readers. `null` means the result is not
 * available (for example, missing evidence): shown as ❔ "Not available", never as a failure.
 */
export function CheckMark({
  passed,
  className,
  withText = false,
}: {
  passed: boolean | null;
  className?: string;
  /** Show "Passed", "Failed" or "Not available" next to the mark. */
  withText?: boolean;
}) {
  const mark = passed === null ? '❔' : passed ? '✅' : '❌';
  const text = passed === null ? 'Not available' : passed ? 'Passed' : 'Failed';
  const tone = passed === null ? 'text-foreground' : passed ? 'text-primary' : 'text-destructive';
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-semibold', className)}>
      <span aria-hidden>{mark}</span>
      {withText ? <span className={tone}>{text}</span> : <span className="sr-only">{text}</span>}
    </span>
  );
}
