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

export type UnitName = 'carton' | 'tin' | 'tray' | 'sack' | 'pack';

export interface PriceListTier {
  minQuantity: number;
  unitPriceSen: number;
}

/** One product line as the model read it from a supplier's price list. Prices are sen, unchecked. */
export interface PriceListLine {
  sourceText: string;
  productId: string | null;
  proposedName: string | null;
  packDescription: string | null;
  unitName: UnitName | null;
  buyAlonePriceSen: number | null;
  tiers: PriceListTier[];
  confidence: number;
  note: string | null;
}

export interface PriceListResult {
  lines: PriceListLine[];
  ignoredText: string[];
}

/** A price-list photo. Sent to the model and never stored. */
export interface PriceListImage {
  bytes: Uint8Array;
  mimeType: string;
}

export interface OrderReader {
  readonly model: string;
  readOrderText(i: { text: string; catalogue: CatalogueEntry[] }): Promise<ReadResult>;
  /** Reads an order from a photo of an old invoice. The photo is sent to the model and never stored. */
  readOrderImage(i: { image: PriceListImage; catalogue: CatalogueEntry[] }): Promise<ReadResult>;
  /** Reads a supplier's price list from (redacted) text, a photo, or both. */
  readPriceList(i: {
    text?: string;
    image?: PriceListImage;
    products: CatalogueEntry[];
  }): Promise<PriceListResult>;
}

/** The reader could not give an answer (down, rate limited, timed out, or unreadable output). */
export class AiUnavailableError extends Error {
  constructor(message = 'The assistant is unavailable right now.') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}
