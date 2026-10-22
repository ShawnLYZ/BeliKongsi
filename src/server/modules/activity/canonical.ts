/** JSON with sorted keys and no whitespace; bigint and Date become strings, undefined keys vanish. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value)) ?? 'null';
}

function normalise(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalise(v)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalise(v);
    }
    return out;
  }
  return value;
}
