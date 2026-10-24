import { SAMPLE_ORDER_TEXT } from '../../../../prisma/seed/sample-order';
import { SAMPLE_PRICE_LIST_TEXT } from '../../../../prisma/seed/sample-price-list';
import { describePriceListInput } from './price-list';
import { redactPersonalData } from './redact';
import { SAMPLE_PRICE_LIST_RESULT } from './sample-price-list';
import { SAVED_EXAMPLE } from './saved-example';
import type { OrderReader, PriceListResult, ReadResult } from './types';

export type FakeOrderReader = OrderReader & {
  /**
   * Every call, in order: the redacted text of an order, an order photo as its marker
   * (`[image <type> <n> bytes]`), or a price list as `describePriceListInput` records it
   * (its text, then a marker for any photo).
   */
  received: string[];
  /** Order answers by redacted text, or by the photo marker for an invoice photo. Tests add their own entries. */
  fixtures: Record<string, ReadResult>;
  /** Price-list answers by `describePriceListInput`, starting with the sample. Tests add their own. */
  priceListFixtures: Record<string, PriceListResult>;
  /** While set, every call rejects with this error. */
  failWith: Error | null;
};

/** A deterministic reader for tests and the demo: no network. Unknown input reads as no lines. */
export function createFakeOrderReader(
  fixtures: Record<string, ReadResult> = {},
  opts: { failWith?: Error; priceListFixtures?: Record<string, PriceListResult> } = {},
): FakeOrderReader {
  const reader: FakeOrderReader = {
    model: 'fake-order-reader',
    received: [],
    fixtures: {
      [redactPersonalData(SAMPLE_ORDER_TEXT).text]: SAVED_EXAMPLE,
      ...fixtures,
    },
    priceListFixtures: {
      [redactPersonalData(SAMPLE_PRICE_LIST_TEXT).text]: SAMPLE_PRICE_LIST_RESULT,
      ...opts.priceListFixtures,
    },
    failWith: opts.failWith ?? null,
    async readOrderText({ text }) {
      reader.received.push(text);
      if (reader.failWith) throw reader.failWith;
      return structuredClone(reader.fixtures[text] ?? { lines: [], ignoredText: [] });
    },
    async readOrderImage({ image }) {
      const key = describePriceListInput({ image });
      reader.received.push(key);
      if (reader.failWith) throw reader.failWith;
      return structuredClone(reader.fixtures[key] ?? { lines: [], ignoredText: [] });
    },
    async readPriceList({ text, image }) {
      const key = describePriceListInput({ text, image });
      reader.received.push(key);
      if (reader.failWith) throw reader.failWith;
      return structuredClone(reader.priceListFixtures[key] ?? { lines: [], ignoredText: [] });
    },
  };
  return reader;
}
