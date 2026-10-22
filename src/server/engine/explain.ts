import { formatRM, formatUnits } from './money';
import type { CloseParticipantResult } from './close-round';
import type { QuoteResult } from './quote';
import type { Sen } from './types';

/** Plain-English sentences for a quote, in the order they are shown. */
export function explainQuote(result: QuoteResult, quantity: number, unitName: string): string[] {
  const { starting, withoutYou, withYou, limit } = result;
  const sentences: string[] = [];

  sentences.push(
    `You pay ${formatRM(starting.allInSen)} a ${unitName} now: the starting price. Anything above the final price comes back to your balance at cut-off.`,
  );

  if (withoutYou.nextTier === null) {
    sentences.push(
      `${formatUnits(withoutYou.total, unitName)} so far: the top tier, ${formatRM(withoutYou.amounts?.goodsSen ?? 0)}.`,
    );
  } else {
    const more = formatUnits(withoutYou.unitsToNextTier ?? 0, unitName);
    sentences.push(
      `${formatUnits(withoutYou.total, unitName)} so far. ${more.replace(/^(\d+) /, '$1 more ')} and everyone pays ${formatRM(withoutYou.nextTier.unitPriceSen)}.`,
    );
  }

  if (withYou.amounts === null) {
    const needed = withYou.unitsToNextTier ?? 0;
    const minimum = withYou.nextTier?.minQuantity ?? 0;
    sentences.push(
      `The round needs ${formatUnits(needed, unitName).replace(/^(\d+) /, '$1 more ')} to reach its minimum of ${minimum}. If it doesn't, everyone is refunded in full.`,
    );
  } else {
    sentences.push(
      `Your ${formatUnits(quantity, unitName)} take it to ${withYou.total}: the ${formatRM(withYou.amounts.goodsSen)} tier.`,
    );
    sentences.push(
      `Your all-in price: ${formatRM(withYou.amounts.allInSen)} (${formatRM(withYou.amounts.goodsSen)} goods + ${formatRM(withYou.amounts.feeSen)} BeliKongsi fee + ${formatRM(withYou.amounts.shippingSen)} shipping).`,
    );
  }

  if (limit !== null && limit.belowStarting) {
    if (limit.lowestTierMeetingLimit === null) {
      sentences.push(
        `No price tier is within your limit of ${formatRM(limit.priceLimitSen)}, so this line would be refunded at cut-off.`,
      );
    } else {
      sentences.push(
        `You'll only be in if the round reaches ${limit.lowestTierMeetingLimit.minQuantity}+ ${unitName}s.`,
      );
    }
  }

  return sentences;
}

export interface OutcomeContext {
  finalTier: number | null;
  minQuantity: number;
  unitName: string;
  priceLimitSen: Sen | null;
}

/** One plain-English sentence saying what happened to a participation when the round closed. */
export function explainOutcome(result: CloseParticipantResult, ctx: OutcomeContext): string {
  if (result.outcome === 'refunded_failed') {
    return `The round didn't reach its minimum of ${formatUnits(ctx.minQuantity, ctx.unitName)}. Full refund: ${formatRM(result.refundSen)}.`;
  }
  if (result.outcome === 'dropped_price_limit') {
    return `Dropped: the final all-in price of ${formatRM(result.final?.allInSen ?? 0)} is above your limit of ${formatRM(ctx.priceLimitSen ?? 0)}. Full refund: ${formatRM(result.refundSen)}.`;
  }
  const head = `Kept at tier ${ctx.finalTier}: ${formatRM(result.final?.allInSen ?? 0)} all-in.`;
  return result.refundSen > 0
    ? `${head} Refund: ${formatRM(result.refundSen)}.`
    : `${head} No refund: you paid the final price.`;
}
