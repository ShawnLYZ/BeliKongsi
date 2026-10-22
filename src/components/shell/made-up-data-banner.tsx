import { Info } from 'lucide-react';

/** Always shown in demo mode and never dismissible (PRD §19). */
export function MadeUpDataBanner({ text }: { text: string }) {
  return (
    <div role="note" aria-label="Made-up data" className="bg-banner text-banner-foreground">
      <p className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2 text-base font-medium">
        <Info aria-hidden className="mt-1 size-4 shrink-0" />
        <span>{text}</span>
      </p>
    </div>
  );
}
