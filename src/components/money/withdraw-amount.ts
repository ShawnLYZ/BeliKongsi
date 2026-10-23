import { formatRM } from '@/lib/format';
import { parseRinggitInput } from '@/lib/money-input';

export type WithdrawAmount = { amountSen: number } | { error: string };

/**
 * The amount typed in the withdraw sheet, as whole sen, or what is wrong with it. `availableSen` is
 * the balance less what started payments plan to use.
 */
export function readWithdrawAmount(text: string, availableSen: number): WithdrawAmount {
  const amountSen = parseRinggitInput(text);
  if (amountSen === null || amountSen === undefined) {
    return { error: 'Enter an amount in ringgit, for example 50 or 12.50.' };
  }
  if (amountSen > availableSen) {
    return { error: `You can withdraw up to ${formatRM(availableSen)}.` };
  }
  return { amountSen };
}
