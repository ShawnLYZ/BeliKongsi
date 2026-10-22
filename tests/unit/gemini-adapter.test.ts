import { describe, expect, it, vi } from 'vitest';
import {
  AiUnavailableError,
  createGeminiOrderReader,
  toReadResult,
} from '@/server/adapters/ai/gemini';

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
