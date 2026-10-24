# M13 P1 Supplier Self-Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppliers keep their own catalogue current: products, tiers, buy-alone prices, schedules and photos. Changes always apply from the next round. Suppliers can paste or photograph a price list and let AI draft the tier table for them to confirm.

**Architecture:**

- A new `catalogue/supplier-edit.ts` validates every ladder with the engine and writes products. The open round keeps its frozen snapshot, so changes reach owners only through `openNextRound`.
- The AI adapter gains `readPriceList` (text or image). Its output goes through the same validation, and is saved only on the supplier's confirmation.

**Tech Stack:** the M1 engine (`validateTiers`), the M3 AI adapter and storage, Zod.

**Spec:** build design §9 P1-12, P1-13; PRD stories 113, 114, 115; PRD §3 (catalogue "P1: supplier create and edit"), §16 (P1 price lists), §20 (supplier product and price-list endpoints).

## Global Constraints

- Index §2 (G1–G10) applies.
- PRD §6.2 and §4: 1 to 5 tiers; minimums are positive whole numbers that strictly increase; prices are positive and strictly decrease; every tier is below the buy-alone price.
- Story 115: price changes apply from the next round only; the open round's tiers stay frozen.
- P1-12: the schedule is cadence, anchor week, cut-off weekday (1–7) and cut-off time (`HH:MM`, 00:00–23:59; default Thursday 20:00). A new product's first round opens straight away. Deactivating a product lets its open round finish and opens no new one. Photos are optional, with the category icon otherwise, and images are never generated at runtime.
- P1-13: nothing is saved until the supplier confirms; at most 10 imports per supplier per hour; logged like usual-list reading (actor AI for the suggestion, the person for the confirmation).
- New action codes: `product.created`, `product.updated`, `price_list.ai_suggested`, `price_list.confirmed`. `AiRunKind` gains `price_list`.

## Review Focus

1. **A supplier edits tiers while a round is open:** that round's tiers and every owner's quote stay unchanged. Pinned in Task 1.
2. **Equal minimums or non-decreasing prices:** 422 listing each bad tier position. Pinned in Task 1.
3. **A cut-off time of "24:00" or weekday 8:** 400 before anything is saved. Pinned in Task 1.
4. **The AI drafts a ladder whose prices go up:** the line is flagged with the errors, and confirming it is refused until fixed. Pinned in Task 3.
5. **A price-list photo that isn't an image, or is too large:** 422 before the AI is called. Pinned in Task 3.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m13-p1-supplier-self-service`
- [ ] **Step 2:** Follow index §6. Confirm the consumed names: `validateTiers`, `openNextRound`, `closeRoundById` (it skips inactive products), `createGeminiOrderReader` and its injectable `generate`, `redactPersonalData`, `enforceRateLimit`, `StorageAdapter.createSignedUploadUrl`.
- [ ] **Step 3:** Commit any plan edits.

**Re-sync notes (2026-10-24):** `openNextRound` is `(ctx: TxContext, productId, opensAt)`; `createSignedUploadUrl` was typed for `delivery-photos` only, so Task 2 also widens `storage/types.ts`; Gemini's injectable `generate` is text-only, so Task 3 widens it. All other consumed names match.

---

### Task 1: Creating and editing products, tiers and schedules (P1-12)

**Files:**

- Create: `prisma/migrations/<ts>_p1_supplier/migration.sql` (enum additions), `src/server/modules/catalogue/supplier-edit.ts`, `src/app/api/suppliers/[supplierId]/products/[id]/route.ts`
- Modify: `src/app/api/suppliers/[supplierId]/products/route.ts` (add `POST`), `src/server/modules/activity/actions.ts`
- Test: `tests/api/supplier-products.test.ts`

**Interfaces:**

- Produces:
  - `ProductInput = { name; shortName; category; packDescription; unitName; unitWeightGrams: number; buyAlonePriceSen: number; aliases: string[]; packConversions?: Record<string, number>; cadence: Cadence; scheduleAnchorWeek?: string; cutoffWeekday: number; cutoffTime: string; tiers: { minQuantity: number; unitPriceSen: number }[] }`.
  - `createSupplierProduct(deps, caller, supplierId, input: ProductInput): Promise<SupplierProductView>`. It validates (Zod gives 400; tiers give 422 `INVALID_TIERS` with `details.errors` from `validateTiers`), creates the product (`imageAiGenerated: false`), runs `openNextRound(ctx, product.id, now)` in the same transaction, and logs `product.created`.
  - `updateSupplierProduct(deps, caller, supplierId, productId, patch: Partial<ProductInput> & { active?: boolean; imageKey?: string }): Promise<SupplierProductView>`. It never touches the open round, and logs `product.updated` with before and after.
  - Supplier only, for their own products; another supplier gets 404.

- [ ] **Step 1: Write the failing tests:**

```ts
it('keeps the open round frozen and uses new tiers from the next round (stories 113, 115)', async () => {
  await farid.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, {
    tiers: [
      { minQuantity: 20, unitPriceSen: 15700 },
      { minQuantity: 50, unitPriceSen: 15100 },
      { minQuantity: 100, unitPriceSen: 14500 },
    ],
  });
  expect((await round(cmRound)).tiersSnapshot).toEqual(CM_TIERS_SNAPSHOT);
  expect((await ah.get(`/api/rounds/${cmRound}/quote?quantity=6`)).body.starting.allInSen).toBe(
    16409,
  );
  app.clock.set('2026-11-05T12:00:00Z');
  await closeDueRounds(app.deps);
  expect((await openRoundOf('CM')).tiersSnapshot[0]).toMatchObject({ unitPriceSen: 15700 });
});
it('refuses a ladder that does not strictly improve, naming the positions', async () => {
  const r = await farid.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, {
    tiers: [
      { minQuantity: 20, unitPriceSen: 15800 },
      { minQuantity: 20, unitPriceSen: 15900 },
    ],
  });
  expect(r).toMatchObject({ status: 422, body: { code: 'INVALID_TIERS' } });
  expect(r.body.details.errors.map((e: any) => [e.code, e.position])).toEqual([
    ['MIN_QUANTITY_NOT_INCREASING', 2],
    ['PRICE_NOT_DECREASING', 2],
  ]);
});
it.each([
  ['24:00', 4],
  ['20:00', 8],
])('refuses cut-off %s on weekday %s', async (cutoffTime, cutoffWeekday) => {
  expect(
    (await farid.patch(`/api/suppliers/${SUP_DRY}/products/${CM}`, { cutoffTime, cutoffWeekday }))
      .status,
  ).toBe(400);
});
it('opens the first round of a new product straight away', async () => {
  /* POST a new product → its open round exists with cutoff = next Thursday 20:00 */
});
it('lets an open round finish when a product is deactivated', async () => {
  /* active false → close → no new round for that product */
});
it("hides another supplier's products", async () => {
  /* lim PATCH CM → 404 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(catalogue): supplier self-service products, tiers and schedules`

---

### Task 2: Supplier product photos

**Files:**

- Create: `src/app/api/suppliers/[supplierId]/products/[id]/image/route.ts`
- Modify: `src/server/adapters/storage/types.ts` (widen `createSignedUploadUrl`'s bucket to `Bucket`), `local.ts` and `supabase.ts` (signed uploads for `product-images`), `src/server/modules/catalogue/supplier-edit.ts`
- Test: `tests/api/supplier-product-image.test.ts`

**Interfaces:**

- Produces:
  - `requestProductImageUpload(deps, caller, supplierId, productId, { contentType, sizeBytes }): Promise<{ imageKey: string; upload }>`. Types JPEG, PNG or WebP; at most 5 MB; the key is `supplier/<productId>/<uuid>.<ext>`.
  - Then `PATCH … { imageKey }` sets it once `statObject` confirms the upload exists (otherwise 422 `IMAGE_NOT_UPLOADED`). It keeps `imageAiGenerated: false`, so no "AI-generated image" caption.

- [ ] **Step 1: Write the failing tests:** an upload, then `PATCH` sets the image and the public URL serves it; a `PATCH` with a key that was never uploaded gets 422; a GIF gets 422.
- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(catalogue): supplier-uploaded product photos`

---

### Task 3: AI price-list import (P1-13)

**Files:**

- Create: `src/server/adapters/ai/price-list.ts` (prompt, JSON schema, `toPriceListResult`), `src/server/modules/catalogue/price-list.ts`, `src/app/api/suppliers/[supplierId]/price-list/parse/route.ts`, `src/app/api/suppliers/[supplierId]/price-list/confirm/route.ts`, `tests/fixtures/price-lists/dry-goods.txt`
- Modify: `src/server/adapters/ai/types.ts` (`OrderReader.readPriceList`), `gemini.ts` (image input as `inlineData`; the injectable `generate` currently takes `{ model, prompt, text }` and gains an optional image part), `fake.ts`
- Test: `tests/api/price-list-import.test.ts`

**Interfaces:**

- Produces:
  - `readPriceList(i: { text?: string; image?: { bytes: Uint8Array; mimeType: string }; products: CatalogueEntry[] }): Promise<PriceListResult>`.
    - `PriceListResult = { lines: { sourceText: string; productId: string | null; proposedName: string | null; packDescription: string | null; unitName: UnitName | null; buyAlonePriceSen: number | null; tiers: { minQuantity: number; unitPriceSen: number }[]; confidence: number; note: string | null }[]; ignoredText: string[] }`
    - Prices are converted to sen by the model under the prompt's rules, and the server validates them.
  - `parsePriceList(deps, caller, supplierId, input: { text?: string; imageBase64?: string; mimeType?: string }): Promise<PriceListParseView>`:
    - Text is redacted.
    - Images: JPEG, PNG or WebP, at most 5 MB, and never stored.
    - Rate limit `price-list:<supplierId>` at 10 per hour.
    - It validates each line: unknown `productId` becomes `null` (a new-product draft); `validateTiers` with the buy-alone price gives `errors`; whole-number sen only.
    - It stores an `AiSuggestionRun` (kind `price_list`) and logs `price_list.ai_suggested` (actor AI).
  - `confirmPriceList(deps, caller, supplierId, { suggestionRunId: string; lines: ({ productId: string; patch: Partial<ProductInput> } | { create: ProductInput })[] }): Promise<{ updated: number; created: number }>`:
    - One transaction through `updateSupplierProduct` and `createSupplierProduct`.
    - Any invalid line gets 422, and nothing is applied.
    - It logs `price_list.confirmed` with a change summary.

- [ ] **Step 1: Write the failing tests** (fake adapter fixtures):

```ts
it('drafts tier tables from a pasted price list without saving anything (story 114)', async () => {
  const v = (
    await farid.post(`/api/suppliers/${SUP_DRY}/price-list/parse`, {
      text: readFixture('dry-goods.txt'),
    })
  ).body;
  expect(v.lines.find((l: any) => l.productId === CM).tiers).toEqual([
    { minQuantity: 20, unitPriceSen: 15700 },
    { minQuantity: 50, unitPriceSen: 15100 },
    { minQuantity: 100, unitPriceSen: 14500 },
  ]);
  expect(await app.prisma.priceTier.findMany({ where: { productId: CM } })).toEqual(originalTiers);
});
it('flags a drafted ladder whose prices go up and refuses to confirm it', async () => {
  // fixture line with prices 100, 120 → errors include PRICE_NOT_DECREASING; confirm with that line → 422; nothing applied
});
it('applies confirmed lines from the next round only', async () => {
  /* confirm → product tiers updated; open round snapshot unchanged */
});
it('refuses a non-image or oversized photo before calling the AI', async () => {
  /* mimeType 'application/pdf' → 422; fake.received empty */
});
it('limits imports to 10 an hour per supplier', async () => {
  /* 11th → 429 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(ai): import supplier price lists from text or photo`

---

### Task 4: Supplier catalogue screens

**Files:**

- Modify: `src/app/(shell)/supplier/products/page.tsx`
- Create: `src/app/(shell)/supplier/products/[id]/page.tsx`, `src/app/(shell)/supplier/products/new/page.tsx`, `src/app/(shell)/supplier/price-list/page.tsx`, `src/components/supplier/tier-editor.tsx`

- [ ] **Step 1: Build the editing screens.**
  - **Product form:** every `ProductInput` field.
  - **Tier editor:** live validation using the engine's pure `validateTiers`, which is safe in the browser because it imports nothing. It shows messages next to the bad row, plus "Changes apply from the next round (closes Thu 12 Nov)".
  - **Photo upload**, and an active switch.
- [ ] **Step 2: Build the import screen.** Paste or photograph a price list, with the notice "The photo is sent to our AI provider; cover any personal details." The review table shows matched products and new-product drafts, with errors highlighted. "Confirm" is disabled while errors remain.
- [ ] **Step 3: Verify at 390 × 844.** As Farid, edit condensed milk's tiers and import the fixture price list. As Ah Seng, the open round still quotes RM 164.09. Then run `pnpm verify`. Expected: PASS.
- [ ] **Step 4: Commit:** `feat(ui): supplier catalogue editing and price-list import`

---

### Milestone verification

- [ ] Run `pnpm verify` (with `e2e`).
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 113, 114, 115).
