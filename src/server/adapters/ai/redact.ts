const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Malaysian identity-card-like numbers: 900101-14-5678 or twelve digits in a row.
const ID_CARD = /(?<![\w-])(?:\d{6}-\d{2}-\d{4}|\d{12})(?![\w-])/g;
// A run of digits with phone separators; only kept as a phone when it looks like one (below).
const PHONE_CANDIDATE = /(?<![\d.])\+?\d[\d ()\-.]{6,}\d(?!\w)/g;

/**
 * Local (0…) and international (+…) numbers may follow a letter (`tel0123…`); bare country
 * prefixes (60, 65) and grouped 8-digit numbers (`9123 4567`) need a clean boundary so that
 * ordinary quantities are not caught.
 */
function isPhone(match: string, before: string): boolean {
  const digits = match.replace(/\D/g, '');
  const n = digits.length;
  if (/^[+0]/.test(match)) return n >= 9 && n <= 15;
  if (/\w/.test(before)) return false;
  if (digits.startsWith('60')) return n >= 10 && n <= 12;
  if (digits.startsWith('65')) return n === 10;
  return /^[89]\d{3} \d{4}$/.test(match);
}

/**
 * Removes personal data before text leaves the server: emails, identity-card-like numbers and
 * phone numbers. Quantities, sizes (16oz, 390g) and units are left alone.
 */
export function redactPersonalData(text: string): { text: string; removedCount: number } {
  let removedCount = 0;
  const swap = (label: string) => () => {
    removedCount++;
    return label;
  };
  let out = text.replace(EMAIL, swap('[email removed]'));
  out = out.replace(ID_CARD, swap('[id removed]'));
  out = out.replace(PHONE_CANDIDATE, (match, offset: number, whole: string) => {
    if (!isPhone(match, offset > 0 ? whole[offset - 1]! : '')) return match;
    removedCount++;
    return '[phone removed]';
  });
  return { text: out, removedCount };
}
