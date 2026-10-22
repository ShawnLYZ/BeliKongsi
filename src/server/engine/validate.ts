/** True when `value` is a safe integer between `min` and `max` (both inclusive). */
export function isIntegerInRange(
  value: unknown,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * True when `value` is an ISO 8601 date-time that names one instant: it must end in `Z` or a
 * UTC offset, so the result never depends on the server's time zone.
 */
export function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}
