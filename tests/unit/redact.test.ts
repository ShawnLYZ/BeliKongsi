import { describe, expect, it } from 'vitest';
import { redactPersonalData } from '@/server/adapters/ai/redact';

describe('redactPersonalData', () => {
  it.each(['012-345 6789', '+60 12-345 6789', '0123456789', '+65 9123 4567', '+1 (415) 555-0100'])(
    'removes the phone number %s',
    (p) => expect(redactPersonalData(`call ${p} ok`).text).toBe('call [phone removed] ok'),
  );

  it.each([
    ['wa.me/60123456789', 'wa.me/[phone removed]'],
    ['60 12-345 6789', '[phone removed]'],
    ['60123456789', '[phone removed]'],
    ['6591234567', '[phone removed]'],
    ['9123 4567', '[phone removed]'],
    ['tel0123456789', 'tel[phone removed]'],
  ])('removes the phone format %s', (p, expected) =>
    expect(redactPersonalData(p).text).toBe(expected),
  );

  it.each([
    'cups 1000 pcs',
    'susu pekat 390g x 48 tin',
    'beg 2000 pcs 8 ctn',
    'kod 91234567',
    'item60 x 12',
    '9000 pcs',
  ])('does not mistake "%s" for a phone number', (t) =>
    expect(redactPersonalData(t)).toEqual({ text: t, removedCount: 0 }),
  );

  it('removes emails and identity-card-like numbers', () => {
    expect(redactPersonalData('siti@contoh.my 900101-14-5678 900101145678').text).toBe(
      '[email removed] [id removed] [id removed]',
    );
  });

  it('counts what it removed', () => {
    expect(redactPersonalData('a@b.my 012-345 6789').removedCount).toBe(2);
  });

  it('leaves quantities, sizes and units alone', () => {
    const t = '炼奶 6箱\ncawan 16oz 2 ctn\nsusu pekat 390g x 48 tin\ncups 1000 pcs';
    expect(redactPersonalData(t)).toEqual({ text: t, removedCount: 0 });
  });
});
