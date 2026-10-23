# M8 Delivery Check and Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After collecting, staff check what arrived in one tap ("All received") or report missing and damaged units with photos. Problems become claims that Ops decides with all the evidence side by side, and approved claims refund the all-in price automatically.

**Architecture:** The storage adapters gain signed upload and read URLs, and photos go only to the private bucket (the local disk in tests). `submitDeliveryCheck` validates against allocations through the engine's `claimRefund`, writes the check, and either closes the pickup or opens a claim with an Ops approval. The `claim` approval handler posts `claims_expense → shop_balance`. Background shops are checked automatically.

**Tech Stack:** `@supabase/supabase-js` Storage (signed URLs), node:crypto HMAC for the local adapter, the M1 engine, M2 approvals.

**Spec:** PRD §5 (pickup and claim states), §6.8, §8 ("Claim approved"), §11, §12 (claim approvals), §13 (claim notices), §20 (pickups photos, delivery check, claims), §22 (staff "Confirm delivery", Ops claim review), stories 76–81, 127, 128, 147, 181; build design §5.3, O7.

## Global Constraints

- Index §2 (G1–G10) applies.
- PRD §11 photos:
  - up to 3 per issue line, images only, at most 5 MB each, in the private bucket
  - uploaded through short-lived signed upload URLs issued by the server
  - viewed through signed URLs that expire after 10 minutes
  - visible only to the shop's members and Ops
- PRD §11: one delivery check per pickup (P0); missing plus damaged can never exceed the allocated units; prices are never shown to staff.
- PRD §6.8: refund = (missing + damaged) × the participation's final all-in unit price.
- PRD §13: "Claim approved: RM 151.85 refunded for 1 damaged carton." for owners, and the same without amounts for staff.
- A claim decision needs a reason to reject (PRD §12).

## Review Focus

1. **A 6 MB photo or a PDF:** refused with 422 before anything is stored. Pinned in Task 1.
2. **"Submit" tapped twice on the delivery check:** the second gets 409, so there's one check and one claim. Pinned in Task 2.
3. **Missing plus damaged above the allocated units on one line:** 422, naming that line. Pinned in Task 2.
4. **A photo id from another pickup attached to this check:** 422 `PHOTO_NOT_FOUND`. Pinned in Task 2.
5. **A signed photo link opened after 10 minutes:** 403. Pinned in Task 1.

## Re-sync notes (Task 0, against the code as built)

- `StorageAdapter` (`src/server/adapters/storage/types.ts`) today is only `publicUrl('product-images', key)` and `putObject(bucket, key, bytes, contentType)`; `Bucket` is already exported. `getObject` exists only on `LocalStorage` (`local.ts`), and `createLocalStorage({ dir, secret })` has no clock. `deps.ts` passes `secret: env.SESSION_SECRET`; `tests/api/helpers/app.ts` passes a fixed test secret and a fixed clock that the adapter cannot see.
- The local storage route today serves only `GET` of `product-images` and 404s every other bucket.
- `callRoute` (`tests/api/helpers/route.ts`) JSON-stringifies any non-string body, so it cannot send photo bytes yet.
- `decideApproval` already refuses a reject without a reason (422 `REASON_REQUIRED`) before any handler runs, and throws a plain `Error` when no handler is registered for the type. No `claim` handler exists yet.
- `DeliveryCheck.submittedByUserId` is required, but background shops have no user.
- Nothing sets a round to `completed` today.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m08-delivery-check-and-claims`
- [ ] **Step 2:** Follow index §6. Confirm the consumed names:
  - M3: `StorageAdapter`, `createLocalStorage`, `createSupabaseStorage`.
  - M7: `collectPickup`, `runBackgroundAutomation`, `listShopPickups`.
  - M1: `claimRefund`.
  - M2: `registerApprovalHandler`, `createApproval`, `post`.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Signed photo uploads and views

**Files:**

- Create: `src/server/modules/checks/photos.ts`, `src/app/api/pickups/[pickupId]/photos/route.ts`
- Modify:
  - `src/server/adapters/storage/types.ts`, `local.ts`, `supabase.ts`
  - `src/server/platform/deps.ts` and `tests/api/helpers/app.ts` (pass the clock to `createLocalStorage`)
  - `src/app/api/storage/local/[...path]/route.ts` (add signed `PUT`, with `maxBodyBytes` of 8 MiB and `auth: 'public'` because the signature is the credential; add signed `GET` for `delivery-photos`; `product-images` stays public)
  - `tests/api/helpers/route.ts` (`callRoute` must pass a `Uint8Array` or `Buffer` body through unchanged instead of JSON-stringifying it)
- Test: `tests/api/photos.test.ts`

**Interfaces:**

- Produces:
  - `StorageAdapter` gains:
    - `createSignedUploadUrl(bucket: 'delivery-photos', key: string, opts: { contentType: string; maxBytes: number; expiresInSeconds: number }): Promise<{ url: string; method: 'PUT'; headers: Record<string, string> }>`
    - `createSignedReadUrl(bucket: 'delivery-photos', key: string, expiresInSeconds: number): Promise<string>`
    - `statObject(bucket: Bucket, key: string): Promise<{ sizeBytes: number; contentType: string } | null>`
    - `deleteObject(bucket: Bucket, key: string): Promise<void>`
  - `createLocalStorage` gains `now: () => Date` in its options (the deps clock), so signed URLs and their expiry follow the Clock (G4); `LocalStorage` already has `getObject`, which the signed `GET` uses. The existing storage tests call `createLocalStorage({ dir, secret })` without it, so `now` is optional and defaults to the system clock.
  - Supabase: `createSignedUploadUrl(path)` has a fixed lifetime and cannot enforce size or type, and `createSignedUrl(path, seconds)` takes the read lifetime. So `createSupabaseStorage` returns the signed upload URL with the headers the SDK needs and relies on the bucket's 5 MB and image-only limits. The server re-checks with `statObject` when the check is submitted (an object that is missing or over 5 MB is `PHOTO_NOT_FOUND`).
  - Local signed URLs look like `/api/storage/local/delivery-photos/<key>?op=put|get&exp=<unix>&ct=<type>&max=<bytes>&sig=<base64url HMAC-SHA256(secret, op|bucket|key|exp|ct|max)>`.
    - A bad or expired signature gets 403.
    - A `PUT` whose body is larger than `max`, or whose content type isn't `ct`, gets 422.
  - `requestPhotoUpload(deps, caller, pickupId, { contentType: string; sizeBytes: number }): Promise<{ photoId: string; upload: { url; method: 'PUT'; headers } }>`:
    - Owner or staff of the shop, while the pickup is `collected` or `delivered` and not yet checked.
    - Types: `image/jpeg`, `image/png` or `image/webp`; anything else gets 422 `UNSUPPORTED_TYPE`. More than 5,242,880 bytes gets 422 `TOO_LARGE`.
    - The key is `pickups/<pickupId>/<photoId>.<ext>`. The `Photo` row gets `deleteAfter` = upload time + 90 days.
    - Upload URLs expire after 10 minutes.
  - `photoViewUrl(deps, caller, photoId): Promise<string>`: a 600-second signed read URL, for the shop's members and Ops only.

- [ ] **Step 1: Write the failing tests:**

```ts
it('issues a signed upload URL and accepts a small JPEG (story 79)', async () => {
  const { photoId, upload } = (
    await rahim.post(`/api/pickups/${p.id}/photos`, { contentType: 'image/jpeg', sizeBytes: 2048 })
  ).body;
  expect(
    (await callRoute('PUT', upload.url, { body: jpegBytes(2048), headers: upload.headers })).status,
  ).toBe(200);
  expect(
    await app.deps.storage.statObject('delivery-photos', `pickups/${p.id}/${photoId}.jpg`),
  ).toMatchObject({ sizeBytes: 2048 });
});
it('refuses PDFs and photos over 5 MB before storing anything', async () => {
  expect(
    (
      await rahim.post(`/api/pickups/${p.id}/photos`, {
        contentType: 'application/pdf',
        sizeBytes: 100,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await rahim.post(`/api/pickups/${p.id}/photos`, {
        contentType: 'image/jpeg',
        sizeBytes: 6 * 1024 * 1024,
      })
    ).status,
  ).toBe(422);
  expect(await app.prisma.photo.count()).toBe(0);
});
it('refuses a tampered or expired link (403)', async () => {
  /* change sig → 403; clock past exp → 403 */
});
it("keeps photos to the shop's members and Ops (story 147)", async () => {
  expect(
    (
      await (
        await app.as('siti')
      ).post(`/api/pickups/${p.id}/photos`, { contentType: 'image/jpeg', sizeBytes: 10 })
    ).status,
  ).toBe(404);
  // photoViewUrl: ahSeng and nadia succeed; farid gets 404
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(checks): signed photo uploads in the private bucket`

---

### Task 2: Submitting the delivery check

**Files:**

- Create: `src/server/modules/checks/delivery-check.ts`, `src/app/api/pickups/[pickupId]/delivery-check/route.ts`, a Prisma migration
- Modify:
  - `prisma/schema.prisma`: `DeliveryCheck.submittedByUserId` becomes optional (background shops have no user; the system submits their check).
  - `src/server/modules/fulfilment/background.ts`: `runBackgroundAutomation(outer: TxContext, pickupIds: string[]): Promise<number>` hands over background pickups and then, in the same transaction, records "All received" for each one it handed over, through an in-transaction function that `submitDeliveryCheck` shares.
  - `src/server/modules/rounds/completion.ts` (new): `refreshRoundCompletion`.
  - `src/server/modules/notifications/templates.ts`: `claim.submitted`, `ops.claim_needed`.
- Test: `tests/api/delivery-check.test.ts`

**Interfaces:**

- Produces:
  - `submitDeliveryCheck(deps, caller, pickupId, input: { allReceived: true } | { lines: { allocationId: string; missing: number; damaged: number; photoIds: string[] }[] }): Promise<{ checkId: string; result: 'all_received' | 'issues'; claimId: string | null }>`. Owner or staff of the shop.
    - **Preconditions:** the pickup must be `collected` or `delivered`, otherwise 409 `NOT_COLLECTED`; an existing check gives 409 `CHECK_EXISTS`.
    - **Lines:** allocations not listed count as fully received. More than 3 photos on a line gets 422 `TOO_MANY_PHOTOS`. A photo that isn't from this pickup, or wasn't uploaded, gets 422 `PHOTO_NOT_FOUND`. `claimRefund` failures become 422 `MORE_THAN_ALLOCATED`, with `details.allocationId`.
    - **Records:** a `DeliveryCheck` and its lines (`expected = allocated`, `receivedGood = allocated − missing − damaged`). Participations become `received`.
    - **All received:** the pickup becomes `checked`, then `closed`, and the participations `closed`.
    - **Issues:** it creates a `Claim` and `ClaimLine`s with engine refunds, plus a `claim` approval (assignee Ops, amount = total). The approval's evidence holds the shop name, lines with photo counts, the hub check and the consignment history. The pickup becomes `checked`.
    - **Notices for issues:**
      - owner: `{Reporter} reported a problem: {units} of {shortName} ({missing/damaged}). Claim for {RM total} sent to BeliKongsi.`
      - staff: `Problem reported: {units} of {shortName}. BeliKongsi will check it.`
      - Ops: `Claim awaiting decision: {shop name}, {RM total}.`
    - It logs `check.delivery_check_submitted` (and `claim.submitted`), and emits `delivery.checked { pickupId, shopId, result }` and `claim.submitted { claimId, shopId, units, refundSen }`.
  - `refreshRoundCompletion(ctx, roundIds: string[]): Promise<void>`: a round becomes `completed` when every pickup carrying its allocations is `closed`.

- [ ] **Step 1: Write the failing tests.** Kedai Kopi's pickup has been collected by Rahim.

```ts
it('closes the pickup when everything arrived (story 78)', async () => {
  await rahim.post(`/api/pickups/${p.id}/delivery-check`, { allReceived: true });
  expect((await pickupOf('KEDAI_KOPI', '2026-11-10')).status).toBe('closed');
  expect(await participationOf('KEDAI_KOPI', 'CM')).toMatchObject({ status: 'closed' });
});
it('opens a claim for 1 damaged carton worth RM 151.85 (stories 79–81)', async () => {
  const photo = await uploadPhoto(rahim, p.id);
  const r = (
    await rahim.post(`/api/pickups/${p.id}/delivery-check`, {
      lines: [{ allocationId: cmAlloc, missing: 0, damaged: 1, photoIds: [photo] }],
    })
  ).body;
  expect(await claim(r.claimId)).toMatchObject({ status: 'submitted', totalRefundSen: 15185 });
  expect(await lastWhatsapp('ahSeng', 'claim.submitted')).toBe(
    'Rahim reported a problem: 1 carton of condensed milk (damaged). Claim for RM 151.85 sent to BeliKongsi.',
  );
  expect(await lastWhatsapp('rahim', 'claim.submitted')).toBe(
    'Problem reported: 1 carton of condensed milk. BeliKongsi will check it.',
  );
});
it('refuses a second check', async () => {
  /* → 409 CHECK_EXISTS; one claim */
});
it('refuses more missing plus damaged than allocated, naming the line', async () => {
  const r = await rahim.post(`/api/pickups/${p.id}/delivery-check`, {
    lines: [{ allocationId: cmAlloc, missing: 4, damaged: 3, photoIds: [] }],
  });
  expect(r).toMatchObject({
    status: 422,
    body: { code: 'MORE_THAN_ALLOCATED', details: { allocationId: cmAlloc } },
  });
});
it("refuses another pickup's photo", async () => {
  /* photo uploaded to another pickup → 422 PHOTO_NOT_FOUND */
});
it('checks background shops automatically, labelled as simulation', async () => {
  /* bg pickup → closed by system with reason 'background shop simulation' */
});
it('keeps prices out of the staff check (story 77)', async () =>
  expectNoMoneyFields((await rahim.get(`/api/shops/${KEDAI}/pickups?status=past`)).body));
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(checks): submit delivery checks and open claims`

---

### Task 3: Ops decides claims

**Files:**

- Create: `src/server/modules/checks/claims.ts`, `src/app/api/claims/[claimId]/route.ts`
- Modify:
  - `src/server/modules/notifications/templates.ts` (`claim.decided`)
  - `src/server/modules/approvals/approvals.ts`: register the `claim` handler there with arrow functions, as `supplier_order` does, because the claims module imports `approvals.ts` back. `approvalLink` for `claim` currently falls through to `/approvals/<id>`; Task 5 points it at the claim page.
- Test: `tests/api/claims.test.ts`

**Interfaces:**

- Produces:
  - **The `claim` approval handler:**
    - **Approve:** posts `claims_expense → shop_balance` (`refund_claim`, `claimId`). The claim becomes `approved`, and the pickup and participations `closed`. It runs `refreshRoundCompletion`, logs `claim.approved` and `refund.issued`, and emits `claim.decided { claimId, shopId, units, decision: 'approved', refundSen }` and `refund.issued { kind: 'claim' }`. Messages:
      - owner: `Claim approved: {RM total} refunded for {units} {missing|damaged|missing or damaged}.`, e.g. "Claim approved: RM 151.85 refunded for 1 damaged carton."
      - staff: `Claim approved for {units} {…}.`
    - **Reject** (reason required; `decideApproval` already answers 422 `REASON_REQUIRED` before the handler runs, so the handler can rely on `input.reason`): the claim becomes `rejected`, and the pickup and participations `closed`. It logs `claim.rejected` and emits `claim.decided { decision: 'rejected', refundSen: 0 }`. Owner and staff are told `Claim rejected: {reason}.`
  - `getClaimForCaller(deps, caller, claimId): Promise<ClaimView>`. The owner of the shop and Ops can read it; others get 404.
    - `ClaimView = { claimId; status; totalRefundSen; reason; lines: { productName; missing; damaged; refundSen; photoUrls: string[] }[]; check: { submittedBy; submittedAt; lines }; hubCheck: { goodUnits; damagedUnits; notes; checkedAt }; consignmentHistory: { status; at }[] }`.
    - Photo URLs are 10-minute signed links.

- [ ] **Step 1: Write the failing tests:**

```ts
it('refunds RM 151.85 when Ops approves the claim (story 128)', async () => {
  const before = await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI });
  await nadia.post(`/api/approvals/${claimApproval}/approve`, {});
  expect(await balanceOf(app.prisma, { kind: 'shop_balance', shopId: KEDAI })).toBe(before + 15185);
  expect(await lastWhatsapp('ahSeng', 'claim.decided')).toBe(
    'Claim approved: RM 151.85 refunded for 1 damaged carton.',
  );
  expect(await lastWhatsapp('rahim', 'claim.decided')).toBe('Claim approved for 1 damaged carton.');
});
it('needs a reason to reject a claim', async () => {
  /* reject {} → 422; with reason → status rejected, no posting */
});
it('shows Ops the photos, the check, the hub record and the consignment history together (story 127)', async () => {
  const c = (await nadia.get(`/api/claims/${claimId}`)).body;
  expect(c.lines[0].photoUrls).toHaveLength(1);
  expect(c.hubCheck.goodUnits).toBe(105);
  expect(c.consignmentHistory.map((h: any) => h.status)).toEqual([
    'planned',
    'dispatched',
    'arrived',
    'completed',
  ]);
});
it('keeps a claim from other shops and suppliers', async () => {
  /* siti → 404; farid → 404 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(checks): Ops approves or rejects claims`

---

### Task 4: The full lifecycle through the API (story 181)

**Files:**

- Test: `tests/api/lifecycle-happy-path.test.ts`

- [ ] **Step 1: Write the test.** One `it` per stage, sharing state in order. It runs against the `'reference'` seed plus `seedCurrentWeek`, i.e. the demo seed, with these stages:
  1. Ah Seng sets up from the sample order.
  2. Basket drafted; Rahim adds 1 evaporated milk.
  3. Ah Seng pays with DuitNow QR. Assert: CM line `paidSen` = 98454.
  4. Skip to cut-off. Assert: CM refund 7344 and Kafe's refund 12330.
  5. Nadia approves the CM order. Assert: evidence 105, 1533000, 9 shops, check passed.
  6. Farid confirms with `2026-11-07`, then marks it dispatched.
  7. Nadia hub-checks 105 good. Assert: payout 1533000, CM hold 0.
  8. Complete other rounds; Nadia dispatches and arrives the Ipoh consignments.
  9. Rahim collects with the code, then checks with CM damaged 1 and a photo.
  10. Nadia approves the claim. Assert: a refund of 15185.
  11. Finally: `runMoneyChecks` all passed; `verifyLogChain` valid; and the CM round reaches `completed` once every CM pickup is closed. To get there in this step:
      - As Nadia, move every remaining CM consignment through its statuses. These go to Johor Bahru (door), Kuantan, Petaling Jaya, Seremban and Melaka, and carry featured goods, so "Complete other rounds" left them planned.
      - Background pickups then close automatically.
      - Submit "All received" for Gerai's pickup (Kumar) and Kafe's (Danial).
- [ ] **Step 2:** Run `pnpm test:api -- lifecycle-happy-path`. Expected: PASS. Fix the code, not the test, when an amount differs.
- [ ] **Step 3: Commit:** `test(api): prove the full happy path end to end`

---

### Task 5: Check and claim screens

**Files:**

- Create: `src/components/checks/delivery-check-form.tsx`, `src/components/checks/photo-picker.tsx`, `src/app/(shell)/ops/claims/[claimId]/page.tsx`, `src/app/(shell)/owner/claims/[claimId]/page.tsx`
- Modify: `src/app/(shell)/staff/deliveries/[pickupId]/page.tsx` and `src/app/(shell)/owner/pickups/[pickupId]/page.tsx` (after "Collected": the check), `src/app/(shell)/ops/page.tsx` (claims in the inbox)

- [ ] **Step 1: The check flow, for staff and owners.**
  - Lines with product, picture and expected units. There are no prices for anyone in this flow.
  - A big "All received" button, and "Report a problem", which opens per-line missing and damaged steppers and a photo picker (camera or gallery, up to 3, upload progress).
  - Submit leads to "Done".
- [ ] **Step 2: Ops claim review.** Photos (signed links), the delivery-check lines, the hub record and the consignment history side by side, with "Approve" and "Reject" (a reason is required).
- [ ] **Step 3: Owner claim page.** The status and amount.
- [ ] **Step 4: Verify** with Chrome DevTools at 390 × 844 after `pnpm db:reset`, running the demo script through step 6:
  1. Rahim collects, reports 1 damaged carton with a photo, and submits.
  2. Nadia's claim page shows the photo.
  3. Nadia approves.
  4. Ah Seng's money history shows the RM 151.85 claim refund.
- [ ] **Step 5:** Run `pnpm verify`. Expected: PASS.
- [ ] **Step 6: Commit:** `feat(ui): add the delivery check and claim review`

---

### Milestone verification

- [ ] Run `pnpm verify`, then `pnpm db:reset` and the Task 5 walkthrough.
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 76–81, 127, 128, 147, 181).
