import { Prisma } from '@/generated/prisma/client';
import type { UsualListView } from '@/lib/views/usual-list';
import { isoWeekOf } from '@/lib/time';
import { appendLog, type LogEntryInput } from '@/server/modules/activity/log';
import { draftBasketForShop } from '@/server/modules/baskets/draft';
import { productImageUrl } from '@/server/modules/rounds/read';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { badRequest, conflict, unprocessable } from '@/server/platform/errors';
import { requireShopAccess } from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';

export interface UsualListItemInput {
  productId: string;
  quantity: number;
  usualPriceSen: number | null;
  /** Omitted: the usual price. `null`: no limit. */
  priceLimitSen?: number | null;
}

export interface SaveUsualListInput {
  items: UsualListItemInput[];
  suggestionRunId?: string;
}

interface Fields {
  quantity: number;
  usualPriceSen: number | null;
  priceLimitSen: number | null;
}

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 999;
const FIELD_NAMES = ['quantity', 'usualPriceSen', 'priceLimitSen'] as const;
const SUGGESTION_ALREADY_CONFIRMED = () =>
  conflict('SUGGESTION_ALREADY_CONFIRMED', 'That suggestion was already confirmed.');

const withItems = { items: { include: { product: true } } } as const;
type ListWithItems = Prisma.UsualListGetPayload<{ include: typeof withItems }>;

function toView(deps: AppDeps, list: ListWithItems): UsualListView {
  return {
    items: [...list.items]
      .sort((a, b) => a.product.name.localeCompare(b.product.name) || (a.id < b.id ? -1 : 1))
      .map((i) => ({
        productId: i.productId,
        name: i.product.name,
        packDescription: i.product.packDescription,
        unitName: i.product.unitName,
        imageUrl: productImageUrl(deps, i.product),
        quantity: i.quantity,
        usualPriceSen: i.usualPriceSen,
        priceLimitSen: i.priceLimitSen,
      })),
    confirmedAt: list.confirmedAt.toISOString(),
  };
}

/** The shop's usual list, or null when the owner has not saved one yet. Owner only. */
export async function getUsualList(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
): Promise<UsualListView | null> {
  requireShopAccess(caller, shopId, ['owner']);
  const list = await deps.prisma.usualList.findUnique({ where: { shopId }, include: withItems });
  return list ? toView(deps, list) : null;
}

/** Checks one line and fills in the price limit: omitted takes the usual price, null means none. */
function normalise(item: UsualListItemInput): Fields {
  const { quantity, usualPriceSen } = item;
  if (!Number.isInteger(quantity) || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
    throw badRequest(`Quantity must be a whole number from ${MIN_QUANTITY} to ${MAX_QUANTITY}.`);
  }
  if (usualPriceSen !== null && (!Number.isInteger(usualPriceSen) || usualPriceSen <= 0)) {
    throw badRequest('The usual price must be a positive amount, or empty.');
  }
  let priceLimitSen: number | null;
  if (item.priceLimitSen === undefined) priceLimitSen = usualPriceSen;
  else if (item.priceLimitSen === null) priceLimitSen = null;
  else if (!Number.isInteger(item.priceLimitSen) || item.priceLimitSen <= 0) {
    throw unprocessable('PRICE_LIMIT_NOT_POSITIVE', 'The price limit must be more than zero.');
  } else priceLimitSen = item.priceLimitSen;
  return { quantity, usualPriceSen, priceLimitSen };
}

/** Only the fields that differ, as `before` and `after`; null when nothing differs. */
function diffFields(old: Fields, next: Fields) {
  const before: Record<string, number | null> = {};
  const after: Record<string, number | null> = {};
  for (const f of FIELD_NAMES) {
    if (old[f] !== next[f]) {
      before[f] = old[f];
      after[f] = next[f];
    }
  }
  return Object.keys(after).length ? { before, after } : null;
}

interface SuggestedLine {
  product: { id: string } | null;
  quantity: number | null;
}

function suggestedLines(suggestions: unknown): SuggestedLine[] | null {
  const lines = (suggestions as { lines?: unknown } | null)?.lines;
  return Array.isArray(lines) ? (lines as SuggestedLine[]) : null;
}

/**
 * Compares the saved list with the lines the AI suggested, product by product. Suggested lines
 * with no product are ignored; price edits do not count as changes.
 */
export function summariseChanges(suggested: SuggestedLine[], saved: Map<string, Fields>) {
  const suggestedQty = new Map<string, number | null>();
  for (const l of suggested) {
    if (l.product && !suggestedQty.has(l.product.id)) suggestedQty.set(l.product.id, l.quantity);
  }
  let acceptedUnchanged = 0;
  let changed = 0;
  let added = 0;
  for (const [productId, fields] of saved) {
    if (!suggestedQty.has(productId)) added++;
    else if (suggestedQty.get(productId) === fields.quantity) acceptedUnchanged++;
    else changed++;
  }
  let removed = 0;
  for (const productId of suggestedQty.keys()) if (!saved.has(productId)) removed++;
  return { acceptedUnchanged, changed, added, removed };
}

const nullJson = Prisma.JsonNull as unknown as Prisma.InputJsonValue;

/**
 * Owner only. Replaces the shop's usual list. The first save, or any save that names a suggestion
 * run, logs one `usual_list.confirmed`; later edits log one `usual_list.item_updated` per changed,
 * added (before null) or removed (after null) item. A bad suggestion run is a 400; one already
 * confirmed is a 409. Everything happens in one transaction.
 */
export async function saveUsualList(
  deps: AppDeps,
  caller: Caller,
  shopId: string,
  input: SaveUsualListInput,
): Promise<UsualListView> {
  requireShopAccess(caller, shopId, ['owner']);

  const saved = new Map<string, Fields>();
  for (const item of input.items) {
    if (saved.has(item.productId)) throw badRequest('A product can only appear once.');
    saved.set(item.productId, normalise(item));
  }

  return withTransaction(deps, caller, async (ctx) => {
    const { tx, now } = ctx;
    let suggested: SuggestedLine[] | null = null;
    if (input.suggestionRunId) {
      const run = await tx.aiSuggestionRun.findUnique({ where: { id: input.suggestionRunId } });
      const lines = run && run.shopId === shopId ? suggestedLines(run.suggestions) : null;
      if (!run || !lines) throw badRequest('That suggestion does not belong to this shop.');
      if (run.confirmedAt) throw SUGGESTION_ALREADY_CONFIRMED();
      suggested = lines;
    }

    const existing = await tx.usualList.findUnique({ where: { shopId }, include: withItems });
    // New products must be active; one already on the list may stay after it is deactivated.
    const onList = new Set((existing?.items ?? []).map((i) => i.productId));
    const found = await tx.product.findMany({
      where: { id: { in: [...saved.keys()] } },
      select: { id: true, active: true },
    });
    const foundById = new Map(found.map((x) => [x.id, x.active]));
    for (const id of saved.keys()) {
      const active = foundById.get(id);
      if (active === undefined || (!active && !onList.has(id))) {
        throw badRequest('One of the products does not exist or is not available.');
      }
    }

    const isConfirm = !existing || suggested !== null;
    const scope = { shopId };

    let listId: string;
    if (existing) {
      listId = existing.id;
      await tx.usualList.update({
        where: { id: listId },
        data: { updatedAt: now, ...(isConfirm ? { confirmedAt: now } : {}) },
      });
    } else {
      const created = await tx.usualList.create({
        data: { shopId, confirmedAt: now, updatedAt: now },
      });
      listId = created.id;
    }

    // Bring the stored items in line with the new set, keeping the ids of items that stay.
    const old = new Map((existing?.items ?? []).map((i) => [i.productId, i]));
    const itemLogs: LogEntryInput[] = [];
    for (const [productId, next] of saved) {
      const prev = old.get(productId);
      if (!prev) {
        const created = await tx.usualListItem.create({
          data: { usualListId: listId, productId, ...next },
        });
        itemLogs.push({
          action: 'usual_list.item_updated',
          subjectType: 'usual_list_item',
          subjectId: created.id,
          scope,
          before: nullJson,
          after: { productId, ...next },
        });
        continue;
      }
      const diff = diffFields(prev, next);
      if (!diff) continue;
      await tx.usualListItem.update({ where: { id: prev.id }, data: next });
      itemLogs.push({
        action: 'usual_list.item_updated',
        subjectType: 'usual_list_item',
        subjectId: prev.id,
        scope,
        ...diff,
      });
    }
    for (const [productId, prev] of old) {
      if (saved.has(productId)) continue;
      await tx.usualListItem.delete({ where: { id: prev.id } });
      itemLogs.push({
        action: 'usual_list.item_updated',
        subjectType: 'usual_list_item',
        subjectId: prev.id,
        scope,
        before: {
          productId,
          quantity: prev.quantity,
          usualPriceSen: prev.usualPriceSen,
          priceLimitSen: prev.priceLimitSen,
        },
        after: nullJson,
      });
    }

    if (isConfirm) {
      const changeSummary = summariseChanges(suggested ?? [], saved);
      if (input.suggestionRunId) {
        const marked = await tx.aiSuggestionRun.updateMany({
          where: { id: input.suggestionRunId, confirmedAt: null },
          data: { confirmedAt: now, changeSummary },
        });
        if (marked.count !== 1) throw SUGGESTION_ALREADY_CONFIRMED();
      }
      await appendLog(ctx, {
        action: 'usual_list.confirmed',
        subjectType: 'usual_list',
        subjectId: listId,
        scope,
        after: {
          itemCount: saved.size,
          changeSummary,
          ...(input.suggestionRunId ? { suggestionRunId: input.suggestionRunId } : {}),
        },
      });
    } else {
      for (const entry of itemLogs) await appendLog(ctx, entry);
    }

    // A shop that saves its list during an open week gets this week's basket straight away, as a
    // plain draft: the auto-approve rule runs only on the weekly job.
    await draftBasketForShop(ctx, shopId, isoWeekOf(now));

    const list = await tx.usualList.findUniqueOrThrow({
      where: { id: listId },
      include: withItems,
    });
    return toView(deps, list);
  });
}
