import { describe, expect, it, vi } from 'vitest';
import {
  AiUnavailableError,
  createGeminiOrderReader,
  toReadResult,
  type GenerateRequest,
} from '@/server/adapters/ai/gemini';
import { PRICE_LIST_JSON_SCHEMA, toPriceListResult } from '@/server/adapters/ai/price-list';

const VALID = JSON.stringify({
  lines: [
    {
      sourceText: '炼奶 6箱',
      productId: 'p1',
      quantity: 6,
      unitAsWritten: '箱',
      confidence: 0.97,
      alternatives: [],
      note: null,
    },
  ],
  ignoredText: ['Hi boss'],
});
const input = { text: 'hi', catalogue: [] };

function reader(generate: () => Promise<string>) {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
  return { sleep, reader: createGeminiOrderReader({ apiKey: 'k', model: 'm', generate, sleep }) };
}

describe('Gemini order reader', () => {
  it('retries once after a rate limit and then succeeds', async () => {
    const generate = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('slow down'), { status: 429 }))
      .mockResolvedValueOnce(VALID);
    const { sleep, reader: r } = reader(generate);
    const result = await r.readOrderText(input);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2000);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.lines).toHaveLength(1);
    expect(result.ignoredText).toEqual(['Hi boss']);
  });

  it('sends an invoice photo as an inline image with no text, and reads the answer like text', async () => {
    const generate = vi.fn<(req: GenerateRequest) => Promise<string>>(async () => VALID);
    const r = createGeminiOrderReader({ apiKey: 'k', model: 'm', generate });
    const result = await r.readOrderImage({
      image: { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' },
      catalogue: [],
    });
    expect(generate.mock.calls[0]![0]).toMatchObject({
      text: '',
      image: { mimeType: 'image/jpeg', data: '/9j/' },
    });
    expect(result.lines.map((l) => l.quantity)).toEqual([6]);
  });

  it('gives up as AI unavailable after a second failure', async () => {
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    const { reader: r } = reader(generate);
    await expect(r.readOrderText(input)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('does not retry a client error', async () => {
    const generate = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('bad key'), { status: 403 }));
    const { sleep, reader: r } = reader(generate);
    await expect(r.readOrderText(input)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry a timeout', async () => {
    const generate = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const { reader: r } = reader(generate);
    await expect(r.readOrderText(input)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('treats an unreadable answer as unavailable', () => {
    expect(() => toReadResult('not json')).toThrow(AiUnavailableError);
    expect(() => toReadResult('{"lines":"x"}')).toThrow(AiUnavailableError);
  });

  it('keeps odd quantities as written for the validator to judge', () => {
    const raw = JSON.stringify({
      lines: [{ sourceText: 'x', productId: null, quantity: 2.5, confidence: 2 }],
      ignoredText: [],
    });
    expect(toReadResult(raw).lines[0]).toMatchObject({
      quantity: 2.5,
      confidence: 1,
      alternatives: [],
      note: null,
      unitAsWritten: null,
    });
  });
});

describe('Gemini price-list reader', () => {
  const PRICE_LIST = JSON.stringify({
    lines: [
      {
        sourceText: 'Susu pekat 20 ctn RM157',
        productId: 'p1',
        proposedName: null,
        packDescription: null,
        unitName: 'carton',
        buyAlonePriceSen: 16800,
        tiers: [{ minQuantity: 20, unitPriceSen: 15700 }],
        confidence: 0.9,
        note: null,
      },
    ],
    ignoredText: [],
  });

  it('sends a photo as an inline image part with the price-list schema', async () => {
    const generate = vi.fn<(req: GenerateRequest) => Promise<string>>(async () => PRICE_LIST);
    const r = createGeminiOrderReader({ apiKey: 'k', model: 'm', generate });
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
    const result = await r.readPriceList({
      image: { bytes, mimeType: 'image/jpeg' },
      products: [],
    });
    const req = generate.mock.calls[0]![0];
    expect(req.image).toEqual({
      mimeType: 'image/jpeg',
      data: Buffer.from(bytes).toString('base64'),
    });
    expect(req.text).toBe('');
    expect(req.responseJsonSchema).toBe(PRICE_LIST_JSON_SCHEMA);
    expect(result.lines[0]!.tiers).toEqual([{ minQuantity: 20, unitPriceSen: 15700 }]);
  });

  it('sends pasted text without an image part, and retries like order reading', async () => {
    const generate = vi
      .fn<(req: GenerateRequest) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 503 }))
      .mockResolvedValueOnce(PRICE_LIST);
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const r = createGeminiOrderReader({ apiKey: 'k', model: 'm', generate, sleep });
    await r.readPriceList({ text: 'Susu pekat 20 ctn RM157', products: [] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2000);
    expect(generate.mock.calls[1]![0].image).toBeUndefined();
  });

  it('drops tiers it cannot read and unknown units, keeping odd prices for the server', () => {
    const raw = JSON.stringify({
      lines: [
        {
          sourceText: 'x',
          unitName: 'crate',
          buyAlonePriceSen: 100.5,
          tiers: [
            { minQuantity: 10, unitPriceSen: 'RM5' },
            { minQuantity: 20, unitPriceSen: 90 },
          ],
        },
      ],
    });
    expect(toPriceListResult(raw).lines[0]).toMatchObject({
      unitName: null,
      buyAlonePriceSen: 100.5,
      tiers: [{ minQuantity: 20, unitPriceSen: 90 }],
      productId: null,
    });
    expect(() => toPriceListResult('nope')).toThrow(AiUnavailableError);
  });
});
