# M3 Catalogue, Rounds and Usual List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners can search the catalogue, see open rounds with live progress and honest all-in quotes for their pickup point or door, and set up their usual list by pasting a WhatsApp order that Gemini reads and the owner confirms.

**Architecture:** The logistics adapter turns stored coordinates into shipping shares and delivery fees (PRD §10). The rounds module derives every cut-off from a product's schedule and opens one round per active product with frozen tiers. The AI pipeline runs redact → read → validate → store: it saves an `AiSuggestionRun` and a log entry, but nothing is saved to the usual list until the owner confirms.

**Tech Stack:** `@google/genai` 2.x (server only), `@supabase/supabase-js` 2.x (server only), `sharp`, `@vis.gl/react-google-maps`, shadcn/ui.

**Spec:** PRD §3 (catalogue, rounds, usual lists), §7, §10, §16, §17, §18, §20 (catalogue and rounds, usual list and settings), §22 (owner setup, usual list, open rounds), stories 3–8, 11–25, 42–45, 48–51, 154, 170, 172, 183; build design D6, D7, C2, C9, C14, O5; index §5.

## Global Constraints

- Index §2 (G1–G10) applies.
- PRD §10 rate card (sen per kg): up to 60 km 8; over 60 up to 200 km 15; over 200 up to 400 km 22; over 400 km 30. Delivery fee: up to 5 km RM 8.00; up to 10 km RM 12.00; up to 20 km RM 18.00; over 20 km not available. A band includes its upper edge; distances are rounded to 0.1 km first.
- PRD §16 input: at most 2,000 characters and 40 lines; phone numbers, email addresses and 12-digit identity-card-like numbers removed before sending; low temperature; 15-second timeout; one retry with a 2-second backoff on rate-limit or server errors; at most 10 parses per shop per hour; lines below 0.8 confidence or with alternatives are highlighted "Please check".
- PRD §16 unit aliases: carton = ctn, carton, kotak, 箱; tray = papan, tray, 盘, 板; tin = tin, tong, 桶; sack = guni, karung, sack; pack = pek, pack, 包.
- PRD §17 prompt template: "Studio product photo of a plain, unbranded [pack description] on a white background, soft lighting, no text, no logos, no brand names." WebP of at most about 200 KB; the caption "AI-generated image"; a category icon when an image is missing.
- PRD §18: the Maps JavaScript API only, loaded lazily; the list still works if the map fails; no Geocoding, Places or Routes calls.

## Review Focus

1. **A pasted line with no quantity or with a word quantity the AI can't resolve** ("telur papan"): the line is "Please check" with an empty quantity, and saving the list is refused until it's filled. Pinned in Task 6.
2. **A paste with nothing but greetings:** a 200 with no lines and the greeting as ignored text, never an error. Pinned in Task 5.
3. **A search typed with full-width characters or odd spacing** ("ＳＫＭ ", "Susu Pekat"): it still finds condensed milk. Pinned in Task 3.
4. **A shop exactly 20.0 km from its nearest pickup point:** door delivery is offered at RM 18.00. At 20.1 km it isn't. Pinned in Tasks 1 and 4.
5. **The AI returns quantity 0, a negative number or 2.5:** the quantity becomes empty and the line "Please check", never a saved fraction. Pinned in Task 5.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m03-catalogue-rounds-usual-list`
- [ ] **Step 2:** Follow index §6. Confirm in M2 code: `withTransaction`, `TxContext`, `appendLog`, `ACTIONS`, `emitEvent`, `notify`, `requireShopAccess`, `requireRole`, `createTestApp`, `seedId`, `SAMPLE_ORDER_TEXT`, `SAMPLE_USUAL_PRICES_SEN`; in M1 code: `quote`, `unitAmounts`, `roundHalfUpDiv`.
- [ ] **Step 3:** Check the current NVIDIA FLUX.2 Klein endpoint, request body and response shape on build.nvidia.com, and the `@google/genai` 2.x `generateContent` options for JSON-schema output (`responseMimeType`, `responseJsonSchema`, temperature, request timeout). Correct Tasks 5 and 7 if they differ.
- [ ] **Step 4:** Commit any plan edits.

---

### Task 1: Logistics adapter

**Files:**

- Create: `src/server/adapters/logistics.ts`
- Test: `tests/unit/logistics.test.ts`

**Interfaces:**

- Produces:
  - `type LatLng = { lat: number; lng: number }`
  - `distanceKm(a: LatLng, b: LatLng): number`: haversine with R = 6371.0 km, rounded half-up to 0.1 km.
  - `shippingRatePerKgSen(km: number): 8 | 15 | 22 | 30`
  - `unitShippingSen(unitWeightGrams: number, ratePerKgSen: number): number`: `roundHalfUpDiv(grams × rate, 1000)`.
  - `deliveryFeeSen(km: number): 800 | 1200 | 1800 | null`
  - `interface LogisticsPartner { quoteShipping(i: { hub: LatLng; pickupPoint: LatLng; unitWeightGrams: number }): { distanceKm: number; ratePerKgSen: number; unitShippingSen: number }; quoteDeliveryFee(i: { pickupPoint: LatLng; shop: LatLng }): { distanceKm: number; feeSen: number | null }; newConsignmentReference(): string }` and `simulatedLogistics`.
  - `AppDeps.logistics: LogisticsPartner`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('measures one degree of longitude at the equator', () =>
  expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBe(111.2));
it.each([
  [60.0, 8],
  [60.1, 15],
  [200.0, 15],
  [200.1, 22],
  [400.0, 22],
  [400.1, 30],
])('rate band at %s km', (km, rate) => expect(shippingRatePerKgSen(km)).toBe(rate));
it.each([
  [5.0, 800],
  [5.1, 1200],
  [10.0, 1200],
  [20.0, 1800],
  [20.1, null],
])('delivery fee at %s km', (km, fee) => expect(deliveryFeeSen(km)).toBe(fee));
it('reproduces the PRD shipping shares from the seed coordinates (C9)', () => {
  const cm = (pp: LatLng) =>
    simulatedLogistics.quoteShipping({ hub: HUB_KV, pickupPoint: pp, unitWeightGrams: 19500 })
      .unitShippingSen;
  expect([cm(PP_IPOH), cm(PP_JB), cm(PP_KUANTAN)]).toEqual([293, 429, 429]);
  expect(
    simulatedLogistics.quoteShipping({
      hub: HUB_JOHOR,
      pickupPoint: PP_KUANTAN,
      unitWeightGrams: 1800,
    }).unitShippingSen,
  ).toBe(40);
});
it('quotes Gerai Contoh door delivery at RM 12.00', () => {
  const q = simulatedLogistics.quoteDeliveryFee({ pickupPoint: PP_JB, shop: GERAI });
  expect(q.feeSen).toBe(1200);
  expect(q.distanceKm).toBeGreaterThan(5);
  expect(q.distanceKm).toBeLessThanOrEqual(10);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. Coordinates come from `prisma/seed/network.ts`. If a C9 assertion fails, adjust the seed coordinates in index §5.2 and the seed together, never the rates. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(logistics): add the simulated partner's distances and rate card`

---

### Task 2: Schedules and opening rounds

**Files:**

- Create: `src/server/modules/rounds/schedule.ts`, `src/server/modules/rounds/open.ts`
- Modify: `prisma/seed/index.ts` (a temporary phase `openRoundsAtAnchor` at the end of `seedDemo` that calls `openNextRound` for every active product at the anchor time, so the dev database and `seed: 'demo'` tests have open rounds; M4 replaces it with `seedCurrentWeek`)
- Test: `tests/unit/schedule.test.ts`, `tests/api/rounds-open.test.ts` (uses `createTestApp({ seed: 'reference' })`, so no round is open yet)

**Interfaces:**

- Produces:
  - `type ScheduleProduct = { cadence: Cadence; scheduleAnchorWeek: string; cutoffWeekday: number; cutoffTime: string }`.
  - `cutoffForWeek(p: ScheduleProduct, isoWeek: string): Date | null`. It returns `null` when the cadence skips that week: fortnightly closes when `(weekIndex − anchorIndex) mod 2 = 0`, monthly when `mod 4 = 0`.
  - `nextCutoffAfter(p, instant: Date): Date`, strictly after.
  - `expectedReadyAt(cutoff)`, which is cut-off + 4 days 14 hours.
  - `deliveryDateOf(cutoff): string`, which is `mytDate(expectedReadyAt(cutoff))`.
  - `requiredDispatchDate(cutoff): string`, which is cut-off + 2 days (C10).
  - `expectedHubDate(cutoff): string`, which is cut-off + 4 days.
  - `openNextRound(ctx: TxContext, productId: string, opensAt: Date): Promise<Round>`. It sets:
    - `cutoffAt = nextCutoffAfter(product, opensAt)`
    - `cycleLabel = isoWeekOf(cutoffAt)`
    - frozen `tiersSnapshot`, `feeBps = 200`, buy-alone price and unit weight
    - `status 'open'`
    - and it logs `round.opened` (system actor) and emits `round.opened { roundId, productId, supplierId, cutoffAt, tiers }`.
  - `openDueRounds(deps: AppDeps): Promise<{ opened: number }>`, which opens a round for each active product without one, at `now`.

- [ ] **Step 1: Write the failing tests:**

```ts
// unit
const weekly = {
  cadence: 'weekly',
  scheduleAnchorWeek: '2026-W45',
  cutoffWeekday: 4,
  cutoffTime: '20:00',
} as const;
it('closes weekly products on Thursday 8 pm Malaysia time', () =>
  expect(cutoffForWeek(weekly, '2026-W45')?.toISOString()).toBe('2026-11-05T12:00:00.000Z'));
it('skips the off weeks of fortnightly products', () => {
  const f = { ...weekly, cadence: 'fortnightly' } as const;
  expect(cutoffForWeek(f, '2026-W46')).toBeNull();
  expect(
    nextCutoffAfter(
      { ...f, scheduleAnchorWeek: '2026-W44' },
      new Date('2026-11-01T22:05:00Z'),
    ).toISOString(),
  ).toBe('2026-11-12T12:00:00.000Z');
});
it('derives the later dates from the cut-off', () => {
  const c = new Date('2026-11-05T12:00:00Z');
  expect([
    expectedReadyAt(c).toISOString(),
    deliveryDateOf(c),
    requiredDispatchDate(c),
    expectedHubDate(c),
  ]).toEqual(['2026-11-10T02:00:00.000Z', '2026-11-10', '2026-11-07', '2026-11-09']);
});
it('picks the next week when called exactly at a cut-off', () =>
  expect(nextCutoffAfter(weekly, new Date('2026-11-05T12:00:00Z')).toISOString()).toBe(
    '2026-11-12T12:00:00.000Z',
  ));
// api (seeded reference data, clock at the anchor)
it('opens one round per active product closing Thu 5 Nov 8 pm', async () => {
  expect(await openDueRounds(app.deps)).toEqual({ opened: 12 });
  const rounds = await app.prisma.round.findMany({ where: { status: 'open' } });
  expect(new Set(rounds.map((r) => r.cutoffAt.toISOString()))).toEqual(
    new Set(['2026-11-05T12:00:00.000Z']),
  );
  expect(new Set(rounds.map((r) => r.cycleLabel))).toEqual(new Set(['2026-W45']));
});
it('opens nothing new when run again', async () => {
  await openDueRounds(app.deps);
  expect(await openDueRounds(app.deps)).toEqual({ opened: 0 });
});
it('freezes tiers when a round opens (story 51)', async () => {
  /* open; update price_tiers for CM; round.tiersSnapshot still [20:15800, 50:15200, 100:14600] */
});
it('logs and emits the opening without names', async () => {
  /* log action round.opened actorType system; event data keys ⊆ {roundId, productId, supplierId, cutoffAt, tiers} */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(rounds): derive cut-offs and open rounds with frozen tiers`

---

### Task 3: Catalogue search, open rounds and quotes

**Files:**

- Create:
  - Modules: `src/server/modules/catalogue/catalogue.ts`, `src/server/modules/rounds/read.ts`, `src/server/modules/rounds/quote.ts`
  - Shared types: `src/lib/views/catalogue.ts`, `src/lib/views/rounds.ts`
  - Routes: `src/app/api/catalogue/route.ts`, `src/app/api/rounds/route.ts`, `src/app/api/rounds/[roundId]/route.ts`, `src/app/api/rounds/[roundId]/quote/route.ts`
  - Test helpers: `tests/api/helpers/builders.ts`
- Test: `tests/api/catalogue-rounds.test.ts`

**Interfaces:**

- Consumes: `quote` (M1), `simulatedLogistics` (Task 1), `requireShopAccess` (M2).
- Produces:
  - `normaliseSearch(s: string): string`: NFKC, lower case, collapsed whitespace, trimmed.
  - `searchCatalogue(deps, caller, q: string | null): Promise<CatalogueItemView[] | StaffCatalogueItemView[]>`. Ranking: an exact alias or name match, then a prefix match, then a substring match in either direction.
  - `CatalogueItemView = { productId; name; shortName; packDescription; unitName; category; supplierName; imageUrl: string | null; imageAiGenerated: boolean; buyAlonePriceSen; tiers: TierView[]; openRound: { roundId; cutoffAt; totalQuantity; shopCount; currentTier: number | null } | null }`
  - `StaffCatalogueItemView = { productId; name; shortName; packDescription; unitName; category; imageUrl; imageAiGenerated }`
  - `roundProgress(db, roundId): Promise<{ totalQuantity: number; shopCount: number; currentTier: number | null; unitsToNextTier: number | null; nextTierUnitPriceSen: number | null }>`. It counts only participations with status `active`.
  - `listOpenRounds(deps, caller): Promise<OpenRoundView[]>`. Each item carries its tiers, progress and cut-off, plus, for owners, `myPrice: { destinationLabel; unitShippingSen; startingAllInSen; projectedAllInSen: number | null }` at the shop's default destination.
  - `getRoundForCaller(deps, caller, roundId): Promise<RoundDetailView>`:
    - Owners get only their own participations, plus totals and counts.
    - `nextRoundCutoffAt` is set when this round isn't open (story 50).
  - `type DestinationInput = { type: 'pickup_point'; pickupPointId: string } | { type: 'door' }`
  - `quoteForShop(deps, caller, roundId, i: { quantity: number; destination?: DestinationInput; priceLimitSen?: number | null }): Promise<QuoteResult & { unitShippingSen: number; deliveryFeeSen: number | null; destinationLabel: string; destination: DestinationInput }>`:
    - The default destination is the shop's default.
    - Door delivery ships to the pickup point nearest the shop, and adds the fee.
    - `currentRoundTotal` = the active total.
  - Routes as in PRD §20. The quote route parses `destination=pickup:<id>` or `destination=door`.
  - Test builders: `insertParticipation(prisma, { roundId, shopId, quantity, unitShippingSen, priceLimitSen?, status?, joinedAt? })`, which inserts the payment, payment line and participation rows directly for read-only tests.

- [ ] **Step 1: Write the failing tests** (seeded, rounds opened):

```ts
it.each(['炼奶', 'susu pekat', 'SKM', 'ＳＫＭ ', 'Susu  Pekat'])(
  'finds condensed milk for "%s"',
  async (q) => {
    const res = await (await app.as('ahSeng')).get(`/api/catalogue?q=${encodeURIComponent(q)}`);
    expect(res.body.items[0].productId).toBe(seedId('product', 'CM'));
  },
);
it('shows staff names and pictures but no prices', async () => {
  const res = await (await app.as('rahim')).get('/api/catalogue');
  expect(res.body.items).toHaveLength(12);
  expectNoMoneyFields(res.body);
});
it('shows owners the tiers and the buy-alone price', async () => {
  const cm = (await (await app.as('ahSeng')).get('/api/catalogue?q=SKM')).body.items[0];
  expect(cm).toMatchObject({
    buyAlonePriceSen: 16800,
    tiers: [
      { position: 1, minQuantity: 20, unitPriceSen: 15800 },
      { position: 2 },
      { position: 3 },
    ],
  });
});
it('counts active units and shops for round progress', async () => {
  // insert 9 active participations totalling 99 cartons over 8 shops, plus 1 cancelled
  expect(await roundProgress(app.prisma, cmRound)).toEqual({
    totalQuantity: 99,
    shopCount: 8,
    currentTier: 2,
    unitsToNextTier: 1,
    nextTierUnitPriceSen: 14600,
  });
});
it("never shows owners other shops' names or quantities (stories 44, 145)", async () => {
  const res = await (await app.as('siti')).get(`/api/rounds/${cmRound}`);
  const s = JSON.stringify(res.body);
  expect(s).not.toMatch(/Kafe Contoh|Kedai Kopi Contoh|Kopitiam Contoh/);
  expect(res.body.myParticipations.every((p: any) => p.shopId === seedId('shop', 'GERAI'))).toBe(
    true,
  );
});
it('quotes Kedai Kopi Contoh at the Ipoh pickup point', async () => {
  const res = await (
    await app.as('ahSeng')
  ).get(
    `/api/rounds/${cmRound}/quote?quantity=6&destination=pickup:${seedId('pickup_point', 'PP_IPOH')}`,
  );
  expect(res.body).toMatchObject({
    unitShippingSen: 293,
    starting: { allInSen: 16409 },
    startingLineSen: 98454,
    deliveryFeeSen: null,
  });
});
it('quotes door delivery with the delivery fee', async () => {
  const res = await (
    await app.as('siti')
  ).get(`/api/rounds/${cmRound}/quote?quantity=4&destination=door`);
  expect(res.body).toMatchObject({ unitShippingSen: 429, deliveryFeeSen: 1200 });
});
it('says when the next round closes after a missed cut-off (story 50)', async () => {
  /* mark a CM round closed, open a new one → GET the old round → nextRoundCutoffAt equals the new round's cut-off */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(catalogue): search, open rounds with progress, and quotes`

---

### Task 4: Pickup points and shop settings

**Files:**

- Create: `src/server/modules/directory/directory.ts`, `src/lib/views/directory.ts`, `src/app/api/pickup-points/route.ts`, `src/app/api/shops/[shopId]/settings/route.ts`
- Modify: `src/server/modules/activity/actions.ts` (add `shop.settings_changed`, `shop.setup_completed`)
- Test: `tests/api/settings.test.ts`

**Interfaces:**

- Produces:
  - `listPickupPointsForShop(deps, caller): Promise<PickupPointView[]>`. Owners and staff get points sorted by distance from their shop; Ops get them by name. `PickupPointView = { id; name; address; state; lat; lng; openingHours; distanceKm: number | null }`.
  - `getShopSettings(deps, caller, shopId): Promise<ShopSettingsView>`, where `ShopSettingsView = { defaultFulfilment; pickupPoint: PickupPointView | null; door: { nearestPickupPoint: PickupPointView; distanceKm: number; feeSen: number | null; available: boolean }; setupCompleted: boolean }`.
  - `updateShopSettings(deps, caller, shopId, input: { defaultFulfilment: 'pickup'; pickupPointId: string } | { defaultFulfilment: 'door' }): Promise<ShopSettingsView>`. Owner only.
    - When door delivery is unavailable, it fails with 422 `DOOR_TOO_FAR` and the message "Your shop is more than 20 km from the nearest pickup point, so door delivery isn't available. Choose a pickup point instead."
    - It logs `shop.settings_changed`.
    - When the shop has a usual list and `setupCompletedAt` is null, it also sets `setupCompletedAt` and logs `shop.setup_completed`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('sorts pickup points by distance from Kedai Kopi Contoh', async () => {
  const res = await (await app.as('ahSeng')).get('/api/pickup-points');
  expect(res.body.items[0]).toMatchObject({
    name: 'Ipoh pickup point',
    openingHours: '10 am–7 pm daily',
  });
  expect(res.body.items.map((p: any) => p.distanceKm)).toEqual(
    [...res.body.items.map((p: any) => p.distanceKm)].sort((a, b) => a - b),
  );
});
it('quotes RM 12.00 when Gerai Contoh chooses door delivery', async () => {
  const res = await (
    await app.as('siti')
  ).patch(`/api/shops/${seedId('shop', 'GERAI')}/settings`, { defaultFulfilment: 'door' });
  expect(res.body.door).toMatchObject({
    feeSen: 1200,
    available: true,
    nearestPickupPoint: { name: 'Johor Bahru pickup point' },
  });
});
it('refuses door delivery more than 20 km from a pickup point', async () => {
  /* builder shop 30 km from every point → 422 DOOR_TOO_FAR */
});
it('offers door delivery at exactly 20.0 km for RM 18.00', async () => {
  /* builder shop placed at 20.0 km → feeSen 1800 */
});
it('lets only the owner change fulfilment (story 102)', async () => {
  expect(
    (
      await (
        await app.as('rahim')
      ).patch(`/api/shops/${seedId('shop', 'KEDAI_KOPI')}/settings`, { defaultFulfilment: 'door' })
    ).status,
  ).toBe(403);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(directory): pickup points by distance and fulfilment settings`

---

### Task 5: Reading a pasted order with AI

**Files:**

- Create: `src/server/adapters/ai/types.ts`, `src/server/adapters/ai/redact.ts`, `src/server/adapters/ai/prompt.ts`, `src/server/adapters/ai/schema.ts`, `src/server/adapters/ai/gemini.ts`, `src/server/adapters/ai/fake.ts`, `src/server/adapters/ai/saved-example.ts`, `src/server/modules/usual-list/parse.ts`, `src/lib/views/usual-list.ts`, `src/app/api/shops/[shopId]/usual-list/parse/route.ts`
- Modify: `src/server/platform/deps.ts` (`AppDeps.ai: OrderReader`; Gemini when `AI_ADAPTER=gemini`, fake otherwise)
- Test: `tests/unit/redact.test.ts`, `tests/unit/gemini-adapter.test.ts`, `tests/api/usual-list-parse.test.ts`

**Interfaces:**

- Produces:
  - `CatalogueEntry`, `ReadLine`, `ReadResult`, `OrderReader`: as index §4.3.
    - `ReadLine = { sourceText: string; productId: string | null; quantity: number | null; unitAsWritten: string | null; confidence: number; alternatives: string[]; note: string | null }`
    - `OrderReader = { readonly model: string; readOrderText(i: { text: string; catalogue: CatalogueEntry[] }): Promise<ReadResult> }`
  - `class AiUnavailableError extends Error`.
  - `redactPersonalData(text: string): { text: string; removedCount: number }`. Replacements: `[phone removed]`, `[email removed]`, `[id removed]`.
  - `buildPrompt(catalogue: CatalogueEntry[]): string`. It contains:
    - each entry's id, name, pack, unit and aliases
    - the PRD §16 unit alias table
    - the pack conversions
    - the rules: never invent ids (`null` when nothing matches); at most 3 alternatives; whole-number quantities in the product's unit; convert packs and say so in `note`; list greetings, names and delivery chatter in `ignoredText`
  - `READ_RESULT_JSON_SCHEMA`: the PRD §16 output shape, with `alternatives.maxItems = 3`.
  - `createGeminiOrderReader(opts: { apiKey: string; model: string; timeoutMs?: number; generate?: (req: { model: string; prompt: string; text: string }) => Promise<string>; sleep?: (ms: number) => Promise<void> }): OrderReader`. The defaults are the SDK call and `setTimeout`. One retry after 2,000 ms on 429 or 5xx, then `AiUnavailableError`. Also `toReadResult(raw: string): ReadResult`.
  - `createFakeOrderReader(fixtures?: Record<string, ReadResult>, opts?: { failWith?: Error }): OrderReader & { received: string[] }`. The sample order's fixture is built in: index §5.6, keyed by its redacted text.
  - `SAVED_EXAMPLE: ReadResult`.
  - `parseUsualListText(deps, caller, shopId, input: { text: string; useSavedExample?: boolean }): Promise<ParseView>`.
    - `ParseView = { suggestionRunId; lines: ParsedLineView[]; ignoredText: string[]; model: string; source: 'ai' | 'saved_example' }`
    - `ParsedLineView = { sourceText; product: { id; name; packDescription; unitName; imageUrl } | null; quantity: number | null; unitAsWritten: string | null; confidence: number; alternatives: { id; name; packDescription }[]; note: string | null; status: 'ok' | 'check' | 'not_found'; samplePriceSen?: number }`
    - `samplePriceSen` is present only when the trimmed input equals `SAMPLE_ORDER_TEXT` (C2).

- [ ] **Step 1: Write the failing tests:**

```ts
// redaction (unit)
it.each(['012-345 6789', '+60 12-345 6789', '0123456789', '+65 9123 4567', '+1 (415) 555-0100'])(
  'removes the phone number %s',
  (p) => expect(redactPersonalData(`call ${p} ok`).text).toBe('call [phone removed] ok'),
);
it('removes emails and identity-card-like numbers', () => {
  expect(redactPersonalData('siti@contoh.my 900101-14-5678 900101145678').text).toBe(
    '[email removed] [id removed] [id removed]',
  );
});
it('leaves quantities, sizes and units alone', () => {
  const t = '炼奶 6箱\ncawan 16oz 2 ctn\nsusu pekat 390g x 48 tin\ncups 1000 pcs';
  expect(redactPersonalData(t)).toEqual({ text: t, removedCount: 0 });
});
// Gemini adapter (unit, stubbed generate)
it('retries once after a rate limit and then succeeds', async () => {
  /* generate throws {status: 429} then returns valid JSON; sleep called with 2000; result has lines */
});
it('gives up as AI unavailable after a second failure', async () => {
  /* two 503s → rejects AiUnavailableError */
});
// API
it('reads the sample order after removing the phone number (stories 11–14, 18, 154)', async () => {
  const res = await (
    await app.as('ahSeng')
  ).post(`/api/shops/${KEDAI}/usual-list/parse`, { text: SAMPLE_ORDER_TEXT });
  expect(res.body.lines.map((l: any) => [l.product?.id ?? null, l.quantity, l.status])).toEqual([
    [seedId('product', 'CM'), 6, 'ok'],
    [seedId('product', 'OIL'), 2, 'ok'],
    [seedId('product', 'EGG_A'), 10, 'check'],
    [seedId('product', 'COFFEE'), 1, 'ok'],
    [seedId('product', 'CUPS'), 2, 'ok'],
  ]);
  expect(res.body.lines[2].alternatives.map((a: any) => a.id)).toEqual([
    seedId('product', 'EGG_B'),
  ]);
  expect(res.body.lines[0].samplePriceSen).toBe(16500);
  expect(fakeAi.received.at(-1)).toContain('[phone removed]');
  expect(fakeAi.received.at(-1)).not.toContain('012-345 6789');
});
it('turns an invented product id into "not found" (story 16)', async () => {
  /* fixture returns productId 'not-a-real-id' → product null, status 'not_found' */
});
it('turns quantity 0, -2 or 2.5 into an empty quantity to check', async () => {
  /* each → quantity null, status 'check' */
});
it('answers a greeting-only message with no lines', async () => {
  /* fixture { lines: [], ignoredText: ['Selamat pagi boss'] } → 200, lines [] */
});
it('saves nothing to the usual list (story 17)', async () => {
  /* after parse, usual_list_items count for KEDAI is 0 */
});
it('logs the AI suggestion with actor AI (story 25)', async () => {
  const e = await app.prisma.activityLogEntry.findFirstOrThrow({
    where: { action: 'usual_list.ai_suggested' },
  });
  expect(e).toMatchObject({ actorType: 'ai', aiMetadata: { lineCount: 5 } });
});
it('limits parsing to 10 an hour per shop', async () => {
  /* 11th → 429 RATE_LIMITED */
});
it('says the AI is unavailable and offers the saved example in demo mode (stories 24, 170)', async () => {
  // fake reader failWith AiUnavailableError → 503 { code: 'AI_UNAVAILABLE', details: { canUseSavedExample: true } }
  // POST again with useSavedExample: true → 200, source 'saved_example'
});
it('refuses more than 2,000 characters or 40 lines', async () => {
  /* → 400 INPUT_TOO_LONG */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. The validation rules are those in Global Constraints. The run stores the redacted text only. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(ai): read pasted orders with redaction, validation and fallbacks`

---

### Task 6: Saving and editing the usual list

**Files:**

- Create: `src/server/modules/usual-list/usual-list.ts`, `src/app/api/shops/[shopId]/usual-list/route.ts`
- Test: `tests/api/usual-list.test.ts`

**Interfaces:**

- Produces:
  - `getUsualList(deps, caller, shopId): Promise<UsualListView | null>`, where `UsualListView = { items: { productId; name; packDescription; unitName; imageUrl; quantity; usualPriceSen: number | null; priceLimitSen: number | null }[]; confirmedAt }`.
  - `saveUsualList(deps, caller, shopId, input: { items: { productId: string; quantity: number; usualPriceSen: number | null; priceLimitSen?: number | null }[]; suggestionRunId?: string }): Promise<UsualListView>`. Owner only. Rules:
    - An omitted `priceLimitSen` takes the usual price (story 20); an explicit `null` means no limit (story 21); 0 or less gives 422 `PRICE_LIMIT_NOT_POSITIVE`.
    - Quantities are whole numbers from 1 to 999 (otherwise 400).
    - No duplicate products (400).
    - First save, or any save with a `suggestionRunId`: log `usual_list.confirmed` (person) with `after.changeSummary = { acceptedUnchanged, changed, added, removed }`, and set the run's `confirmedAt` and `changeSummary`.
    - Later edits: log `usual_list.item_updated` per changed item with `before`/`after`.
  - Routes: `GET` and `PUT /api/shops/{shopId}/usual-list` (owner). M4 adds basket drafting to `PUT`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('uses the usual price as the default price limit (story 20)', async () => {
  const res = await (
    await app.as('ahSeng')
  ).put(`/api/shops/${KEDAI}/usual-list`, {
    items: [{ productId: CM, quantity: 6, usualPriceSen: 16500 }],
  });
  expect(res.body.items[0]).toMatchObject({
    quantity: 6,
    usualPriceSen: 16500,
    priceLimitSen: 16500,
  });
});
it('keeps a removed limit as no limit (story 21)', async () => {
  /* priceLimitSen: null → null */
});
it('rejects a price limit that is not a positive amount', async () => {
  /* priceLimitSen: 0 → 422 PRICE_LIMIT_NOT_POSITIVE */
});
it('refuses a line without a quantity', async () => {
  /* quantity missing → 400 INVALID_INPUT */
});
it('records what the owner changed from the AI suggestion (story 25)', async () => {
  // parse the sample (5 lines) → save: EGG_A 10 (unchanged), OIL 3 (changed), CM 6, COFFEE 1 (unchanged), EM 1 (added); CUPS dropped (removed)
  const e = await app.prisma.activityLogEntry.findFirstOrThrow({
    where: { action: 'usual_list.confirmed' },
  });
  expect(e).toMatchObject({
    actorType: 'person',
    after: { changeSummary: { acceptedUnchanged: 3, changed: 1, added: 1, removed: 1 } },
  });
});
it('logs later edits item by item (story 22)', async () => {
  /* change CM 6 → 8 → usual_list.item_updated before {quantity:6} after {quantity:8} */
});
it('keeps the usual list from staff', async () => {
  expect((await (await app.as('rahim')).get(`/api/shops/${KEDAI}/usual-list`)).status).toBe(403);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(usual-list): confirm and edit the usual list with logged changes`

---

### Task 7: Storage and product images (planned stop, D7)

**Files:**

- Create:
  - Storage: `src/server/adapters/storage/types.ts`, `src/server/adapters/storage/local.ts`, `src/server/adapters/storage/supabase.ts`, `src/app/api/storage/local/[...path]/route.ts`
  - Image scripts: `scripts/generate-product-images.ts`, `scripts/product-image-sheet.ts`
  - Seed data and output: `prisma/seed/image-subjects.ts`, `prisma/seed/assets/products/*.webp` (12 files)
  - UI: `src/components/catalogue/product-image.tsx`
- Modify: `prisma/seed/catalogue.ts` (`imageKey`, `imageAiGenerated: true`), `prisma/seed/index.ts` (copy the assets into local storage when `STORAGE_ADAPTER=local`), `src/server/platform/deps.ts` (`AppDeps.storage`), `package.json` (`images:generate`, `images:sheet`)
- Test: `tests/unit/product-images.test.ts`, `tests/api/storage-local.test.ts`

**Interfaces:**

- Produces:
  - `type Bucket = 'product-images' | 'delivery-photos'`.
  - `interface StorageAdapter { publicUrl(bucket: 'product-images', key: string): string; putObject(bucket: Bucket, key: string, bytes: Uint8Array, contentType: string): Promise<void> }`. M8 extends it.
  - `createLocalStorage({ dir: '.data/storage', secret })`. Its public URL is `/api/storage/local/product-images/<key>`.
  - `createSupabaseStorage({ url, serviceRoleKey })`. Its public URL is `<url>/storage/v1/object/public/product-images/<key>`.
  - `<ProductImage product />`: shows the image with the caption "AI-generated image" when `imageAiGenerated`; otherwise a lucide icon per category:
    - dairy `Milk`, oil `Droplet`, flour `Wheat`, beverages `Coffee`, eggs `Egg`, packaging `Package`
  - Image subjects (the PRD §17 "[pack description]", extended with the product, a decision):
    - **Dairy and dry goods:** `CM` "carton of 48 tins of sweetened condensed milk"; `EM` "carton of 48 tins of evaporated milk"; `OIL` "17 kg metal tin of cooking oil"; `FLOUR` "25 kg sack of wheat flour"; `COFFEE` "carton of ten 1 kg packs of ground coffee"; `TEA` "carton of ten 1 kg packs of black tea dust".
    - **Eggs:** `EGG_A` "tray of 30 large brown eggs"; `EGG_B` "tray of 30 medium brown eggs".
    - **Packaging:** `CUPS` "carton of 16 oz clear plastic cups with lids"; `CONT` "carton of 650 ml plastic takeaway containers"; `BAGS` "carton of medium plastic carrier bags"; `KRAFT` "carton of brown kraft paper bags".

- [ ] **Step 1: Write the failing tests:**

```ts
it('stores every product image as WebP of at most 200 KB', () => {
  for (const f of readdirSync('prisma/seed/assets/products')) {
    const b = readFileSync(join('prisma/seed/assets/products', f));
    expect(b.subarray(0, 4).toString()).toBe('RIFF');
    expect(b.subarray(8, 12).toString()).toBe('WEBP');
    expect(b.length).toBeLessThanOrEqual(200 * 1024);
  }
  expect(readdirSync('prisma/seed/assets/products')).toHaveLength(12);
});
it('serves product images publicly from local storage', async () => {
  const res = await callRoute('GET', '/api/storage/local/product-images/cm.webp');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/webp');
});
it('refuses paths that leave the bucket', async () =>
  expect(
    (await callRoute('GET', '/api/storage/local/product-images/..%2F..%2Fsecret')).status,
  ).toBe(404));
```

- [ ] **Step 2:** Implement the storage adapters and the route (404 unless `STORAGE_ADAPTER=local`).
- [ ] **Step 3: Generate the images.**
  - `NVIDIA_API_KEY` comes from `.env.local`, never the browser or the repo.
  - `pnpm images:generate` calls FLUX.2 Klein once per product with the PRD §17 template and a fixed seed, saving PNGs to `.data/images/raw/`.
  - `pnpm images:sheet` writes `.data/images/contact-sheet.html`.
- [ ] **Step 4: STOP: ask the user to review the images (D7).**
  - Ask them to open `.data/images/contact-sheet.html`.
  - Use AskUserQuestion: "Approve all 12" or "Regenerate some" (they name which).
  - Regenerate the named ones with a new seed and ask again, until all are approved.
  - Reject any image showing text, logos or brand-like marks.
- [ ] **Step 5: Compress and seed.** Convert the approved images with `sharp` to WebP at 512 × 512, lowering the quality until each is ≤ 200 KB, into `prisma/seed/assets/products/<key lowercased>.webp`. Then set `imageKey` in the seed.
- [ ] **Step 6:** Run the tests. Expected: PASS.
- [ ] **Step 7: Commit:** `feat(catalogue): add reviewed AI-generated product images and storage adapters`

---

### Task 8: AI accuracy set and the model choice (D6)

**Files:**

- Create: `tests/fixtures/ai-accuracy/order-01.json` … `order-20.json`, `scripts/ai-accuracy.ts`, `docs/ai-accuracy.md`
- Modify: `src/server/platform/env.ts` (the `GEMINI_MODEL` default), `.env.example`, `package.json` (`ai:accuracy`)

**Interfaces:**

- Produces: the fixture format `{ id: string; text: string; expected: { productKey: string | null; quantity: number | null }[]; mustOfferAlternatives?: string[][] }`, where `expected` is in line order and `mustOfferAlternatives[i]` lists the acceptable products for ambiguous line i. Also `pnpm ai:accuracy -- --model <name>`.

- [ ] **Step 1: Write the 20 orders.** Every business, person and phone number in them is fictional. Coverage:

| Orders | Covers                                                                                |
| ------ | ------------------------------------------------------------------------------------- |
| 01–04  | Malay, Chinese and English mixed                                                      |
| 05–06  | typos ("susu pkat", "minyk masak")                                                    |
| 07     | emoji between items                                                                   |
| 08–09  | units ctn, 箱, kotak, papan, tin, pek                                                 |
| 10     | numbers as words ("dua ctn", "lima papan", "三箱")                                    |
| 11     | greetings, a name, a phone number and delivery chatter                                |
| 12–13  | items not in the catalogue ("gula 2 karung", "sos cili 1 kotak") → `productKey: null` |
| 14     | eggs with no grade → alternatives `EGG_A`/`EGG_B`                                     |
| 15     | pack conversion ("susu pekat 96 tin" → `CM` 2)                                        |
| 16     | two items on one line                                                                 |
| 17     | a list of 12 lines                                                                    |
| 18     | Chinese only                                                                          |
| 19     | lower-case shorthand ("skm 4, evap 2")                                                |
| 20     | the sample order (index §5.6)                                                         |

- [ ] **Step 2: Implement the script.**
  - It reads the fixtures, redacts, and calls `createGeminiOrderReader` with `GEMINI_API_KEY` (key 1) and the given model, one order at a time, 1 second apart.
  - **Scoring:** an order is correct when every expected line matches by product and quantity, ambiguous lines offer the listed products, and no extra products are matched.
  - **Invented ids:** any returned id that isn't in the catalogue counts as invented.
  - **Output:** a table on stdout, plus `docs/ai-accuracy.md` with the model, date (MYT), the per-order results and the totals.
- [ ] **Step 3: Choose the model (D6).**
  - Run `pnpm ai:accuracy -- --model gemini-3.5-flash-lite`, then `-- --model gemini-3.1-flash-lite`.
  - Pick the cheaper one with ≥ 18/20 and 0 invented ids. If neither qualifies, run `gemini-3.5-flash` and use it if it qualifies.
  - If no model reaches the bar, stop and report the results to the user (a spec-level risk).
  - Set the winner as the `GEMINI_MODEL` default and in `.env.example`, and record the comparison in `docs/ai-accuracy.md`.
- [ ] **Step 4: Commit:** `test(ai): add the accuracy set and choose the Gemini model`

---

### Task 9: Owner setup, usual list, settings and open-round screens

**Files:**

- Create:
  - Pages: `src/app/(shell)/owner/setup/page.tsx`, `src/app/(shell)/owner/usual-list/page.tsx`, `src/app/(shell)/owner/settings/page.tsx`, `src/app/(shell)/owner/rounds/page.tsx`, `src/app/(shell)/owner/rounds/[roundId]/page.tsx`
  - Setup components: `src/components/setup/*`
  - Shared components: `src/components/catalogue/catalogue-search.tsx`, `src/components/rounds/round-card.tsx`, `src/components/rounds/tier-ladder.tsx`, `src/components/rounds/progress-bar.tsx`, `src/components/maps/pickup-map.tsx`, `src/components/fulfilment/fulfilment-picker.tsx`
- Modify: `src/app/(shell)/owner/page.tsx` (a "Finish setup" card while setup is incomplete)

- [ ] **Step 1: Build the setup flow** (PRD §22 "Setup (3 steps)").
  1. **Step 1, "Paste your usual order".**
     - The paste box, with the data notice above it (PRD §25 "Notice and choice"). The notice says, in plain English, what BeliKongsi keeps and why; who processes it (Supabase, Vercel, the AI provider, the payments and logistics partners); that names and phone numbers are removed before the AI sees the text; and how to stop.
     - "Try with sample data", which fills the box with `SAMPLE_ORDER_TEXT`.
     - "Use the catalogue form instead".
     - The review list:
       - matched lines
       - "Please check" lines, highlighted, with their alternatives as choices
       - "Not found" lines with a catalogue search
       - quantity steppers
       - usual-price inputs, pre-filled from `samplePriceSen` and labelled "sample price"
       - a remove action, and "Add an item"
     - Confirm calls `PUT`.
     - On `AI_UNAVAILABLE`, show "We couldn't read your order right now. Use the catalogue form instead.", plus "Use saved example" when `canUseSavedExample` is true.
  2. **Step 2, "Pickup or delivery".** The map with the distance-sorted list. The door option shows the fee, or the too-far message. It calls `PATCH settings`.
  3. **Step 3, "Done".** It links to the basket; M4 makes the basket real.
- [ ] **Step 2: Build the other screens.**
  - **Usual list page:** edit quantity, usual price, and price limit (change or remove); add through catalogue search.
  - **Settings page:** the default-fulfilment picker.
  - **Open rounds page:** the PRD §22 cards: picture and caption, pack, supplier, tier ladder with the buy-alone price beside it, progress bar (units, shops, units to the next tier), cut-off countdown, and "your all-in price".
  - **Round detail page:** tiers, progress and your own lines. "Join" stays disabled until M4.
  - **Map:** lazy-loaded with `next/dynamic` (`ssr: false`). It falls back to the list when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is missing or the script fails.
- [ ] **Step 3: Verify** with Chrome DevTools at 390 × 844 after `pnpm db:reset`, which opens the rounds through the Task 2 seed phase. As Ah Seng:
  1. Try with sample data.
  2. Confirm the eggs line is highlighted, choose Grade A, and confirm condensed milk shows RM 165.00 marked "sample price".
  3. Confirm.
  4. Choose Ipoh on the map and on the list.
  5. Reach Done.
  6. Open rounds shows condensed milk at "RM 164.09 now".
  7. Rahim cannot open `/owner/setup`.
- [ ] **Step 4:** Run `pnpm verify`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(ui): add owner setup, usual list, settings and open rounds`

---

### Milestone verification

- [ ] Run `pnpm verify` and repeat the Task 9 walkthrough after `pnpm db:reset`.
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 3–8, 11–25, 42–45, 48–51, 154, 170, 172, 183). Include the chosen Gemini model, its score, and the image approval.
