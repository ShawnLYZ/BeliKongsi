const MONEY_KEY = /sen|price|amount|total|balance|saving|fee/i;

/** Fails with the offending path when any object key in `value` looks like a money field. */
export function expectNoMoneyFields(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => expectNoMoneyFields(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (MONEY_KEY.test(k)) throw new Error(`money field found at ${path}.${k}`);
      expectNoMoneyFields(v, `${path}.${k}`);
    }
  }
}

/**
 * Fails with the offending path when any key or string value in `value` carries a shop's name or
 * id (a supplier-facing response must never reveal which shops are in a round).
 */
export function expectNoShopIdentity(
  value: unknown,
  shopNames: string[],
  shopIds: string[],
  path = '$',
): void {
  const needles = [...shopNames, ...shopIds].map((n) => n.toLowerCase());
  const hit = (text: string) => needles.some((n) => text.toLowerCase().includes(n));
  if (typeof value === 'string') {
    if (hit(value)) throw new Error(`shop identity found at ${path}: ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => expectNoShopIdentity(v, shopNames, shopIds, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (hit(k)) throw new Error(`shop identity found in key at ${path}.${k}`);
      expectNoShopIdentity(v, shopNames, shopIds, `${path}.${k}`);
    }
  }
}
