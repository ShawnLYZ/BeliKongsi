import { cn } from '@/lib/utils';

/** Shared class names for owner and staff controls: 48 px tap targets, 16 px text, visible focus (G9). */
const BUTTON =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/60 active:not-disabled:translate-y-px disabled:cursor-not-allowed disabled:opacity-60';

export const BUTTON_PRIMARY = cn(
  BUTTON,
  'bg-primary text-primary-foreground hover:bg-primary-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(11_95_89/0.35)]',
);

export const BUTTON_SECONDARY = cn(
  BUTTON,
  'border-input/45 bg-card hover:border-input/70 hover:bg-muted/60 border shadow-[0_1px_2px_rgb(74_56_18/0.06)]',
);

export const BUTTON_QUIET = cn(
  BUTTON,
  'text-primary hover:bg-muted underline-offset-4 hover:underline',
);

export const BUTTON_DANGER = cn(BUTTON, 'text-destructive hover:bg-destructive/10');

export const INPUT =
  'border-input/55 bg-card focus-visible:border-ring focus-visible:ring-ring/25 aria-invalid:border-destructive placeholder:text-muted-foreground/80 min-h-12 w-full rounded-xl border-[1.5px] px-3 text-base transition-[border-color,box-shadow] outline-none focus-visible:ring-4';

export const FIELD_LABEL = 'text-base font-medium';

export const FIELD_ERROR = 'text-destructive text-base';
