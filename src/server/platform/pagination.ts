export function parsePage(params: URLSearchParams): { cursor: string | null; limit: number } {
  const raw = Number.parseInt(params.get('limit') ?? '', 10);
  const limit = Number.isFinite(raw) ? Math.min(100, Math.max(1, raw)) : 20;
  return { cursor: params.get('cursor') || null, limit };
}

// Expects up to limit + 1 rows; the extra row only signals that another page exists.
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (t: T) => string,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: cursorOf(items[limit - 1] as T) };
}
