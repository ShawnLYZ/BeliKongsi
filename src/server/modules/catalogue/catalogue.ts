import type { PrismaClient, Product } from '@/generated/prisma/client';
import type { CatalogueEntry } from '@/server/adapters/ai/types';
import type { CatalogueItemView, StaffCatalogueItemView } from '@/lib/views/catalogue';
import type { Caller } from '@/server/platform/caller';
import type { AppDeps } from '@/server/platform/deps';
import { forbidden } from '@/server/platform/errors';
import { isStaff, productImageUrl, roundProgress, tierViews } from '@/server/modules/rounds/read';

/** NFKC, lower case, collapsed whitespace, trimmed: full-width and mixed-case input match. */
export function normaliseSearch(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 0 exact, 1 prefix, 2 substring in either direction; null for no match. */
function matchRank(
  query: string,
  product: Pick<Product, 'name' | 'shortName' | 'aliases'>,
): number | null {
  let best: number | null = null;
  for (const raw of [product.name, product.shortName, ...product.aliases]) {
    const candidate = normaliseSearch(raw);
    if (!candidate) continue;
    const rank =
      candidate === query
        ? 0
        : candidate.startsWith(query)
          ? 1
          : candidate.includes(query) || query.includes(candidate)
            ? 2
            : null;
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
}

export async function searchCatalogue(
  deps: AppDeps,
  caller: Caller,
  q: string | null,
): Promise<CatalogueItemView[] | StaffCatalogueItemView[]> {
  // Suppliers do not browse the catalogue (PRD section 20): owners, staff and Ops only.
  if (caller.kind === 'person' && caller.session.membership.role === 'supplier') throw forbidden();
  const query = normaliseSearch(q ?? '');
  const products = await deps.prisma.product.findMany({
    where: { active: true },
    include: {
      supplier: true,
      tiers: { orderBy: { position: 'asc' } },
      rounds: { where: { status: 'open' }, take: 1 },
    },
    orderBy: { name: 'asc' },
  });
  type Row = (typeof products)[number];
  const ranked = products
    .map((p) => ({ p, rank: query ? matchRank(query, p) : 0 }))
    .filter((x): x is { p: Row; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank);

  // A product with an open round is shown in that round's unit and pack, frozen when it opened.
  const unitOf = (p: Row) => p.rounds[0] ?? p;
  if (isStaff(caller)) {
    return ranked.map(({ p }) => ({
      productId: p.id,
      name: p.name,
      shortName: p.shortName,
      packDescription: unitOf(p).packDescription,
      unitName: unitOf(p).unitName,
      category: p.category,
      imageUrl: productImageUrl(deps, p),
      imageAiGenerated: p.imageAiGenerated,
    }));
  }

  const items: CatalogueItemView[] = [];
  for (const { p } of ranked) {
    const round = p.rounds[0] ?? null;
    const progress = round ? await roundProgress(deps.prisma, round.id) : null;
    items.push({
      productId: p.id,
      name: p.name,
      shortName: p.shortName,
      packDescription: unitOf(p).packDescription,
      unitName: unitOf(p).unitName,
      category: p.category,
      supplierName: p.supplier.name,
      imageUrl: productImageUrl(deps, p),
      imageAiGenerated: p.imageAiGenerated,
      // An open round's frozen tiers and buy-alone price are what owners will actually get.
      buyAlonePriceSen: round ? round.buyAlonePriceSen : p.buyAlonePriceSen,
      tiers: round
        ? tierViews(round)
        : p.tiers.map((t) => ({
            position: t.position,
            minQuantity: t.minQuantity,
            unitPriceSen: t.unitPriceSen,
          })),
      openRound:
        round && progress
          ? {
              roundId: round.id,
              cutoffAt: round.cutoffAt.toISOString(),
              totalQuantity: progress.totalQuantity,
              shopCount: progress.shopCount,
              currentTier: progress.currentTier,
            }
          : null,
    });
  }
  return items;
}

/** The active products as the AI sees them: enough to match words to ids, and nothing priced. */
export async function catalogueEntriesForAi(
  db: Pick<PrismaClient, 'product'>,
): Promise<CatalogueEntry[]> {
  const products = await db.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    packDescription: p.packDescription,
    unitName: p.unitName,
    aliases: p.aliases,
    packConversions: Object.fromEntries(
      Object.entries((p.packConversions ?? {}) as Record<string, unknown>).filter(
        (e): e is [string, number] => typeof e[1] === 'number',
      ),
    ),
  }));
}
