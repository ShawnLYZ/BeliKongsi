/** Whole number of sen (1 RM = 100 sen). */
export type Sen = number;

/** One price tier: from `minQuantity` units the unit price is `unitPriceSen`. */
export interface Tier {
  minQuantity: number;
  unitPriceSen: Sen;
}
