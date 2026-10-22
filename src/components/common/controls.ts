import { cn } from '@/lib/utils';

/** Shared class names for owner and staff controls: 48 px tap targets, 16 px text, visible focus (G9). */
const BUTTON =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-60';

export const BUTTON_PRIMARY = cn(
  BUTTON,
  'bg-primary text-primary-foreground hover:bg-primary-hover',
);

export const BUTTON_SECONDARY = cn(BUTTON, 'border-input/50 bg-card hover:bg-muted border-2');

export const BUTTON_QUIET = cn(
  BUTTON,
  'text-primary hover:bg-muted underline-offset-4 hover:underline',
);

export const BUTTON_DANGER = cn(BUTTON, 'text-destructive hover:bg-destructive/10');

export const INPUT =
  'border-input/60 bg-card focus-visible:border-ring focus-visible:ring-ring/60 aria-invalid:border-destructive min-h-12 w-full rounded-xl border-2 px-3 text-base outline-none focus-visible:ring-3';

export const FIELD_LABEL = 'text-base font-medium';

export const FIELD_ERROR = 'text-destructive text-base';
