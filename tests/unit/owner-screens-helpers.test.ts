import { describe, expect, it } from 'vitest';
import { readWithdrawAmount } from '@/components/money/withdraw-amount';
import {
  blockersText,
  deletionEvidenceOf,
  openItemCount,
} from '@/components/ops/deletion-evidence';
import { deliveryStatusLabel } from '@/components/ops/webhooks-panel';
import { readMinutes } from '@/components/settings/minutes';
import { duration } from '@/lib/duration';

describe('duration', () => {
  it('shows minutes, whole hours, and hours with minutes', () => {
    expect(duration(0)).toBe('0 min');
    expect(duration(45)).toBe('45 min');
    expect(duration(60)).toBe('1 h');
    expect(duration(95)).toBe('1 h 35 min');
    expect(duration(120)).toBe('2 h');
  });
  it('never goes below zero', () => {
    expect(duration(-5)).toBe('0 min');
  });
});

describe('deletionEvidenceOf', () => {
  it('reads full server evidence, trusting canApprove', () => {
    const e = deletionEvidenceOf({
      activeRounds: 1,
      openPickups: 2,
      openClaims: 0,
      pendingPayments: 3,
      balanceSen: 7344,
      canApprove: false,
    });
    expect(e).toEqual({
      activeRounds: 1,
      openPickups: 2,
      openClaims: 0,
      pendingPayments: 3,
      balanceSen: 7344,
      canApprove: false,
    });
    expect(deletionEvidenceOf({ ...e, balanceSen: 0, canApprove: true }).canApprove).toBe(true);
  });
  it('fills missing or malformed counts with zero', () => {
    expect(deletionEvidenceOf({ activeRounds: 2, balanceSen: 'x' })).toEqual({
      activeRounds: 2,
      openPickups: 0,
      openClaims: 0,
      pendingPayments: 0,
      balanceSen: 0,
      canApprove: false,
    });
    expect(deletionEvidenceOf(null).canApprove).toBe(false);
    expect(deletionEvidenceOf('nope').activeRounds).toBe(0);
  });
  it('is never approvable after a refused approve', () => {
    expect(deletionEvidenceOf({ canApprove: true }, { refused: true }).canApprove).toBe(false);
  });
});

describe('blockersText and openItemCount', () => {
  it('lists only what is open, with plurals', () => {
    const e = deletionEvidenceOf({ activeRounds: 1, openClaims: 2, pendingPayments: 1 });
    expect(blockersText(e)).toBe('1 active round, 2 open claims, 1 pending payment');
    expect(openItemCount(e)).toBe(4);
  });
  it('is empty when nothing is open', () => {
    expect(blockersText(deletionEvidenceOf({ balanceSen: 500 }))).toBe('');
  });
});

describe('readWithdrawAmount', () => {
  it('reads ringgit as whole sen', () => {
    expect(readWithdrawAmount('10', 7344)).toEqual({ amountSen: 1000 });
    expect(readWithdrawAmount('RM 73.44', 7344)).toEqual({ amountSen: 7344 });
    expect(readWithdrawAmount('0.1', 7344)).toEqual({ amountSen: 10 });
  });
  it('refuses empty, zero, malformed and too-large amounts', () => {
    for (const bad of ['', '0', 'abc', '1.234', '-5']) {
      expect(readWithdrawAmount(bad, 7344)).toHaveProperty('error');
    }
    expect(readWithdrawAmount('73.45', 7344)).toEqual({
      error: 'You can withdraw up to RM 73.44.',
    });
  });
});

describe('readMinutes', () => {
  it('accepts whole minutes from 0 to 600', () => {
    expect(readMinutes('0')).toEqual({ minutes: 0 });
    expect(readMinutes(' 90 ')).toEqual({ minutes: 90 });
    expect(readMinutes('600')).toEqual({ minutes: 600 });
  });
  it('refuses empty, negative, fractional and too-large values', () => {
    for (const bad of ['', '-1', '1.5', '601', 'abc', '1e2']) {
      expect(readMinutes(bad)).toHaveProperty('error');
    }
  });
});

describe('deliveryStatusLabel', () => {
  it('shows a pending delivery not yet tried as queued and one after a failure as waiting to retry', () => {
    expect(deliveryStatusLabel({ status: 'pending', attempt: 0 })).toBe('Queued');
    expect(deliveryStatusLabel({ status: 'pending', attempt: 1 })).toBe('Waiting to retry');
    expect(deliveryStatusLabel({ status: 'succeeded', attempt: 1 })).toBe('Delivered');
    expect(deliveryStatusLabel({ status: 'failed', attempt: 6 })).toBe('Gave up');
  });
});
