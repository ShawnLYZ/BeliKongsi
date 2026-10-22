/** What the AI is told about one product it may match a pasted line to. */
export interface CatalogueEntry {
  id: string;
  name: string;
  packDescription: string;
  unitName: string;
  aliases: string[];
  /** Units that make up one pack, e.g. `{ pack: 10 }`. */
  packConversions: Record<string, number>;
}

export interface ReadLine {
  sourceText: string;
  productId: string | null;
  quantity: number | null;
  unitAsWritten: string | null;
  confidence: number;
  alternatives: string[];
  note: string | null;
}

export interface ReadResult {
  lines: ReadLine[];
  ignoredText: string[];
}

export interface OrderReader {
  readonly model: string;
  readOrderText(i: { text: string; catalogue: CatalogueEntry[] }): Promise<ReadResult>;
}

/** The reader could not give an answer (down, rate limited, timed out, or unreadable output). */
export class AiUnavailableError extends Error {
  constructor(message = 'The assistant is unavailable right now.') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}
