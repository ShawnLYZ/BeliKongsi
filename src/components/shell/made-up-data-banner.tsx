import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Always shown in demo mode and never dismissible (PRD §19). */
export function MadeUpDataBanner({ text, narrow = false }: { text: string; narrow?: boolean }) {
  return (
    <div
      role="note"
      aria-label="Made-up data"
      className="bg-banner text-banner-foreground border-b border-black/10"
    >
      <p
        className={cn(
          'mx-auto flex items-start gap-2 px-4 py-1.5 text-base leading-6 font-medium',
          narrow ? 'max-w-[430px]' : 'max-w-6xl',
        )}
      >
        <FlaskConical aria-hidden className="mt-1 size-4 shrink-0" />
        <span>{text}</span>
      </p>
    </div>
  );
}
