import type { TierError } from './tiers';

export interface FieldError {
  path: string;
  message: string;
}

/** Thrown when an engine function is given input that is not valid. Lists every bad field. */
export class EngineInputError extends Error {
  fields: FieldError[];

  constructor(fields: FieldError[], message = 'Some fields are not valid.') {
    super(message);
    this.name = 'EngineInputError';
    this.fields = fields;
  }
}

/** Maps tier validation errors to field paths such as `tiers[0].minQuantity`. */
export function tierFieldErrors(errors: TierError[], basePath = 'tiers'): FieldError[] {
  return errors.map((error) => {
    if (error.position === null) return { path: basePath, message: error.message };
    const property = error.code.startsWith('MIN_QUANTITY_') ? 'minQuantity' : 'unitPriceSen';
    return { path: `${basePath}[${error.position - 1}].${property}`, message: error.message };
  });
}
