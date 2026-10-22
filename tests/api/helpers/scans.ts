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
