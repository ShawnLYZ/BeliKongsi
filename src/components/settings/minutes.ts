export type Minutes = { minutes: number } | { error: string };

/** The minutes a week typed in Settings: a whole number from 0 to 600. */
export function readMinutes(text: string): Minutes {
  const t = text.trim();
  const minutes = Number(t);
  if (t === '' || !/^\d+$/.test(t) || minutes > 600) {
    return { error: 'Enter a whole number of minutes from 0 to 600.' };
  }
  return { minutes };
}
