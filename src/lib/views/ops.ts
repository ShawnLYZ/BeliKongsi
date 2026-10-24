import type { MoneyCheck } from '@/server/modules/ledger/checks';

export type OpsRoundStatus =
  | 'scheduled'
  | 'open'
  | 'empty'
  | 'failed'
  | 'formed'
  | 'ordered'
  | 'confirmed'
  | 'dispatched'
  | 'at_hub'
  | 'completed'
  | 'cancelled';

/** One card on the Ops rounds board. */
export interface OpsRoundCard {
  roundId: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  hubName: string;
  cycleLabel: string;
  status: OpsRoundStatus;
  cutoffAt: string;
  finalTier: number | null;
  finalUnitPriceSen: number | null;
  totalKept: number | null;
  shopCount: number;
  supplierOrderId: string | null;
  supplierOrderStatus: string | null;
}

export interface OpsRoundsBoard {
  columns: { status: OpsRoundStatus; rounds: OpsRoundCard[] }[];
  stats: {
    successRate: number;
    averageTier: number | null;
    averageShopsPerRound: number | null;
  };
}

export interface OpsParticipantView {
  participationId: string;
  shopId: string;
  shopName: string;
  quantity: number;
  joinedAt: string;
  priceLimitSen: number | null;
  status: string;
  finalAllInSen: number | null;
  paidSen: number;
  refundSen: number;
  allocated: number | null;
  missing: number | null;
}

export interface OpsRoundDetail {
  round: OpsRoundCard;
  participants: OpsParticipantView[];
  engineResult: {
    finalTier: number | null;
    finalUnitPriceSen: number | null;
    totalAtCutoff: number | null;
    totalKept: number | null;
    closeIterations: number | null;
    closedAt: string | null;
  };
  ledger: { holdBalanceSen: number; postingsByKind: Record<string, number> };
  moneyCheck: { passed: boolean; checks: MoneyCheck[] };
}

export type OpsMoneyFailure = MoneyCheck['failures'][number] & { link?: string };
export type OpsMoneyCheck = Omit<MoneyCheck, 'failures'> & { failures: OpsMoneyFailure[] };

export interface MoneyOverview {
  heldPerOpenRound: { roundId: string; productName: string; heldSen: number }[];
  refundsByKind: Record<string, number>;
  supplierPayoutsSen: number;
  feeRevenueSen: number;
  logisticsPayableSen: number;
  deliveryFeesHeldSen: number;
  claimsExpenseSen: number;
  partnerCashSen: number;
  checks: OpsMoneyCheck[];
}

/** The five §27 metrics. A rate or median is null (shown as a dash) until there is data. */
export interface ImpactView {
  timeToApprove: { medianMinutes: number | null; p90Minutes: number | null; samples: number };
  basketApprovalRate: { approved: number; drafted: number; rate: number | null };
  aiLinesAcceptedUnchanged: { accepted: number; suggested: number; rate: number | null };
  claimRate: { claimedUnits: number; deliveredUnits: number; rate: number | null };
  supplierReliability: {
    supplierId: string;
    supplierName: string;
    medianConfirmationHours: number | null;
    goodUnitsRate: number | null;
  }[];
}
