# M14 P1 AI Photo and Impact Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners can build their usual list from a photo of an old invoice, with the photo never stored. Ops get an impact panel showing time to approve, approval rate, AI acceptance, claim rate and supplier reliability.

**Architecture:**

- The AI adapter gains `readOrderImage`, which returns the same `ReadResult` as text, so the photo path reuses M3's validation, review screen and confirmation.
- Metrics are computed on demand from existing tables (baskets, payments, AI runs, claims, hub checks, approvals) by `ops/impact.ts`.

**Tech Stack:** `@google/genai` image input, Playwright (rendering synthetic invoice fixtures), shadcn/ui.

**Spec:** build design §9 P1-14 (decision), P1-15, §6.5; PRD story 26; PRD §16 (P1 image input), §25 (notice), §27 (metrics marked "P1 impact panel", "Ops (P1)").

## Global Constraints

- Index §2 (G1–G10) applies.
- P1-14: same output, validation and confirmation as pasted text. The upload screen asks the owner to cover names and phone numbers. The photo goes to Gemini and is never stored by BeliKongsi, and the privacy notice says so.
- PRD §16: images only; the same rate limit applies (10 parses per shop per hour, shared with text).
- PRD §27 metric definitions:
  - **time to approve:** from opening the basket to successful payment, in minutes
  - **basket approval rate:** approved ÷ drafted baskets
  - **AI lines accepted unchanged:** the share of suggested lines saved unchanged
  - **claim rate:** claimed units ÷ delivered units
  - **supplier reliability:** confirmation time, and good units ÷ ordered units
- Before building the impact page, load the `dataviz` skill, as that skill requires for stat tiles and dashboards.

## Review Focus

1. **A photo that isn't an invoice:** a 200 with no lines and the hint "We couldn't find any items in this photo", not an error. Pinned in Task 1.
2. **An iPhone HEIC photo:** the browser converts it to JPEG before upload. The server still accepts only JPEG, PNG and WebP. Pinned in Task 1.
3. **The impact panel before any data exists:** every metric shows "—", never `NaN` or a division error. Pinned in Task 3.
4. **The median of an even number of samples:** the mean of the two middle values, rounded to whole minutes. Pinned in Task 3.
5. **The photo's bytes:** they never reach the database, the log or storage. Pinned in Task 1.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m14-p1-ai-photo-impact`
- [ ] **Step 2:** Follow index §6. Confirm the consumed names:
  - M3: `parseUsualListText` and its validation helpers, `OrderReader`, `createGeminiOrderReader`.
  - M13: `readPriceList`'s image handling, `enforceRateLimit`.
  - `AiSuggestionRun.changeSummary`, `WeeklyBasket.firstOpenedAt`.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Invoice photo → usual list (P1-14)

**Files:**

- Create: `src/app/api/shops/[shopId]/usual-list/parse-photo/route.ts`, `src/components/setup/invoice-photo-picker.tsx`
- Modify:
  - `src/server/adapters/ai/types.ts`, `gemini.ts`, `fake.ts`: add `readOrderImage(i: { image: { bytes: Uint8Array; mimeType: string }; catalogue: CatalogueEntry[] }): Promise<ReadResult>`.
  - `src/server/modules/usual-list/parse.ts`: add `parseUsualListPhoto`, sharing validation with the text path.
  - Prisma enum `AiRunKind` += `usual_list_photo` (migration).
  - The data notice text in setup and settings.
- Test: `tests/api/usual-list-photo.test.ts`

**Interfaces:**

- Produces: `parseUsualListPhoto(deps, caller, shopId, { imageBase64: string; mimeType: string }): Promise<ParseView>` (owner).
  - JPEG, PNG or WebP only, otherwise 422 `UNSUPPORTED_TYPE`; at most 5 MB, otherwise 422 `TOO_LARGE`.
  - The rate-limit bucket is `ai-parse:<shopId>`, shared with text.
  - The run is stored with `redactedInput = '[photo, not stored]'`. The image is held only in memory for the call.
  - With no lines, the view's `ignoredText` stays as returned, and the UI shows the hint.
  - **The notice text** (setup step 1 and settings): "If you use a photo, it is sent to our AI provider so it can be read, and BeliKongsi does not keep it. Cover names and phone numbers before you take the photo."
  - **The picker** (`invoice-photo-picker.tsx`): accepts `image/*` and converts any image to JPEG through a canvas (quality 0.85, at most 2,000 px on the long side) before upload.

- [ ] **Step 1: Write the failing tests:**

```ts
it('reads an invoice photo with the same review as pasted text (story 26)', async () => {
  const v = (
    await ah.post(`/api/shops/${KEDAI}/usual-list/parse-photo`, {
      imageBase64: b64(invoiceFixture),
      mimeType: 'image/jpeg',
    })
  ).body;
  expect(v.lines.map((l: any) => [l.product?.id ?? null, l.quantity])).toEqual(expectedFromFixture);
});
it('never stores the photo', async () => {
  const run = await app.prisma.aiSuggestionRun.findFirstOrThrow({
    where: { kind: 'usual_list_photo' },
  });
  expect(run.redactedInput).toBe('[photo, not stored]');
  expect(JSON.stringify(await app.prisma.activityLogEntry.findMany())).not.toContain(
    b64(invoiceFixture).slice(0, 40),
  );
  expect(listFilesRecursively('.data/storage-test')).toEqual(filesBefore);
});
it('answers a photo with no items with an empty review', async () => {
  /* fake returns no lines → 200, lines [] */
});
it.each([
  ['image/heic', 1000],
  ['application/pdf', 1000],
  ['image/jpeg', 6 * 1024 * 1024],
])('refuses %s of %s bytes', async (mimeType, size) => {
  expect(
    (
      await ah.post(`/api/shops/${KEDAI}/usual-list/parse-photo`, {
        imageBase64: b64(Buffer.alloc(size)),
        mimeType,
      })
    ).status,
  ).toBe(422);
});
it('shares the 10-an-hour limit with text parsing', async () => {
  /* 9 text + 1 photo → the 11th call of either kind → 429 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement the adapter, service and route. Add "Use a photo of an old invoice instead" to setup step 1 and the usual-list page. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(ai): build the usual list from an invoice photo, never stored`

---

### Task 2: An accuracy run with synthetic invoice photos

**Files:**

- Create: `scripts/make-invoice-fixtures.ts`, `tests/fixtures/ai-accuracy/invoices/invoice-01.png` … `invoice-10.png` with matching `.json` expectations
- Modify: `scripts/ai-accuracy.ts` (`--photos`), `docs/ai-accuracy.md`

- [ ] **Step 1: Write the generator.**
  - `make-invoice-fixtures.ts` renders 10 fictional invoices to 1,200 × 1,600 PNGs with Playwright.
  - Each invoice: a supplier "… Contoh" letterhead, a fictional phone number, 3–8 catalogue items named in mixed Malay, Chinese and English, quantities in mixed units, and prices.
  - Two invoices are slightly rotated (a CSS transform) and one is low-contrast.
  - It writes the matching expectations in the M3 fixture format.
- [ ] **Step 2: Run the accuracy check.** `pnpm ai:accuracy -- --photos --model <chosen model>` scores the photos the same way as text and appends an "Invoice photos" section to `docs/ai-accuracy.md`. The spec sets no pass mark for photos. If fewer than 8 of 10 are fully correct, add a line to the README "Known limitations".
- [ ] **Step 3: Commit:** `test(ai): measure invoice-photo accuracy`

---

### Task 3: The impact panel (P1-15)

**Files:**

- Create: `src/server/modules/ops/impact.ts`, `src/app/api/ops/impact/route.ts`, `src/app/(shell)/ops/impact/page.tsx`
- Test: `tests/api/impact.test.ts`, `tests/unit/median.test.ts`

**Interfaces:**

- Produces:
  - `median(values: number[]): number | null`. It returns `null` for no values; for an even count, the mean of the two middle values; rounded half-up to a whole number.
  - `impactMetrics(deps, caller): Promise<ImpactView>` (Ops):

```ts
type ImpactView = {
  timeToApprove: { medianMinutes: number | null; p90Minutes: number | null; samples: number }; // paid baskets with firstOpenedAt, not auto-approved
  basketApprovalRate: { approved: number; drafted: number; rate: number | null }; // non-background shops
  aiLinesAcceptedUnchanged: { accepted: number; suggested: number; rate: number | null }; // Σ acceptedUnchanged ÷ Σ (acceptedUnchanged + changed + removed)
  claimRate: { claimedUnits: number; deliveredUnits: number; rate: number | null };
  supplierReliability: {
    supplierId: string;
    supplierName: string;
    medianConfirmationHours: number | null;
    goodUnitsRate: number | null;
  }[];
};
```

- [ ] **Step 1: Write the failing tests:**

```ts
it.each([
  [[], null],
  [[3], 3],
  [[2, 5], 4],
  [[1, 2, 9], 2],
])('median of %j is %s', (v, m) => expect(median(v)).toBe(m));
it('shows dashes, not errors, before any data', async () => {
  const v = (await nadia.get('/api/ops/impact')).body; // seed 'reference'
  expect(v.basketApprovalRate.rate).toBeNull();
  expect(v.timeToApprove.medianMinutes).toBeNull();
});
it('computes the panel from a known week', async () => {
  // demo seed. Ah Seng parses SAMPLE_ORDER_TEXT, then saves with M3 Task 6's edits (EGG_A kept, OIL 2→3, CUPS removed, EM added)
  //   → changeSummary {3 unchanged, 1 changed, 1 added, 1 removed} → accepted 3 of 5 → 0.6
  // Ah Seng opens the basket at 06:10 and pays at 06:13; Gerai's and Kafe's seeded baskets were never opened (no firstOpenedAt) → samples 1, median 3
  // drafted 3 (Gerai, Kafe, Kedai) and paid 3 → rate 1
  const v = (await nadia.get('/api/ops/impact')).body;
  expect(v).toMatchObject({
    timeToApprove: { medianMinutes: 3, samples: 1 },
    basketApprovalRate: { approved: 3, drafted: 3, rate: 1 },
    aiLinesAcceptedUnchanged: { accepted: 3, suggested: 5, rate: 0.6 },
  });
});
it('keeps the panel for Ops only', async () => {
  /* ahSeng → 403 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement the service and route.
- [ ] **Step 4: Build the page.** Load the `dataviz` skill first.
  - **Tiles:** the five metrics, each with its definition in one line, plus "—" for no data.
  - **Supplier reliability:** a small table.
  - Light and dark themes.
- [ ] **Step 5:** Run the tests and `pnpm verify`. Expected: PASS.
- [ ] **Step 6: Commit:** `feat(ops): add the impact panel`

---

### Milestone verification

- [ ] Run `pnpm verify` (with `e2e`).
- [ ] Merge to `main` with `--ff-only` and post the milestone report (story 26, the §27 P1 metrics, and the invoice-photo accuracy result).
