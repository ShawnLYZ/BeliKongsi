const AMOUNT = /^(\d{1,7})(?:\.(\d{0,2}))?$/;

/**
 * Reads a ringgit amount typed by a person ("165", "165.5", "RM 1,165.50") as whole sen.
 * Empty text is `null`; anything that is not a positive amount with at most two decimals is
 * `undefined`. Integer arithmetic only, so "0.29" is exactly 29 sen.
 */
export function parseRinggitInput(text: string): number | null | undefined {
  const cleaned = text.replace(/^\s*RM/i, '').replace(/[\s,]/g, '');
  if (cleaned === '') return null;
  const m = AMOUNT.exec(cleaned);
  if (!m) return undefined;
  const sen = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return sen > 0 ? sen : undefined;
}

/** 16500 -> "165.00"; null -> "". For pre-filling an amount field. */
export function senToRinggitInput(sen: number | null): string {
  if (sen === null) return '';
  return `${Math.floor(sen / 100)}.${String(sen % 100).padStart(2, '0')}`;
}
