/** The PRD §16 output shape, as plain JSON Schema for Gemini's `responseJsonSchema`. */
export const READ_RESULT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceText: { type: 'string' },
          productId: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          unitAsWritten: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          alternatives: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          note: { type: ['string', 'null'] },
        },
        required: [
          'sourceText',
          'productId',
          'quantity',
          'unitAsWritten',
          'confidence',
          'alternatives',
          'note',
        ],
      },
    },
    ignoredText: { type: 'array', items: { type: 'string' } },
  },
  required: ['lines', 'ignoredText'],
} as const;
