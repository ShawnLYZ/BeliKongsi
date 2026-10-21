# M11 P1 Owner Automation and Money Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners can:

- let routine weeks approve themselves under a rule they control
- withdraw their balance
- get a monthly summary and an estimate of time saved
- export their data
- ask for their shop to be deleted cleanly

**Architecture:** Each P1 rule from build design §9 (P1-1 to P1-6) is a small extension of an existing module:

- the auto-approve check hooks into `draftBasketForShop`
- withdrawals are a new posting kind
- the monthly summary is a new job in `runDueJobs`
- export streams a ZIP from existing views
- deletion is a new approval type whose handler anonymises identity tables only, which works because the log never stored names (R7)

**Tech Stack:** Prisma migrations, `fflate` (ZIP), the M2–M10 services.

**Spec:** build design §9 P1-1 to P1-6 (rules marked **decision** included); PRD stories 40, 41, 60, 88, 89, 90, 149; PRD §8 ("P1 withdrawal"), §25 ("Access", "Retention"), §27 ("Time saved per week").

## Global Constraints

- Index §2 (G1–G10) applies.
- P1-1:
  - the cap defaults to RM 500.00 (50000 sen)
  - the condition "every line's starting all-in price is below my usual price" is on by default, and a line without a usual price fails it
  - the rule is checked once, right after the Monday draft
  - payment takes the balance first, then the simulated DuitNow AutoDebit
  - a failure leaves a draft, with a notice
- P1-1: only a mandate reference is stored, never bank details (story 146).
- P1-2: posting shop balance → partner cash; any amount from RM 0.01 up to the balance.
- P1-6: Ops can approve only when there are no active rounds, open pickups, open claims or pending payments, and the balance is zero. Money records stay; the log is unchanged.
- All new action codes are appended to `ACTIONS`: `auto_approve.enabled`, `auto_approve.disabled`, `balance.withdrawn`, `data.exported`, `data.deletion_requested`, `shop.anonymised`. The new event type is `balance.withdrawn`.

## Review Focus

1. **The auto-approve rule with a line that has no usual price:** the basket isn't auto-approved, and the owner gets the normal "basket ready" notice. Pinned in Task 1.
2. **Withdrawing 0, a fraction, or more than the balance:** 422, with nothing posted. Pinned in Task 2.
3. **The monthly summary job running several times on the 1st:** one notice per shop. Pinned in Task 3.
4. **A deletion approval while a payment is pending:** blocked with 422 `DELETION_BLOCKED`, listing what's open. Pinned in Task 6.
5. **Exported names containing commas or quotes:** valid CSV quoting that opens correctly in a spreadsheet. Pinned in Task 5.

---

### Task 0: Re-sync

- [ ] **Step 1:** `git switch -c m11-p1-owner-automation-money`
- [ ] **Step 2:** Follow index §6. Confirm the consumed names: `draftBasketForShop`, `createPayment` (`settleImmediatelyWith`), `completePaymentSuccess`, `PaymentsPartner`, `runDueJobs`, `monthlySavings`, `getBalanceView`, `registerApprovalHandler`, `updateShopSettings`.
- [ ] **Step 3:** Commit any plan edits.

---

### Task 1: Auto-approve with a simulated AutoDebit mandate (P1-1)

**Files:**

- Create: `prisma/migrations/<ts>_p1_owner/migration.sql`, `src/server/modules/baskets/auto-approve.ts`, `src/app/api/shops/[shopId]/auto-approve/route.ts`
- Modify:
  - `prisma/schema.prisma`:
    - model `AutoApproveRule` (`auto_approve_rules`): shopId unique, enabled, capSen default 50000, requireBelowUsual default true, mandateReference?, mandateAgreedAt?, updatedAt
    - `PaymentMethod` += `auto_debit`
    - `PostingKind` += `withdrawal`
    - `ApprovalType` += `data_deletion`
    - `Shop` += `oldMinutesPerWeek Int?`, `anonymisedAt DateTime?`
    - model `Withdrawal` (`withdrawals`): id, shopId, amountSen, partnerReference, createdAt
    - The migration ends with `SELECT bk_secure_all_tables();`.
  - `src/server/adapters/payments.ts`: `createMandate(shopId): Promise<{ reference }>`, `autoDebit({ mandateReference, amountSen, paymentId }): Promise<{ reference }>`, `withdraw({ shopId, amountSen }): Promise<{ reference }>`. Reference prefixes: `SIM-MANDATE-`, `SIM-DEBIT-`, `SIM-WD-`.
  - `src/server/modules/baskets/draft.ts`: call `evaluateAutoApprove(ctx, basketId)` after drafting.
  - `src/server/modules/activity/actions.ts`: the new codes.
  - `src/server/modules/notifications/templates.ts`: `basket.auto_approved`, `basket.auto_approve_failed`.
- Test: `tests/api/auto-approve.test.ts`

**Interfaces:**

- Produces:
  - `getAutoApproveRule(deps, caller, shopId)`.
  - `setAutoApproveRule(deps, caller, shopId, input: { enabled: boolean; capSen?: number; requireBelowUsual?: boolean; agreeToMandate?: boolean })` (owner):
    - Enabling without a mandate needs `agreeToMandate: true`; otherwise 422 `MANDATE_REQUIRED`.
    - It logs `auto_approve.enabled` or `auto_approve.disabled` with before and after.
  - `evaluateAutoApprove(ctx, basketId): Promise<'approved' | 'not_eligible' | 'debit_failed'>`:
    - **Approved:** the payment goes through `createPayment(..., settleImmediatelyWith: 'auto_debit')`, with the balance first and the remainder by `autoDebit`. It logs `basket.approved` as actor system with reason `Auto-approve rule: total within {RM cap} and every item below your usual price`. Owner notice: `Your basket was approved automatically: {n} items, {RM total} paid by DuitNow AutoDebit (simulated). You can still cancel any item before {formatMytShort(deadline)}.`
    - **Debit failed:** the basket stays a draft. Owner notice: `Automatic payment failed (simulated). Please approve and pay your basket by {formatMytShort(deadline)}.`
    - **Not eligible:** nothing extra happens; the usual `basket.ready` notice stands.

- [ ] **Step 1: Write the failing tests** (`seed: 'reference'`, rounds open at the anchor):

```ts
it('needs mandate consent to switch the rule on', async () => {
  expect((await siti.put(`/api/shops/${GERAI}/auto-approve`, { enabled: true })).status).toBe(422);
  expect(
    (
      await siti.put(`/api/shops/${GERAI}/auto-approve`, {
        enabled: true,
        agreeToMandate: true,
        capSen: 200000,
      })
    ).body,
  ).toMatchObject({
    enabled: true,
    capSen: 200000,
    mandateReference: expect.stringMatching(/^SIM-MANDATE-/),
  });
});
it('approves and pays a routine basket automatically (story 40)', async () => {
  app.clock.set('2026-11-01T22:00:00Z');
  await draftWeeklyBaskets(app.deps);
  expect((await basketOf('GERAI', '2026-W45')).status).toBe('paid');
  expect((await paymentOfBasket('GERAI')).method).toBe('auto_debit');
  expect(await lastWhatsapp('siti', 'basket.auto_approved')).toBe(
    'Your basket was approved automatically: 4 items, RM 1,392.20 paid by DuitNow AutoDebit (simulated). You can still cancel any item before Thu 8 pm.',
  );
});
it('leaves the basket for the owner when the cap is exceeded or a line has no usual price', async () => {
  /* cap default 50000 → draft; or a line without a usual price → draft */
});
it('keeps the basket a draft when the simulated debit fails', async () => {
  /* partner.autoDebit rejects → status draft; notice basket.auto_approve_failed */
});
it('logs switching off and every auto-approval (story 41)', async () => {
  /* auto_approve.disabled; basket.approved with actorType 'system' and the rule reason */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(baskets): auto-approve routine baskets with a simulated AutoDebit mandate`

---

### Task 2: Withdrawing the balance (P1-2)

**Files:**

- Create: `src/server/modules/payments/withdraw.ts`, `src/app/api/shops/[shopId]/balance/withdraw/route.ts`
- Modify: `src/server/modules/payments/views.ts` (money history kind `withdrawal`), `src/server/modules/notifications/templates.ts` (`balance.withdrawn`)
- Test: `tests/api/withdraw.test.ts`

**Interfaces:**

- Produces: `withdrawBalance(deps, caller, shopId, { amountSen }): Promise<{ withdrawalId; amountSen; partnerReference; balanceSen }>` (owner, idempotent route).
  - Validation: a whole number from 1 to the balance; otherwise 422 `INVALID_AMOUNT`.
  - It posts `shop_balance → partner_cash` (`withdrawal`), writes a `Withdrawal` row, logs `balance.withdrawn` and emits `balance.withdrawn { shopId, amountSen }`.
  - Owner notice: `Withdrawal sent (simulated): {RM} to the bank account registered with the payments partner.`

- [ ] **Step 1: Write the failing tests:**

```ts
it('pays the balance out to the partner (story 60)', async () => {
  const r = (await ah.post(`/api/shops/${KEDAI}/balance/withdraw`, { amountSen: 7344 })).body;
  expect(r).toMatchObject({ amountSen: 7344, partnerReference: expect.stringMatching(/^SIM-WD-/) });
  expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
});
it.each([0, 1.5, 999_999_999])('refuses an amount of %s', async (amountSen) => {
  expect((await ah.post(`/api/shops/${KEDAI}/balance/withdraw`, { amountSen })).status).toBe(422);
});
it('shows the withdrawal in the money history', async () => {
  /* kind 'withdrawal', label 'Withdrawal (simulated)' */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(payments): simulated balance withdrawals`

---

### Task 3: The monthly savings summary (P1-3)

**Files:**

- Create: `src/server/modules/savings/monthly-summary.ts`
- Modify: `src/server/modules/jobs/run.ts` (add `sendMonthlySummaries`), `src/server/modules/notifications/templates.ts` (`savings.monthly_summary`)
- Test: `tests/api/monthly-summary.test.ts`

**Interfaces:**

- Produces: `sendMonthlySummaries(deps): Promise<{ sent: number }>`.
  - It runs from 09:00 MYT on the 1st, for the previous month, for each non-background shop with at least one participation that month.
  - Dedupe key: `monthly-summary:<shopId>:<YYYY-MM>`.
  - Owner text: `Your BeliKongsi summary for {Month name}: {roundsJoined} rounds, {unitsBought} units, {RM refunds} refunded, {RM fees} in fees, {RM verified} verified savings.`

- [ ] **Step 1: Write the failing tests:**

```ts
it("sends November's summary on 1 December at 09:00, once (story 89)", async () => {
  app.clock.set('2026-12-01T01:00:00Z');
  await sendMonthlySummaries(app.deps);
  await sendMonthlySummaries(app.deps);
  const n = await app.prisma.notification.findMany({
    where: { type: 'savings.monthly_summary', userId: seedId('user', 'ahSeng') },
  });
  expect(n).toHaveLength(1);
  expect(n[0].whatsappText).toMatch(
    /^Your BeliKongsi summary for November: \d+ rounds, \d+ units, RM [\d,.]+ refunded, RM [\d,.]+ in fees, RM [\d,.]+ verified savings\.$/,
  );
});
it('waits until 09:00 Malaysia time', async () => {
  /* 2026-12-01T00:59:00Z → sent 0 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(savings): monthly summary notice`

---

### Task 4: Time saved (P1-4)

**Files:**

- Modify: `src/server/modules/directory/directory.ts` (settings accept `oldMinutesPerWeek`, 0–600), `src/server/modules/savings/savings.ts` (`timeSaved`), `src/lib/views/savings.ts`
- Test: `tests/api/time-saved.test.ts`

**Interfaces:**

- Produces: `MonthlySavingsView.timeSaved: { oldMinutesPerWeek: number | null; weeks: { week: string; measuredMinutes: number; savedMinutes: number }[]; totalSavedMinutes: number; label: 'estimate' }`.
  - `measuredMinutes` = ceil((payment `completedAt` − basket `firstOpenedAt`) / 60 s), and 0 for auto-approved baskets.
  - `savedMinutes` = max(0, old − measured).

- [ ] **Step 1: Write the failing test:**

```ts
it('estimates time saved from the old routine minus measured approval time (story 90)', async () => {
  await ah.patch(`/api/shops/${KEDAI}/settings`, { oldMinutesPerWeek: 45 });
  // first opened 06:10, paid 06:13 → measured 3 → saved 42
  const t = (await ah.get(`/api/shops/${KEDAI}/savings?month=2026-11`)).body.timeSaved;
  expect(t).toMatchObject({ oldMinutesPerWeek: 45, totalSavedMinutes: 42, label: 'estimate' });
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(savings): estimate time saved`

---

### Task 5: Data export (P1-5)

**Files:**

- Create: `src/server/modules/directory/export.ts`, `src/app/api/shops/[shopId]/export/route.ts`
- Test: `tests/api/export.test.ts`

**Interfaces:**

- Produces: `exportShopData(deps, caller, shopId): Promise<{ filename: string; bytes: Uint8Array }>` (owner). The route returns `application/zip` with `Content-Disposition: attachment`.
  - The filename is `belikongsi-export-<YYYY-MM-DD>.zip`.
  - **Files and columns:**
    - `orders.csv`: `participation_id, round_cycle, product, quantity, status, joined_at, paid_sen, paid_rm, final_all_in_sen, refund_sen`
    - `payments.csv`: `payment_id, created_at, purpose, method, total_sen, balance_applied_sen, paid_sen, status`
    - `money-history.csv`: the money-history items
    - `savings.csv`: `participation_id, product, status, basis, saving_sen`
    - `README.txt`: explains each file, and says the data is synthetic and the payments simulated
  - CSV follows RFC 4180, UTF-8 with a BOM, and quotes fields containing `,`, `"` or line breaks.
  - It logs `data.exported`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('exports orders, payments, money history and savings as one ZIP (story 88)', async () => {
  const res = await ah.get(`/api/shops/${KEDAI}/export`);
  const files = unzipSync(res.raw);
  expect(Object.keys(files).sort()).toEqual([
    'README.txt',
    'money-history.csv',
    'orders.csv',
    'payments.csv',
    'savings.csv',
  ]);
  expect(strFromU8(files['orders.csv']).split('\n')[0]).toBe(
    '﻿participation_id,round_cycle,product,quantity,status,joined_at,paid_sen,paid_rm,final_all_in_sen,refund_sen',
  );
});
it('quotes commas and quotes in values', () => {
  expect(toCsvRow(['Kopi "O", kaw', 1])).toBe('"Kopi ""O"", kaw",1');
});
it("refuses another shop's export", async () => {
  /* siti → 404 */
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement, adding `fflate`. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(data): export a shop's data as a ZIP of CSV files`

---

### Task 6: The deletion request (P1-6)

**Files:**

- Create: `src/server/modules/directory/deletion.ts`, `src/app/api/shops/[shopId]/deletion-request/route.ts`
- Modify: `src/server/modules/notifications/templates.ts` (`deletion.decided`)
- Test: `tests/api/deletion.test.ts`

**Interfaces:**

- Produces:
  - `requestDeletion(deps, caller, shopId, { reason?: string })` (owner):
    - It creates the approval `data_deletion` (assignee Ops). Its evidence is `{ activeRounds, openPickups, openClaims, pendingPayments, balanceSen, canApprove }`.
    - It logs `data.deletion_requested`.
  - **The `data_deletion` handler.**
    - **Approve:** it re-checks the preconditions and returns 422 `DELETION_BLOCKED` with `details` when anything is still open. It then anonymises:
      - the shop's name becomes `Deleted shop <first 8 of id>`; address, state and postcode are emptied; lat/lng are set to 0; `anonymisedAt` is set
      - memberships are ended
      - users with no other membership get the display name `Deleted user`, and their email and phone are emptied
      - the usual list and the notifications for those users are deleted
      - photos are deleted from storage and marked `deletedAt`
      - it logs `shop.anonymised`, with ids only
    - **Reject:** the reason is required, and the owner is notified.
    - Payments, participations, postings and log entries are untouched.

- [ ] **Step 1: Write the failing tests** (Kafe Contoh after the full flow):

```ts
it('blocks deletion while money or goods are still open', async () => {
  await mei.post(`/api/shops/${KAFE}/deletion-request`, {});
  const r = await nadia.post(`/api/approvals/${deletionApproval}/approve`, {});
  expect(r).toMatchObject({
    status: 422,
    body: { code: 'DELETION_BLOCKED', details: { balanceSen: expect.any(Number) } },
  });
});
it('anonymises the shop and keeps money records and the log intact (story 149)', async () => {
  // Kafe withdraws its whole balance; every pickup closed; no pending payments
  const logCount = await app.prisma.activityLogEntry.count();
  await nadia.post(`/api/approvals/${deletionApproval}/approve`, {});
  expect((await app.prisma.shop.findUniqueOrThrow({ where: { id: KAFE } })).name).toMatch(
    /^Deleted shop /,
  );
  expect(
    await app.prisma.user.findUniqueOrThrow({ where: { id: seedId('user', 'mei') } }),
  ).toMatchObject({ displayName: 'Deleted user', email: null, phone: null });
  expect(await app.prisma.participation.count({ where: { shopId: KAFE } })).toBeGreaterThan(0);
  expect(await app.prisma.activityLogEntry.count()).toBe(logCount + 1); // shop.anonymised appended
  expect((await verifyLogChain(app.prisma)).valid).toBe(true);
  expect((await runMoneyChecks(app.prisma)).allPassed).toBe(true);
});
```

- [ ] **Step 2:** Run. **Step 3:** Implement and register the handler. **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(data): deletion requests that anonymise without breaking records`

---

### Task 7: Screens

**Files:**

- Modify: `src/app/(shell)/owner/settings/page.tsx`, `src/app/(shell)/owner/money/page.tsx`, `src/app/(shell)/owner/savings/page.tsx`, `src/app/(shell)/ops/page.tsx`

- [ ] **Step 1: Settings.**
  - **Auto-approve:** a switch, the cap, and the condition, with a consent dialog headed "DuitNow AutoDebit — Simulated". It explains that only a mandate reference is kept and the rule can be switched off any time.
  - **Time saved:** "How many minutes a week did ordering take you before BeliKongsi?"
  - **Your data:** "Export my data" and "Request deletion", with what deletion keeps and why.
- [ ] **Step 2: Money and savings.** Money gets "Withdraw" with an amount sheet, labelled "Simulated". Savings gets a time-saved card labelled "Estimate". The Ops inbox shows deletion requests with the evidence.
- [ ] **Step 3: Verify** each flow at 390 × 844, then run `pnpm verify`. Expected: PASS.
- [ ] **Step 4: Commit:** `feat(ui): owner automation, withdrawals, time saved, export and deletion`

---

### Milestone verification

- [ ] Run `pnpm verify` (it includes `e2e` since M10).
- [ ] Merge to `main` with `--ff-only` and post the milestone report (stories 40, 41, 60, 88, 89, 90, 149).
