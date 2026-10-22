import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import type { TxContext } from '@/server/platform/tx';
import type { ActionCode } from './actions';
import { canonicalJson } from './canonical';

type Json = Prisma.InputJsonValue;

export type LogEntryInput = {
  action: ActionCode;
  subjectType: string;
  subjectId: string;
  scope: { shopId?: string; supplierId?: string; operator?: boolean };
  before?: Json;
  after?: Json;
  reason?: string;
  aiMetadata?: {
    model: string;
    lineCount: number;
    averageConfidence: number;
    suggestionRunId: string;
  };
};

export const GENESIS_HASH = '0'.repeat(64);

type HashedFields = {
  seq: bigint;
  occurredAt: Date;
  actorUserId: string | null;
  actorRole: string | null;
  actorType: string;
  shopId: string | null;
  supplierId: string | null;
  operatorScope: boolean;
  action: string;
  subjectType: string;
  subjectId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  aiMetadata: unknown;
};

// Exactly the PRD field set. Absent values hash as null, so what is written equals what is read back.
function entryHash(prevHash: string, f: HashedFields): string {
  const fields: HashedFields = {
    seq: f.seq,
    occurredAt: f.occurredAt,
    actorUserId: f.actorUserId,
    actorRole: f.actorRole,
    actorType: f.actorType,
    shopId: f.shopId,
    supplierId: f.supplierId,
    operatorScope: f.operatorScope,
    action: f.action,
    subjectType: f.subjectType,
    subjectId: f.subjectId,
    before: f.before ?? null,
    after: f.after ?? null,
    reason: f.reason,
    aiMetadata: f.aiMetadata ?? null,
  };
  return createHash('sha256')
    .update(prevHash + canonicalJson(fields))
    .digest('hex');
}

export async function appendLog(
  ctx: TxContext,
  entry: LogEntryInput,
): Promise<{ seq: bigint; hash: string }> {
  const { tx, actor, now } = ctx;
  // The row lock serialises writers: the next one waits until this transaction commits.
  const heads = await tx.$queryRaw<{ last_seq: bigint; last_hash: string }[]>`
    SELECT last_seq, last_hash FROM activity_chain_head WHERE id = 1 FOR UPDATE`;
  const head = heads[0];
  if (!head) throw new Error('activity chain head is missing');

  const seq = BigInt(head.last_seq) + 1n;
  const fields: HashedFields = {
    seq,
    occurredAt: now,
    actorUserId: actor.type === 'person' ? actor.userId : null,
    actorRole: actor.type === 'person' ? actor.role : null,
    actorType: actor.type,
    shopId: entry.scope.shopId ?? null,
    supplierId: entry.scope.supplierId ?? null,
    operatorScope: entry.scope.operator ?? false,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    aiMetadata: entry.aiMetadata ?? null,
  };
  const hash = entryHash(head.last_hash, fields);

  await tx.activityLogEntry.create({
    data: {
      seq,
      occurredAt: now,
      actorUserId: fields.actorUserId,
      actorRole: actor.type === 'person' ? actor.role : null,
      actorType: actor.type,
      shopId: fields.shopId,
      supplierId: fields.supplierId,
      operatorScope: fields.operatorScope,
      action: fields.action,
      subjectType: fields.subjectType,
      subjectId: fields.subjectId,
      before: entry.before ?? Prisma.DbNull,
      after: entry.after ?? Prisma.DbNull,
      reason: fields.reason,
      aiMetadata: entry.aiMetadata ?? Prisma.DbNull,
      prevHash: head.last_hash,
      hash,
    },
  });
  await tx.activityChainHead.update({ where: { id: 1 }, data: { lastSeq: seq, lastHash: hash } });
  return { seq, hash };
}

export async function verifyLogChain(
  prisma: PrismaClient,
): Promise<{ valid: true; count: number } | { valid: false; firstBrokenSeq: string }> {
  // Read the head first: rows appended after this point are not part of this check, and a
  // deleted tail shows up as a missing seq or a last row that does not match the head.
  const heads = await prisma.$queryRaw<{ last_seq: bigint; last_hash: string }[]>`
    SELECT last_seq, last_hash FROM activity_chain_head WHERE id = 1`;
  const head = heads[0];
  if (!head) return { valid: false, firstBrokenSeq: '1' };
  const lastSeq = BigInt(head.last_seq);

  let prev = GENESIS_HASH;
  let count = 0;
  let expectedSeq = 1n;
  while (expectedSeq <= lastSeq) {
    const rows = await prisma.activityLogEntry.findMany({
      where: { seq: { gte: expectedSeq, lte: lastSeq } },
      orderBy: { seq: 'asc' },
      take: 500,
    });
    if (rows.length === 0) return { valid: false, firstBrokenSeq: expectedSeq.toString() };
    for (const r of rows) {
      if (r.seq !== expectedSeq || r.prevHash !== prev || r.hash !== entryHash(prev, r)) {
        return { valid: false, firstBrokenSeq: expectedSeq.toString() };
      }
      prev = r.hash;
      count++;
      expectedSeq++;
    }
  }
  if (prev !== head.last_hash) {
    return { valid: false, firstBrokenSeq: (lastSeq > 0n ? lastSeq : 1n).toString() };
  }
  return { valid: true, count };
}
