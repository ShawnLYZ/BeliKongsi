export interface ParsedProductView {
  id: string;
  name: string;
  packDescription: string;
  unitName: string;
  imageUrl: string | null;
}

export interface ParsedLineView {
  sourceText: string;
  product: ParsedProductView | null;
  quantity: number | null;
  unitAsWritten: string | null;
  confidence: number;
  alternatives: { id: string; name: string; packDescription: string }[];
  note: string | null;
  /** `check` is shown as "Please check"; `not_found` means no catalogue product matched. */
  status: 'ok' | 'check' | 'not_found';
  /** Only for the built-in sample order. */
  samplePriceSen?: number;
}

export interface ParseView {
  suggestionRunId: string;
  lines: ParsedLineView[];
  ignoredText: string[];
  model: string;
  source: 'ai' | 'saved_example';
}

export interface UsualListItemView {
  productId: string;
  name: string;
  packDescription: string;
  unitName: string;
  imageUrl: string | null;
  quantity: number;
  usualPriceSen: number | null;
  priceLimitSen: number | null;
}

export interface UsualListView {
  items: UsualListItemView[];
  confirmedAt: string;
}
