import { SAMPLE_ORDER_TEXT } from '../../../../prisma/seed/sample-order';
import { redactPersonalData } from './redact';
import { SAVED_EXAMPLE } from './saved-example';
import type { OrderReader, ReadResult } from './types';

export type FakeOrderReader = OrderReader & {
  /** The redacted text of every call, in order. */
  received: string[];
  /** Answers by redacted text. Tests add their own entries. */
  fixtures: Record<string, ReadResult>;
  /** While set, every call rejects with this error. */
  failWith: Error | null;
};

/** A deterministic reader for tests and the demo: no network. Unknown text reads as no lines. */
export function createFakeOrderReader(
  fixtures: Record<string, ReadResult> = {},
  opts: { failWith?: Error } = {},
): FakeOrderReader {
  const reader: FakeOrderReader = {
    model: 'fake-order-reader',
    received: [],
    fixtures: {
      [redactPersonalData(SAMPLE_ORDER_TEXT).text]: SAVED_EXAMPLE,
      ...fixtures,
    },
    failWith: opts.failWith ?? null,
    async readOrderText({ text }) {
      reader.received.push(text);
      if (reader.failWith) throw reader.failWith;
      return structuredClone(reader.fixtures[text] ?? { lines: [], ignoredText: [] });
    },
  };
  return reader;
}
