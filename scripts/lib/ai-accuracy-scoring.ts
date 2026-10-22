import type { ReadResult } from '../../src/server/adapters/ai/types';

export interface AccuracyFixture {
  id: string;
  text: string;
  /** In line order. A `null` productKey is an item that is not in the catalogue. */
  expected: { productKey: string | null; quantity: number | null }[];
  /** `[i]` lists the products an ambiguous line i may be (the model must offer all of them). */
  mustOfferAlternatives?: string[][];
}

export interface OrderScore {
  correct: boolean;
  invented: string[];
  problems: string[];
}

/**
 * An order is correct when every expected line matches by product and quantity (a not-in-catalogue
 * line only needs a null product), ambiguous lines offer the listed products, and no extra products
 * are matched. Returned lines are matched to expected lines regardless of order. A returned id that is
 * not in the catalogue is invented.
 */
export function scoreOrder(
  fixture: AccuracyFixture,
  result: ReadResult,
  keyById: ReadonlyMap<string, string>,
): OrderScore {
  const problems: string[] = [];
  const invented: string[] = [];
  const keyOf = (id: string | null): string | null | undefined =>
    id === null ? null : keyById.get(id);

  for (const line of result.lines) {
    for (const id of [line.productId, ...line.alternatives]) {
      if (id !== null && !keyById.has(id)) invented.push(id);
    }
  }
  if (invented.length) problems.push(`invented ids: ${invented.join(', ')}`);

  const unused = [...result.lines];
  const take = (match: (l: ReadResult['lines'][number]) => boolean) => {
    const at = unused.findIndex(match);
    return at === -1 ? null : unused.splice(at, 1)[0]!;
  };

  fixture.expected.forEach((exp, i) => {
    const offered = fixture.mustOfferAlternatives?.[i] ?? [];
    const label = `${exp.productKey ?? 'not in catalogue'} x${exp.quantity ?? '?'}`;
    if (exp.productKey === null) {
      if (!take((l) => l.productId === null)) problems.push(`missing null line (${label})`);
      return;
    }
    const wanted = exp.productKey;
    const found = take((l) => {
      const keys = new Set(
        [l.productId, ...l.alternatives].map(keyOf).filter((k): k is string => !!k),
      );
      const primaryOk = offered.length
        ? offered.includes(keyOf(l.productId) ?? '')
        : keyOf(l.productId) === wanted;
      return primaryOk && offered.every((k) => keys.has(k)) && l.quantity === exp.quantity;
    });
    if (!found) problems.push(`missing or wrong: ${label}`);
  });

  for (const line of unused) {
    if (line.productId !== null) {
      problems.push(`extra product: ${keyOf(line.productId) ?? line.productId} x${line.quantity}`);
    }
  }
  return { correct: problems.length === 0, invented, problems };
}
