# BeliKongsi — Product Requirements Document

**Buy together, pay wholesale.** *Beli sama-sama, harga borong.*

| | |
|---|---|
| **Product** | BeliKongsi: group buying for micro food businesses, built as a module of the Orbyte business hub |
| **Challenge** | SDC Hackathon, Domain 2: Orbyte Smart SME Challenge, "Less Busywork, Better Business" (domain sponsor: Alpha Red Solutions) |
| **Primary users** | Owners and staff of Malaysian micro F&B businesses: kopitiam, hawker stalls, small cafés and restaurants |
| **Other users** | Suppliers (distributors) and the BeliKongsi operations team ("Ops") |
| **Status** | Design agreed on 21 Oct 2026 (31 decisions, listed in the decision log under Further Notes). Ready to build. |
| **Sources** | Domain 2 problem statement and marking rubric; Orbyte introduction deck; the earlier BeliBijak feature spec, whose KongsiBeli module became this product's core |
| **Team assumption** | 3–4 developers comfortable with JavaScript/TypeScript; about 2–3 weeks to the preliminary submission |
| **Data rule** | Synthetic data only. Every business in the product and demo is fictional and named "… Contoh" (Malay for "example"). |

---

## Problem Statement

### The owner's story (illustrative, fictional persona)

> "I run a small kopitiam in Ipoh. Every week I restock the same things: condensed milk, evaporated milk, cooking oil, eggs, coffee powder, cups and takeaway boxes. I message three or four suppliers on WhatsApp, wait for replies, and pay what they quote. My orders are a few cartons at a time, so I never reach a distributor's minimum order or its cheaper carton price. The big chains pay less than I do for exactly the same tin of milk.
>
> The other owners I know have the same problem. We've talked about ordering together, but someone has to collect everyone's quantities, add them up, bargain with the supplier, work out who gets what, split the delivery, collect the money and chase whoever hasn't paid. Nobody has time to do that every week, so we keep overpaying. The one time we tried, the count went wrong and two of us argued about who was short."

### The problem, precisely

- **It is a recurring job.** Micro F&B businesses restock the same shelf-stable staples and packaging every week or two.
- **Their orders are too small for wholesale prices.** Each shop orders below suppliers' minimum order quantities and cheaper price tiers, so it pays the "buy-alone" price, often through middlemen or cash-and-carry stores.
- **Buying together would fix it, but organising it is busywork.** Pooling orders means collecting quantities over WhatsApp, adding them up, negotiating, splitting deliveries and bills, collecting money and chasing late payers, every single cycle.
- **So it rarely happens, and when it does, it goes wrong.** Manual tallies and splits cause short deliveries, overpayments and arguments. There is no shared record of who ordered, paid or received what.
- **Today's tools don't help.** WhatsApp groups, paper and spreadsheets don't track price tiers, hold money, split deliveries or keep a record.
- **The people involved are busy and have mixed digital confidence.** Owners decide and pay; workers receive the goods and shouldn't see prices; nobody has time for training.
- **Privacy matters.** Nearby shops are often competitors. They don't want others to see what they buy or what they pay.

### Who else feels it

- **Suppliers** handle many tiny WhatsApp orders, carry credit risk on small accounts and run half-empty delivery routes. They would offer tier prices for a guaranteed, prepaid, consolidated order.
- **The Orbyte hub** needs business capabilities beyond HR and admin that bring SMEs, suppliers and partner services together in one place.

### What the solution must respect (from the Domain 2 brief)

- Remove **one recurring operational burden**, improve accuracy and consistency, and be learnable **without formal training**.
- Show one complete journey: **trigger → connected data → decision logic → human approval → visible outcome**, recorded in an **activity log**.
- Use **AI only where it adds value**, and keep **people in control** through permissions, approvals and a record of actions.
- **Fit Orbyte** as a connected hub, be **reusable** across many SMEs, and state the **business benefit** and **SDG** contribution.
- Use **synthetic data only**, and explain how **PDPA** principles would be handled in a real deployment.
- Stay out of: **processing real payments**, statutory filings, and legal or financial advice. Don't reproduce Orbyte's existing HR and admin functions.

---

## Solution

### In one paragraph

BeliKongsi turns weekly restocking into one tap. Each product from each supplier runs a standing group order, a **Kongsi round**, on a fixed weekly (or fortnightly) cycle. An owner saves a **usual list** once, by pasting an old WhatsApp order that AI reads. Every Monday, BeliKongsi turns the usual list into a ready-to-pay **weekly basket**; staff can add items, and the owner approves and pays in one action. BeliKongsi is the buyer: it collects the payments, places one consolidated order with the supplier at the price tier the combined quantity reaches, and receives the goods at a regional **hub**. A logistics partner then brings each shop's goods to its chosen **pickup point** (no delivery fee) or to its door (delivery fee). Shops anywhere in Malaysia can join any round, and shops stay anonymous to each other and to suppliers. Everyone in a round pays the same final price; anything paid above it comes back automatically to the shop's **BeliKongsi balance**. Every unit paid for is either delivered or refunded, and every step is recorded in a tamper-evident activity log.

### What each person experiences

- **Owner:** sets up in about a minute by pasting an old WhatsApp order. Gets a ready basket every Monday, taps "Why this price?" to see how each price is built, and approves and pays in one action. Refunds arrive automatically. Staff collect the goods with a code. The owner sees savings that are confirmed against what actually arrived.
- **Staff:** two big buttons, "Add to next basket" and "Confirm delivery". Staff never see prices.
- **Supplier:** receives one prepaid, consolidated order per round from BeliKongsi. Confirms or rejects it, marks it dispatched, and is paid for what arrives at the hub. Never sees which shops are in a round.
- **BeliKongsi Ops:** approves each supplier order before pooled money is committed, checks deliveries at the hub, moves goods through the (simulated) partner steps, decides damage and shortage claims, and can show that the money always balances.

### Product principles

1. **One approval a week.** Restocking staples becomes a single decision.
2. **Buy together, stay anonymous.** Any shop in Malaysia can join any round. No shop or supplier ever sees another shop's identity.
3. **Honest all-in prices.** Every unit price includes the BeliKongsi fee and the shipping share. Delivery fees are shown separately. "Why this price?" explains every number.
4. **Never pay more than agreed.** Owners pay at most the starting price, price limits protect them, and every difference is refunded automatically.
5. **Delivered or refunded.** Every unit paid for either arrives or is refunded, and the ledger proves it.
6. **People stay in control.** Owners approve spending, Ops approves supplier orders, suppliers confirm, rejections need a reason, and everything is logged.
7. **AI reads, rules decide.** AI only turns messy text into a draft for a person to confirm. Prices, refunds and approvals follow fixed rules.
8. **An Orbyte module, not a standalone shop.** Shared sign-in, roles, approvals, notifications and audit trail. Payments and logistics go through Orbyte partners, and the pricing engine is offered back to the ecosystem as an API.
9. **No training needed.** Plain English, few screens, big buttons, phone first.

### How the journey maps to the brief's five steps

| Brief step | In BeliKongsi |
|---|---|
| 1. Trigger | Every Monday at 06:00 (Malaysia time) a weekly basket is drafted from each shop's usual list. Owners can also join any open round by hand. |
| 2. Connected data | The usual list (items, quantities, usual prices, price limits), the supplier's price tiers, live round totals, shipping and delivery quotes from the logistics partner, and the shop's BeliKongsi balance. |
| 3. Decision logic | The Kongsi Engine applies fixed rules: which price tier was reached, each shop's all-in price, price-limit dropouts, refunds and short-delivery allocation. AI makes no decisions. |
| 4. Human approval | The owner approves and pays the basket. Ops approves the consolidated supplier order. The supplier confirms it. Ops decides claims. |
| 5. Visible outcome and log | The final price and refunds are shown and notified, the order is placed, a pickup code is issued, the delivery is checked and verified savings appear. Every step is in the hash-chained activity log. |

### Glossary

These terms are used with exactly these meanings throughout this document, the code and the UI copy.

| Term | Meaning |
|---|---|
| **Kongsi** | The user-facing name for a group order ("Join this week's Kongsi"). In this spec a Kongsi is a **round**. |
| **Round** | One product from one supplier, open until a fixed **cut-off**. All participations kept in a round pay the same final price. |
| **Cadence** | How often a product's rounds repeat: weekly (default) or fortnightly (e.g. packaging). Monthly is supported by configuration. |
| **Cut-off** | The moment a round closes. Default: Thursday 20:00 Malaysia time (MYT). |
| **Price tiers** | A product's quantity-based unit prices for the whole round, e.g. 20+ cartons RM 158.00, 50+ RM 152.00, 100+ RM 146.00. Frozen when the round opens. |
| **Minimum** | The first tier's quantity. A round below its minimum at cut-off fails, and everyone is refunded in full. |
| **Starting price** | The first tier's unit price: the highest price a round can end at. Owners pay this when they join. |
| **Final price** | The tier price reached at cut-off, after price-limit dropouts. Everyone kept in the round pays it. |
| **BeliKongsi fee** | 2% of the goods price per unit, rounded to the sen. Only charged on successful rounds. |
| **Shipping share** | The per-unit cost of moving goods from the supplier's hub to the destination region, taken from the logistics partner's rate card. |
| **All-in unit price** | Goods unit price + BeliKongsi fee + shipping share. Price limits and savings use this number. |
| **Delivery fee** | A per-delivery charge for door delivery: one per shop per delivery date. Pickup has no delivery fee. |
| **Usual list** | A shop's standing list of products, with the normal quantity per cycle, the usual price and the price limit. |
| **Usual price** | What the shop pays today per unit, delivered, as entered by the owner. Used for savings and as the default price limit. |
| **Price limit** | The highest all-in unit price a shop accepts for an item. If the final all-in price is higher, the shop drops out of that round with a full refund. |
| **Buy-alone price** | The supplier's unit price for a single shop ordering alone. The fallback savings baseline, always labelled as such. |
| **Weekly basket** | The draft order generated each week from the usual list (plus staff additions), which the owner approves and pays. |
| **Participation** | One shop's paid quantity in one round. In the UI: "your Kongsi". |
| **BeliKongsi balance** | A shop's closed-loop balance that holds refunds. Applied automatically to the next payment. Never negative, never expires. |
| **Supplier order** | BeliKongsi's single consolidated order to a supplier for one formed round. |
| **Hub** | A regional receiving point, run by a logistics partner, where suppliers deliver round totals. |
| **Hub check** | Ops comparing what the supplier delivered to the hub with the supplier order. |
| **Shortfall** | Units that were ordered but not received in good condition at the hub. |
| **Allocation** | The units assigned to a participation after the hub check. |
| **Pickup point** | A partner location where shops collect their goods. |
| **Consignment** | Goods moving from one hub to one destination (a pickup point or a shop's door) for one delivery date. Ops moves consignments through the partner's statuses. |
| **Pickup** | One shop's goods at one destination for one date. Has one pickup code and may combine several rounds. |
| **Pickup code** | A 6-digit code that lets staff collect goods without revealing the shop's name. |
| **Delivery check** | Staff confirming what arrived and reporting any missing or damaged units. |
| **Claim** | A report of missing or damaged units found in a delivery check, decided by Ops. Approved claims are refunded. |
| **Verified savings** | Savings on units confirmed as received in a delivery check. Before that, savings are "estimated". |
| **Ops** | The BeliKongsi operations team role. |
| **Kongsi Engine** | The pure pricing, allocation and refund logic. Also exposed as a stateless API for other Orbyte apps. |
| **Orbyte shell** | The simulated Orbyte frame: sign-in, business and role switcher, approvals inbox, notifications and activity log. |
| **Partner adapters** | The simulated payments and logistics partners, each behind a replaceable interface. |
| **Demo clock** | Application time = real time + a demo offset. All business rules read time from it. |
| **Background shops** | Synthetic shops that take part in rounds so that price tiers are reached in the demo. |

### Priority tags

Every user story and feature carries one tag:

- **P0**: must be built and work end to end (screens, server, database and logic) in the full-stack prototype, and is demoed live in the preliminary round.
- **P1**: added once P0 works, for the final round.
- **P2**: roadmap only, described in the pitch.

### An example week (synthetic numbers)

- **Monday 06:05.** Kedai Kopi Contoh (Ipoh) finishes setup and its basket appears, including 6 cartons of condensed milk. The condensed milk round has 99 cartons so far (tier 2, RM 152.00). "Why this price?" says: "1 more carton and everyone pays RM 146.00." The owner pays the starting all-in price of RM 164.09 per carton (RM 158.00 goods + RM 3.16 fee + RM 2.93 shipping to Ipoh), so RM 984.54 for 6 cartons.
- **Thursday 20:00, cut-off.** The round closes at 105 cartons from 9 shops, reaching tier 3 (RM 146.00). The final all-in price for Ipoh is RM 151.85 (RM 146.00 + RM 2.92 fee + RM 2.93 shipping). RM 73.44 (6 × RM 12.24) goes back to the shop's BeliKongsi balance. In another round, Kafe Contoh's Grade B eggs line drops out: its price limit of RM 12.20 is below the final all-in price of RM 12.33, so it gets a full refund of RM 123.30.
- **Friday.** Ops approves the supplier order: 105 cartons × RM 146.00 = RM 15,330.00. The supplier confirms and dispatches to the Klang Valley hub.
- **Following Monday.** At the hub check, 105 good cartons are received. The supplier is paid for 105.
- **Tuesday.** The goods are ready at the Ipoh pickup point. Staff collect them with the pickup code and report 1 dented carton with a photo. Ops approves the claim, and RM 151.85 is refunded.
- **Result.** The owner's usual price was RM 165.00, so the verified savings on condensed milk this week are 5 cartons × RM 13.15 = RM 65.75.

The seeded demo uses these numbers. The end-to-end test asserts the exact seeded amounts.

---

## User Stories

Each story carries its priority tag. Numbering is continuous across groups.

### A. Getting started (owner)

1. [P0] As an owner, I want to sign in with the Orbyte sign-in I already use (Microsoft or Google, simulated), so that I don't need another password.
2. [P0] As an owner, I want BeliKongsi to already know my business name, address and team from Orbyte, so that I don't type them again.
3. [P0] As an owner, I want a 3-step setup (paste my usual order → choose pickup or delivery → done), so that I can start in about a minute without training.
4. [P0] As an owner, I want a "Try with sample data" button, so that I can explore BeliKongsi before entering my own orders.
5. [P0] As an owner, I want a plain-English notice during setup explaining what data BeliKongsi keeps, why, who processes it (AI provider, payment partner, logistics partner) and how to stop, so that I can agree with confidence.
6. [P0] As an owner, I want to pick my pickup point on a map and from a list sorted by distance, so that I choose the most convenient one.
7. [P0] As an owner, I want to choose door delivery instead and see the delivery fee before confirming, so that I can decide whether the convenience is worth it.
8. [P0] As an owner, I want to be told when my shop is too far for door delivery (more than 20 km from the nearest pickup point), so that I'm not offered something that can't happen.
9. [P0] As an owner, I want my first weekly basket created as soon as I finish setup (when rounds are open), so that I can start saving this week.
10. [P0] As a new owner, I want empty screens to explain what will appear there, with an example, so that I understand the app before I have data.

### B. Usual list and AI reading

11. [P0] As an owner, I want to paste an old WhatsApp order message (e.g. "炼奶 4箱, minyak 1 tin, telur A 10 papan, cawan 16oz 2 ctn"), so that BeliKongsi builds my usual list without a long form.
12. [P0] As an owner, I want each pasted line matched to a catalogue product with a quantity, so that I can see exactly what BeliKongsi understood.
13. [P0] As an owner, I want shorthand units such as "ctn", "箱", "kotak", "papan", "tin" and "pek" understood and converted to the product's unit, so that I can write the way I always do.
14. [P0] As an owner, I want uncertain matches highlighted with up to three alternative products to choose from, so that mistakes are caught before anything is saved.
15. [P0] As an owner, I want lines that matched nothing shown as "not found" with a catalogue search, so that I can add them by hand.
16. [P0] As an owner, I want AI never to invent products that aren't in the catalogue, so that I only ever see things I can buy.
17. [P0] As an owner, I want nothing saved until I confirm, so that AI never changes my list on its own.
18. [P0] As an owner, I want phone numbers and similar personal details removed from my pasted message before it is sent to the AI provider, so that personal data isn't shared unnecessarily.
19. [P0] As an owner, I want to enter my usual price per item (what I pay today, delivered), so that BeliKongsi can show real savings and protect me from paying more.
20. [P0] As an owner, I want my usual price to become each item's default price limit, so that a Kongsi never costs me more than buying the usual way.
21. [P0] As an owner, I want to change or remove the price limit for any item, so that I control how much I'm willing to pay.
22. [P0] As an owner, I want to edit my usual list later (quantities, usual prices, limits, and adding or removing items through the catalogue), so that it stays accurate as my business changes.
23. [P0] As an owner, I want a simple pick-from-catalogue form as an alternative to pasting, so that I can still set up if the AI is unavailable or I prefer tapping.
24. [P0] As an owner, I want a clear message when the AI couldn't read my text, telling me to use the form, so that I'm never stuck.
25. [P0] As an owner, I want the activity log to show what AI suggested and what I changed, so that there's a record of who decided what.
26. [P1] As an owner, I want to photograph an old invoice and have it turned into a usual list draft, so that I don't need to find an old WhatsApp message.

### C. Weekly basket

27. [P0] As an owner, I want a ready-to-pay basket built from my usual list every Monday at 06:00, so that restocking takes one approval a week.
28. [P0] As an owner, I want the basket to include only products whose rounds close this week, so that fortnightly items appear only when they can be bought.
29. [P0] As an owner, I want to see each line's starting all-in price, the price it is currently heading to, and my estimated savings, so that I know what I'm committing to.
30. [P0] As an owner, I want to see the amount I'll pay now, the BeliKongsi fee, any delivery fee and how much of my balance will be used, so that there are no surprises.
31. [P0] As an owner, I want "Why this price?" on every line, showing the tier reached, the shipping share, the fee and the delivery fee in plain English, so that I understand and trust each number.
32. [P0] As an owner, I want to change quantities or remove lines before approving, so that this week's basket fits this week's needs.
33. [P0] As an owner, I want lines added or changed by staff highlighted with who changed them, so that I review them before paying.
34. [P0] As an owner, I want to switch between pickup and door delivery for this week's basket, so that I can adapt to my week.
35. [P0] As an owner, I want to approve and pay the whole basket in one action, so that weekly ordering is done in seconds.
36. [P0] As an owner, I want to skip this week's basket, so that I'm never pushed to buy what I don't need.
37. [P0] As an owner, I want reminders 24 hours and 3 hours before cut-off if I haven't decided, so that I don't miss a round by accident.
38. [P0] As an owner, I want an unapproved basket to expire at cut-off without charging me, so that nothing is bought without my approval.
39. [P0] As an owner, I want a countdown to cut-off on my home screen, so that I know how much time I have.
40. [P1] As an owner, I want an optional auto-approve rule (for example, "total under RM 500 and every item cheaper than my usual price"), so that routine weeks need no action while I stay in control.
41. [P1] As an owner, I want to switch the auto-approve rule off at any time and see every auto-approval in the activity log, so that automation never hides what happened.

### D. Catalogue and rounds

42. [P0] As an owner, I want to browse all open rounds with product pictures, pack size, supplier and cut-off, so that I can buy items that aren't on my usual list.
43. [P0] As an owner, I want each round to show its price tiers, a progress bar of the total quantity, how many shops have joined and how many units are needed for the next tier, so that I can see how close the cheaper price is.
44. [P0] As an owner, I want never to see other shops' names or individual quantities, so that competitors can't see mine either.
45. [P0] As an owner, I want each round's all-in price calculated for my pickup point or door, so that the price shown is what I will actually pay per unit.
46. [P0] As an owner, I want to join a round with a quantity, an optional price limit and a pickup or delivery choice, paying the starting price, so that I can buy outside my weekly basket.
47. [P0] As an owner, I want a warning when my price limit is below the round's starting all-in price, telling me which tier the round must reach for me to stay in, so that I understand the risk of dropping out.
48. [P0] As an owner, I want to search the catalogue by English, Malay or Chinese names and common shorthand, so that I find products the way I name them.
49. [P0] As an owner, I want to see each product's buy-alone price next to its Kongsi tiers, so that I can see the benefit of buying together.
50. [P0] As an owner, I want to see when the next round of an item closes if I missed the cut-off, so that I know when I can buy it.
51. [P0] As an owner, I want a round's prices locked once it opens, so that a supplier can't change the deal halfway.

### E. Paying and the BeliKongsi balance

52. [P0] As an owner, I want to pay on a familiar DuitNow QR or FPX online banking screen that is clearly labelled "Simulated", so that the flow feels real without moving real money.
53. [P0] As an owner, I want my BeliKongsi balance applied automatically before any new payment, so that refunds are reused without effort.
54. [P0] As an owner, I want a failed payment to leave my basket unpaid and unchanged, with a clear retry option, so that I'm never half-joined.
55. [P0] As an owner, I want a receipt for each payment listing every line, the fee, the shipping shares and any delivery fee, so that I can keep records.
56. [P0] As an owner, I want to see my balance and every money movement (payments, refunds, balance used) in a simple money history, so that I can trace every ringgit.
57. [P0] As an owner, I want to cancel a paid line before cut-off and get a full refund to my balance, so that I can change my mind safely.
58. [P0] As an owner, I want my balance never to go below zero and never to expire, so that I can't lose money held by BeliKongsi.
59. [P0] As an owner, I want no subscription or per-user fee, with the BeliKongsi fee charged only on successful rounds, so that I only pay when I benefit.
60. [P1] As an owner, I want to withdraw my balance to my bank account (simulated), so that refunds aren't locked inside BeliKongsi.

### F. Round results

61. [P0] As an owner, I want everyone kept in a round to pay the same final price, so that buying together is fair.
62. [P0] As an owner, I want the difference between what I paid and the final all-in price refunded to my balance automatically at cut-off, so that I benefit from every extra shop that joins.
63. [P0] As an owner, I want a full refund, plus the next round's closing date, if a round doesn't reach its minimum, so that I never pay for a Kongsi that didn't happen.
64. [P0] As an owner, I want a full refund and a plain explanation if the final price is above my price limit, so that I'm never charged more than I agreed.
65. [P0] As an owner, I want a full refund if Ops or the supplier rejects the order, so that a cancelled Kongsi costs me nothing.
66. [P0] As an owner, I want a notification after cut-off with the final price, my refund and the expected ready date, so that I know the result without checking.
67. [P0] As an owner, I want a history of my past rounds (final price, refund, delivery result, verified savings), so that I can review my purchasing.
68. [P0] As an owner, I want my delivery fee refunded if every line in that delivery is refunded before dispatch, so that I don't pay for a delivery that won't happen.

### G. Pickup and delivery

69. [P0] As an owner, I want a 6-digit pickup code for each pickup, so that my staff can collect without revealing my shop's name.
70. [P0] As an owner, I want a notification when my goods are ready, with the place, opening hours and pickup code, so that I can send someone at the right time.
71. [P0] As an owner, I want to see where my goods are (waiting for supplier, at hub, on the way, ready, collected or delivered), so that I can plan.
72. [P0] As an owner choosing door delivery, I want "out for delivery" and "delivered" updates, so that someone is ready to receive the goods.
73. [P0] As an owner, I want all my products for one place and date grouped into one pickup, so that collecting is a single trip.
74. [P1] As an owner, I want to be told the new date when a delivery is late, and to be able to cancel an item for a full refund once it is more than 3 days late, so that delays don't leave me stuck.
75. [P1] As an owner, I want reminders on day 1 and day 3 if my goods haven't been collected, so that I don't forget them.

### H. Delivery check and claims

76. [P0] As a staff member, I want to show the pickup code and tap "Collected", so that the handover is recorded.
77. [P0] As a staff member, I want to see each product and the quantity I should receive, without prices, so that I can count what arrived.
78. [P0] As a staff member, I want to tap "All received" when everything is correct, so that the check takes one tap.
79. [P0] As a staff member, I want to report missing or damaged quantities per product, with photos, so that the shop gets refunded.
80. [P0] As an owner, I want to be told when staff report a problem and when Ops decides it, so that I know whether and how much I'll be refunded.
81. [P0] As an owner, I want refunds for missing or damaged units to equal the all-in unit price times the number of units, so that I'm fully compensated.
82. [P0] As an owner, I want a round's savings marked "verified" once staff confirm receipt, so that reports only count goods I actually got.
83. [P1] As an owner, I want a reminder if staff haven't done the delivery check within 24 hours, so that problems are reported while they are fresh.

### I. Savings and reports

84. [P0] As an owner, I want my home screen to show this month's savings, so that I see BeliKongsi's value every time I open it.
85. [P0] As an owner, I want savings calculated as (usual price − all-in unit price) × units received, minus delivery fees paid, so that the number reflects what I actually keep.
86. [P0] As an owner, I want items without a usual price compared with the supplier's buy-alone price and labelled "estimated vs buying alone", so that rough figures are clearly marked.
87. [P0] As an owner, I want a monthly summary of rounds joined, units bought, refunds, fees paid and verified savings, so that I can judge whether BeliKongsi is worth it.
88. [P1] As an owner, I want to export my data (orders, payments, refunds, savings) as a file, so that I can keep my own records or leave the platform.
89. [P1] As an owner, I want a monthly savings summary as a notification, so that I see the value without opening the app.
90. [P1] As an owner, I want to say how long ordering used to take me each week and see the estimated time saved, so that I understand the time value as well as the money.

### J. Notifications

91. [P0] As an owner, I want in-app notifications plus a WhatsApp-style message preview with a "Share via WhatsApp" link, so that I get updates where I already communicate.
92. [P0] As a user, I want only the notifications relevant to my role, and as a staff member I never want to see amounts in them, so that nobody is overwhelmed or over-informed.
93. [P0] As a user, I want each notification to open the exact screen it refers to, so that I can act in one tap.
94. [P0] As an owner, I want rounds that nobody joined to close silently, so that I'm not sent pointless messages.

### K. Staff

95. [P0] As a staff member, I want a home screen with only two big buttons, "Add to next basket" and "Confirm delivery", so that I can use BeliKongsi without training.
96. [P0] As a staff member, I want to search products by the names I use (Malay, Chinese, English or shorthand) and add a quantity, so that I can flag low stock quickly.
97. [P0] As a staff member, I want to see that my addition is waiting for the owner's approval, so that I know it has been passed on.
98. [P0] As a staff member, I want items I add after this week's basket is paid to go into next week's basket, so that nothing I flag is lost.
99. [P0] As a staff member, I want never to see prices, totals, balances or savings, so that commercial information stays with the owner.
100. [P0] As a staff member, I want to see upcoming pickups and deliveries with their codes and places, so that I know where and when to collect.
101. [P0] As a staff member, I want to see my own actions in the activity log, so that I can confirm what I did.
102. [P0] As an owner, I want staff to be unable to pay, cancel, change price limits or change pickup and delivery choices, so that money decisions stay mine.

### L. Supplier

103. [P0] As a supplier, I want a small portal listing BeliKongsi's orders by round, so that I handle one consolidated order instead of many small ones.
104. [P0] As a supplier, I want each order to show the product, total quantity, tier price, total amount, delivery hub and required dispatch date, so that I can fulfil it correctly.
105. [P0] As a supplier, I want to confirm an order with an expected dispatch date, so that BeliKongsi can plan logistics.
106. [P0] As a supplier, I want to reject an order with a reason (for example, out of stock), so that shops are refunded quickly instead of waiting.
107. [P0] As a supplier, I want to mark an order as dispatched to the hub, so that BeliKongsi knows the goods are coming.
108. [P0] As a supplier, I want to see the payment released for the good units received at the hub, so that I know what I'll be paid and why.
109. [P0] As a supplier, I want to see my products, pack sizes, price tiers and round schedules, so that I know which deals run in my name.
110. [P0] As a supplier, I want to see the running totals of my open rounds (quantity and number of shops, never names), so that I can prepare stock.
111. [P0] As a supplier, I want one prepaid customer (BeliKongsi) instead of many small credit accounts, so that I carry no credit risk.
112. [P0] As a supplier, I want new orders and payment releases announced in-app and as WhatsApp previews, so that I don't miss them.
113. [P1] As a supplier, I want to add and edit my products, price tiers, buy-alone prices and round schedules, so that my catalogue stays current without asking Ops.
114. [P1] As a supplier, I want to paste or photograph my price list and have AI draft the tier table for me to confirm, so that onboarding takes minutes.
115. [P1] As a supplier, I want my price changes to apply from the next round only, so that open deals are honoured.
116. [P1] As a supplier, I want a reminder if I haven't confirmed an order within 12 hours, so that rounds don't stall.

### M. BeliKongsi Ops

117. [P0] As an Ops agent, I want an approvals inbox listing supplier orders awaiting approval and claims awaiting decisions, so that nothing consequential happens without a person.
118. [P0] As an Ops agent, I want each supplier order approval to show the round summary (product, final tier, quantity, number of shops, money held versus order cost, and the money check), so that I approve with evidence.
119. [P0] As an Ops agent, I want approving a supplier order to send it to the supplier, so that pooled money is only committed with human sign-off.
120. [P0] As an Ops agent, I want to reject a supplier order with a required reason, triggering full refunds, so that problem rounds are stopped safely.
121. [P0] As an Ops agent, I want to record the hub check (good units received, damaged units, notes), so that shortfalls are captured.
122. [P0] As an Ops agent, I want to preview how a shortfall will be allocated (first come, first served) and the resulting refunds before confirming, so that I can check the outcome.
123. [P0] As an Ops agent, I want the supplier paid only for good units received, so that BeliKongsi never pays for missing goods.
124. [P0] As an Ops agent, I want consignments created automatically after the hub check, grouped by hub, destination and delivery date, so that the logistics work is organised.
125. [P0] As an Ops agent, I want to click the logistics partner's status updates for each consignment (dispatched, arrived at pickup point, out for delivery, delivered), so that the simulated partner moves goods through the flow.
126. [P0] As an Ops agent, I want a map of hubs, pickup points and consignments, so that I can see the network at a glance.
127. [P0] As an Ops agent, I want to review each claim with its photos, the delivery check, the hub record and the consignment record side by side, so that I can decide fairly.
128. [P0] As an Ops agent, I want to approve a claim (refunding the shop automatically) or reject it with a reason, so that the shop gets a clear answer.
129. [P0] As an Ops agent, I want a rounds board grouped by status, so that I can spot stuck rounds.
130. [P0] As an Ops agent, I want a money overview (money held, refunds, supplier payouts, fees, shipping, delivery fees, claims) with an automatic "money in = money out" check, so that I can prove the books balance.
131. [P0] As an Ops agent, I want to see shop names in rounds and orders, so that I can resolve problems, while suppliers and other shops cannot.
132. [P0] As an Ops agent, I want to see the integration events BeliKongsi has emitted, so that I can show how other Orbyte apps would be informed.
133. [P0] As an Ops agent, I want background shops' pickups and checks completed automatically and labelled as simulation, so that only real demo shops need manual steps.
134. [P1] As an Ops agent, I want reminders when a supplier hasn't confirmed or a hub delivery is overdue, so that rounds don't stall.
135. [P1] As an Ops agent, I want to be alerted about goods uncollected after 7 days, so that I can call the owner.
136. [P1] As an Ops agent, I want to cancel an open round in an emergency (for example, the supplier announces a stock-out), with a required reason and full refunds, so that shops aren't left waiting.

### N. Activity log and governance

137. [P0] As an owner, I want every action on my shop's baskets, rounds, payments, refunds, deliveries and claims recorded with who, when, which role, what changed and why, so that I can always find out what happened.
138. [P0] As an Ops agent, I want each log entry to say whether a person, the system or AI performed it, so that automated actions are distinguishable.
139. [P0] As an Ops agent, I want the log to be append-only, with each entry fingerprinted together with the previous one, so that any tampering is detectable.
140. [P0] As an Ops agent, I want a "Verify log" action that recomputes the fingerprint chain and reports the result, so that I can show the record's integrity.
141. [P0] As an owner, I want a timeline on each basket, participation, pickup and claim, so that I can see its full history in one place.
142. [P0] As a supplier, I want to see the log entries for my own orders only, so that I can check actions that affect me without seeing anyone else's.
143. [P0] As a user, I want every rejection, cancellation by Ops and claim decision to require a reason, so that decisions can be explained later.
144. [P1] As an Ops agent, I want to filter the log by date, person, action and subject, and export it as CSV, so that audits are easy.

### O. Privacy and security

145. [P0] As an owner, I want suppliers and other shops never to see my shop's identity or my quantities, so that my business information stays private.
146. [P0] As an owner, I want BeliKongsi never to store my bank or card details, so that a breach can't expose them.
147. [P0] As an owner, I want my delivery photos visible only to my shop and Ops, so that pictures of my premises stay private.
148. [P1] As an owner, I want delivery photos deleted automatically after 90 days, so that data isn't kept longer than needed.
149. [P1] As an owner, I want to request deletion of my data, so that I can leave BeliKongsi cleanly.
150. [P2] As an owner, I want to opt in or out of contributing to anonymous supplier demand insights (shown only as totals from 5 or more shops), so that my data is only shared with my consent.
151. [P0] As a BeliKongsi developer, I want every secret kept on the server and out of the public repository, so that nobody can reach the database or run up our API bills.
152. [P0] As a BeliKongsi developer, I want row-level security switched on for every table and the browser never talking to the database directly, so that the public Supabase key alone can't read any data.
153. [P0] As a BeliKongsi developer, I want the browser-visible Google Maps key restricted to the app's own web addresses, so that it can't be abused elsewhere.
154. [P0] As a BeliKongsi developer, I want the AI provider to receive only the redacted order text and the product catalogue, so that no personal data leaves our system unnecessarily.

### P. Orbyte fit and reuse

155. [P0] As an owner, I want BeliKongsi to look and behave like any other Orbyte module (same sign-in, approvals inbox, notifications and activity log), so that there's nothing new to learn.
156. [P0] As a user with several roles, I want a business and role switcher, so that I can move between contexts (and the demo can show every role).
157. [P0] As an Orbyte platform engineer, I want BeliKongsi's identity, roles, approvals, notifications, audit trail, payments and logistics behind replaceable interfaces, so that real Orbyte services and partners can be plugged in later.
158. [P0] As an Orbyte app developer, I want a documented, stateless Kongsi Engine API that takes orders and price tiers and returns the final price, each buyer's share and the refunds, so that I can reuse group buying in other apps.
159. [P0] As an Orbyte app developer, I want a documented shortfall-allocation API, so that I can reuse fair allocation when supply falls short.
160. [P0] As an Orbyte app developer, I want BeliKongsi to emit named events (round closed, order confirmed, delivered, refund issued and so on), so that other modules can react to them.
161. [P1] As an Orbyte app developer, I want to register a webhook URL and receive those events, so that integrating needs no polling.
162. [P2] As an Orbyte product manager, I want the BeliKongsi fee settled through Orbyte's shared credit wallet, so that billing matches the rest of the platform.

### Q. Demo and judging

163. [P0] As a demo presenter, I want a role switcher to jump between owner, staff, supplier and Ops, so that one person can show the whole journey.
164. [P0] As a demo presenter, I want a "Skip to cut-off" control that moves the demo clock and closes the open rounds, so that a week fits into four minutes.
165. [P0] As a demo presenter, I want a "Complete other rounds" control that runs the Ops, supplier and hub steps for every round except the featured one (logged as demo simulation), so that the demo focuses on one round without waiting.
166. [P0] As a demo presenter, I want a "Reset demo data" control that restores the seeded state in seconds, so that I can rehearse and recover from mistakes.
167. [P0] As a hackathon judge, I want a visible "Made-up data" banner and fictional "Contoh" names everywhere, so that it's clear no real people or businesses are involved.
168. [P0] As a hackathon judge, I want to open the live link on my phone and follow the journey, so that I can check it works.
169. [P0] As a hackathon judge, I want the public GitHub repository to match the demo, with setup steps, tests and the engine API documentation, so that I can judge feasibility.
170. [P0] As a demo presenter, I want a saved AI example to fall back on if the network or the AI fails, so that the demo can continue.
171. [P0] As a demo presenter, I want about 40 background shops already in the rounds, so that cheaper tiers are reached realistically.
172. [P0] As a demo presenter, I want unbranded, AI-generated product pictures labelled "AI-generated image", so that the catalogue looks real without using real brands.
173. [P1] As a hackathon judge, I want an "About" page explaining the problem, the five-step journey and the Orbyte fit, so that I can understand the product without the pitch.

### R. Accuracy and reliability

174. [P0] As an owner, I want a shortfall at the hub never to change my final price, so that supplier mistakes don't cost me.
175. [P0] As an owner, I want shortfalls allocated first come, first served by join time, with missing units refunded in full, so that the rule is simple and rewards joining early.
176. [P0] As an owner, I want to be told when I was shorted, by how many units and why, so that the outcome is explainable.
177. [P0] As an Ops agent, I want every scheduled job (opening rounds, drafting baskets, closing rounds) to be safe to run twice, so that retries never double-charge or double-refund.
178. [P0] As an owner, I want every amount calculated in whole sen with one clear rounding rule, so that totals always add up.
179. [P0] As an owner, I want all times shown in Malaysia time, so that cut-offs and pickups are never confusing.

### S. Engineering quality

180. [P0] As a BeliKongsi developer, I want the engine's money rules checked on thousands of random rounds on every push, so that rounding or allocation bugs are caught before the demo.
181. [P0] As a BeliKongsi developer, I want a full round lifecycle test through the API against a test database, so that the modules are proven to work together.
182. [P0] As a BeliKongsi developer, I want one phone-sized end-to-end browser test that follows the demo script, so that the live demo can't break unnoticed.
183. [P0] As a BeliKongsi developer, I want an accuracy check of 20 messy sample orders run against the AI before each demo, so that I know how reliable order reading is.
184. [P0] As a BeliKongsi developer, I want one deterministic seed dataset shared by the tests and the demo, so that numbers shown on stage are the numbers we test.

### T. Later (roadmap)

185. [P2] As a trusted repeat owner, I want to pay at cut-off instead of when joining, so that I don't tie up cash for days.
186. [P2] As an owner or staff member, I want the app in Bahasa Melayu and Chinese, so that I can use it in my most comfortable language.
187. [P2] As a supplier, I want paid extras (promoted listings, anonymous demand insights), so that I can grow sales through BeliKongsi.
188. [P2] As a business with a manager and a bookkeeper, I want Manager and Bookkeeper roles, so that I can delegate.
189. [P2] As a supplier, I want to post my own group deals, so that I can move stock with volume pricing.
190. [P2] As a kedai runcit owner, I want BeliKongsi for sundry-shop restocking, so that I can save too.
191. [P2] As a food business buying fresh produce, I want cold-chain categories, so that I can pool perishables.
192. [P2] As an owner, I want real Orbyte sign-in, real payments and real logistics partners, so that BeliKongsi can run in production.
193. [P2] As an owner, I want delivery fees based on road distance, so that fees match real routes.
194. [P2] As a demo presenter, I want a guided script mode that highlights the next step, so that anyone in the team can present.
195. [P2] As an Orbyte product manager, I want the same engine offered to other industries (salons, workshops, laundries) and other countries, so that BeliKongsi grows with the Orbyte ecosystem.

---

## Implementation Decisions

### 1. Scope and build order

**P0: works end to end in the prototype**

1. Simulated Orbyte shell: sign-in (simulated Microsoft or Google), business and role switcher, approvals inbox, notifications with WhatsApp previews and share links, activity log views, and a "Made-up data" banner.
2. Catalogue and round schedules (seeded; read-only for suppliers), with AI-generated product pictures made at seed time.
3. Usual list: AI reading of a pasted order (Gemini) with owner confirmation; catalogue form as fallback; usual prices; price limits defaulting to the usual price; default pickup point (map and list) or door delivery with a fee quote.
4. Rounds: continuous rounds per product and cadence, tiers frozen at opening, live progress (total, number of shops, units to next tier), joining from the catalogue, cancelling before cut-off.
5. Weekly baskets: drafted Monday 06:00, staff additions, owner edits, pickup or delivery switch, approve and pay, skip, reminders, expiry at cut-off.
6. Simulated payments (DuitNow QR and FPX screens), receipts, BeliKongsi balance applied automatically, and a double-entry money ledger.
7. Kongsi Engine: quotes, round closing (minimum, tiers, price-limit dropouts), refunds, shortfall allocation, claim refunds and savings, plus the stateless Kongsi Engine API.
8. Round close job and its outcomes: refunds, notifications, log entries and integration events.
9. Ops: approvals inbox (supplier orders and claims), rounds board and detail, hub check with allocation preview, simulated supplier payout, consignments board with partner status buttons, network map, money overview with checks, integration events page, log verification.
10. Supplier portal: orders (confirm with dispatch date, reject with reason, mark dispatched), products and tiers (read-only), open round totals, payouts.
11. Fulfilment: hubs, pickup points, shipping and delivery quotes, consignments, pickups with codes, statuses, and automatic handling of background shops.
12. Delivery check by staff (collect with code; "All received" or report missing and damaged units with photos), claims decided by Ops, refunds.
13. Savings per participation (estimated, then verified), a monthly summary and the home screen card.
14. Activity log: append-only, hash-chained, role-filtered, with timelines and verification.
15. Security baseline: secrets server-side only, row-level security on, no browser database access, restricted Maps key, key file never committed.
16. Demo: deterministic seed, demo clock, "Skip to cut-off", "Complete other rounds", "Reset demo data", saved AI example.
17. Tests: engine example and property tests, API lifecycle tests, one end-to-end test, the AI accuracy set.
18. Live deployment on Vercel and a public GitHub repository with a full README.

**P1: final round**

Owner auto-approve rule; late-delivery and uncollected-goods rules; supplier self-service for products, tiers and schedules with AI price-list import; invoice photo to usual list; balance withdrawal (simulated); log filters and CSV export; event webhooks; reminders for supplier confirmation, overdue hub deliveries and delivery checks; delivery-check window and automatic closing; owner data export and deletion request; 90-day photo deletion job; Ops emergency round cancellation; monthly savings notification and time-saved estimate; About page; partial collection of pickups.

**P2: roadmap in the pitch**

Pay at cut-off for trusted shops; Malay and Chinese UI; supplier paid extras (promoted listings, opt-in demand insights); Manager and Bookkeeper roles and multi-outlet businesses; supplier-posted deals; real Orbyte sign-in, directory, approvals and notifications; real payment, logistics and WhatsApp integrations through Orbyte Connect; road-distance quotes and address geocoding; new categories (kedai runcit goods, fresh produce with cold chain), other industries and countries; guided demo mode; fee settlement through the Orbyte credit wallet; accounting and e-invoicing exports through partners.

**Build order (if time runs short, cut P1 items, never a money rule)**

1. Kongsi Engine with its example and property tests.
2. Data model, migrations, deterministic seed, simulated Orbyte shell (session, role switcher, banner).
3. Catalogue, rounds and usual list (catalogue form first, then AI reading).
4. Weekly basket, simulated payment, balance and ledger.
5. Round close job, outcomes, notifications and activity log.
6. Ops approvals, supplier portal, hub check and payouts.
7. Fulfilment: consignments, pickups, codes, map.
8. Delivery check and claims.
9. Savings, demo controls, polish.
10. End-to-end test, deployment, README.

### 2. Architecture

- **One application.** A single Next.js (App Router) application written in TypeScript: server-rendered, mobile-first pages; JSON API route handlers; a server-only service layer; scheduled jobs exposed as protected endpoints.
- **Data.** Supabase Postgres, reached only from the server through Prisma. Supabase Storage holds product images (public bucket) and delivery photos (private bucket).
- **UI.** Tailwind CSS and shadcn/ui components. English only.
- **Hosting.** Vercel, with one production deployment that provides the live link. Scheduled jobs run on Vercel Cron and are also triggered on demand (see §7).
- **External services.** Gemini for reading order text (server-side); NVIDIA FLUX.2 Klein for product pictures (seed time only); Google Maps JavaScript API for maps (browser).
- **Layers.**
  1. Presentation: role-specific screens.
  2. API: reads the simulated Orbyte session, checks permissions, validates input and shapes each response for the caller's role.
  3. Application services: one per module (§3).
  4. Kongsi Engine (pure) and adapters: Orbyte shell services, payments partner, logistics partner, AI reader, clock.
  5. Persistence: Prisma/Postgres and Storage.
- **Cross-cutting rules.**
  - All business time comes from the Clock (§7). Nothing reads the system time directly.
  - All money is integer sen.
  - Every state change runs in one database transaction that also writes its ledger postings, activity log entries, notifications and integration events (a transactional outbox), so they can never disagree.
  - Input is validated at the API boundary with a schema library (e.g. Zod).
  - Errors use one shape (code, message, details) and these status codes: 400 invalid input, 401 no session, 403 role not allowed, 404 not visible to the caller, 409 state conflict (e.g. the round already closed), 422 business rule broken (e.g. the price limit isn't a positive amount).
  - Payment results, approvals and jobs are idempotent: repeating a call returns the same result and creates no new postings.

### 3. Modules and their interfaces

Interfaces are described by their operations, inputs and outputs, not by code.

| Module | Responsibility | Main operations |
|---|---|---|
| **Kongsi Engine** (pure: no database, network or clock) | All pricing, dropout, refund, allocation and savings rules (§6) | validate tiers; unit amounts at a tier; quote a line; close a round; allocate a shortfall; claim refund; savings; plain-English explanations |
| **Catalogue and schedules** | Products, tiers, buy-alone prices, aliases, unit weights, images, cadence | list and search products (by name, alias or shorthand); get a product with its tiers; P1: supplier create and edit |
| **Rounds** | Round lifecycle | open due rounds (freezing tiers and fee); round progress; join; cancel a participation; close due rounds (calls the engine); cancel a round after a rejection |
| **Usual lists and AI reading** | A shop's standing list | parse pasted text into suggestions (nothing saved); confirm a list; edit items |
| **Weekly baskets** | Drafting and approving weekly orders | draft baskets for the week; add or change lines (staff or owner); switch pickup or delivery; approve and pay; skip; expire at deadline |
| **Payments and ledger** | Money in, money out, balances | create a payment (balance first); apply the simulated partner result; post ledger movements; balances and money history; receipts; supplier payouts; P1: withdrawals; money checks |
| **Supplier orders** | The consolidated order per formed round | draft at close; Ops approval; supplier confirm or reject; mark dispatched; hub check and settlement |
| **Fulfilment** | Moving goods to shops | quotes (shipping share, delivery fee); consignments and pickups; pickup codes; partner status updates; background-shop simulation |
| **Delivery checks and claims** | Receiving goods | collect with code; submit a check; upload photos; create a claim; refund an approved claim |
| **Approvals** (Orbyte shell) | The shared approvals inbox | create a request; list by assignee; approve; reject with reason; expire |
| **Notifications** (Orbyte shell) | Messages to people | send to users by role; in-app list; mark read; WhatsApp preview text and share link |
| **Activity log** (Orbyte shell audit trail) | Tamper-evident record | append (hash-chained); query with role filtering; timeline for a subject; verify the chain |
| **Identity and access** (Orbyte shell) | Who is acting, in which role | simulated sign-in; memberships; switch active business and role; permission checks; role-shaped responses |
| **Savings and reports** | Value shown to owners | savings per participation; monthly summary; home card figures |
| **Integration** | Reuse by other Orbyte apps | integration event outbox and events page; public Kongsi Engine API; P1: webhooks |
| **Demo** | Running the demo | demo clock offset; skip to cut-off; complete other rounds; reset and reseed; saved AI example; banner |
| **Adapters** | Replaceable outside services | payments partner (simulated); logistics partner (simulated rate card); AI reader (Gemini, a fake for tests, a saved example for the demo); image generator (NVIDIA, seed only); clock (system time plus demo offset, fixed in tests) |

### 4. Data model

All money fields are integer sen. All timestamps are stored in UTC and shown in Malaysia time. Identifiers are UUIDs, except activity log sequence numbers.

**Organisations, people and places**

| Entity | Key fields | Rules |
|---|---|---|
| **Shop** | name; type (kopitiam, hawker, café, restaurant, bakery); address; state; postcode; latitude and longitude; default fulfilment (pickup or door); default pickup point; is-background flag | Only the shop's own members and Ops see its identity |
| **Supplier** | name; categories; region; hub; work contact name and phone; status (active, paused) | Only work contact details are stored |
| **Operator** | the single BeliKongsi Ops organisation | |
| **User** | display name; synthetic work email and phone; simulated sign-in provider (Microsoft or Google) | Staff are stored as a name and role only |
| **Membership** | user; organisation (shop, supplier or operator); role (owner, staff, supplier, Ops) | A user can hold several memberships; one is active per session |
| **Hub** | name; region; address; latitude and longitude | Run by the logistics partner |
| **Pickup point** | name; address; state; latitude and longitude; opening hours; active flag | Run by a partner |

**Catalogue and rounds**

| Entity | Key fields | Rules |
|---|---|---|
| **Product** | supplier; name; category; pack description (e.g. "carton of 48 × 390 g tins"); unit name (carton, tin, tray, sack, pack); unit weight in grams; buy-alone price; aliases (English, Malay, Chinese, shorthand); image and AI-generated flag; cadence (weekly, fortnightly, monthly); active flag | |
| **Price tier** | product; position (1 to 5); minimum quantity; unit price | Minimum quantities strictly increase, unit prices strictly decrease, and every tier price is below the buy-alone price |
| **Round** | product; supplier; hub; cycle label (e.g. "2026-W45"); opens at; cut-off at; expected ready date; frozen tier snapshot; frozen fee (basis points, 200); status; final tier position; final unit price; total quantity at cut-off; total quantity kept; closed at | Exactly one open round per active product at any time |

**Shops' orders**

| Entity | Key fields | Rules |
|---|---|---|
| **Usual list** and **usual list item** | shop (one list per shop); item: product, quantity per cycle, usual price (optional), price limit (optional, defaults to the usual price) | |
| **Weekly basket** | shop; basket week (ISO week); status; deadline (earliest cut-off of its lines); fulfilment (pickup or door) and pickup point; approved at and by; skip reason | One basket per shop per week |
| **Basket line** | basket; product; round; quantity; price limit; source (usual list, staff, owner); added or changed by (user and role); removed flag | Staff may only change quantities and add items |
| **Participation** | round; shop; quantity; price limit; fulfilment and destination; joined at; source (weekly basket, catalogue, background seed); basket line; payment; frozen unit shipping share; frozen baseline (usual price, or buy-alone price with a flag); starting all-in unit price; amount paid; final all-in unit price; status; outcome reason | Joined-at plus id gives the first-come order |
| **Delivery fee charge** | shop; delivery date; amount; payment; status (held, passed to partner, refunded) | At most one per shop per door delivery date |

**Money**

| Entity | Key fields | Rules |
|---|---|---|
| **Payment** | shop; purpose (basket or join); external amount; balance applied; method (DuitNow QR or FPX); status; simulated partner reference; idempotency key; created and completed at | Simulated only |
| **Ledger posting** | occurred at; from account; to account; amount (positive); kind; references (round, participation, payment, claim, supplier order, shop, supplier); memo | Append-only. Every money movement is one posting. |

Ledger accounts:

- **Shop balance** (per shop): money BeliKongsi owes the shop. Never negative.
- **Round hold** (per round): money held for a round until it settles.
- **Delivery fee hold** (per shop and date).
- **Supplier payable** (per supplier).
- **Fee revenue.**
- **Logistics payable**: shipping shares and delivery fees, passed through to the partner.
- **Claims expense**: refunds for damage or loss after the hub, recoverable from the logistics partner outside this product.
- **Partner cash**: the outside boundary. Money arriving from, or paid out through, the payments partner.

**Supplier side and fulfilment**

| Entity | Key fields | Rules |
|---|---|---|
| **Supplier order** | round (unique); supplier; hub; quantity; unit price; total; status; approval request; confirmed at; expected dispatch date; rejection reason; dispatched at | |
| **Hub check** | supplier order (unique); good units received; damaged units; notes; checked by and at; shortfall; payout amount | Good units above the ordered quantity are ignored and flagged |
| **Allocation** | participation (unique); allocated units; missing units (shortfall); consignment; pickup | |
| **Consignment** | hub; destination type (pickup point or door); pickup point or shop; delivery date; status; status history; simulated partner reference | |
| **Pickup** | shop; destination; delivery date; 6-digit code; status; collected at and by | Unique per shop, destination and date. The code is unique among open pickups at the same destination. |
| **Delivery check** | pickup (unique); submitted by and at; result (all received or issues); lines: allocation, expected, received good, missing, damaged | |
| **Photo** | delivery check line; storage key; uploaded by and at; delete-after date | Private bucket; P1 deletes after 90 days |
| **Claim** | delivery check; shop; lines (allocation, missing, damaged, refund); total refund; status; approval request; decided by and at; reason | |

**Shell, AI and integration**

| Entity | Key fields | Rules |
|---|---|---|
| **Approval request** | type; subject; organisation scope; assignee role; amount; summary; why approval is needed; evidence; proposed by (user or system); status; decided by and at; reason; expires at | A reason is required to reject |
| **Notification** | user; type; title; body; link; WhatsApp text; created at; read at | Staff notifications never contain amounts |
| **Activity log entry** | sequence; occurred at; actor user; actor role; actor type (person, system, AI); organisation scope; action; subject type and id; before; after; reason; AI metadata; previous hash; hash | Append-only (§14) |
| **AI suggestion run** | shop; redacted input text; model; status; suggestions; latency; confirmed at; change summary | |
| **Integration event** | type; occurred at; version; payload (ids, quantities and amounts only, no names); delivered at (P1) | |
| **Demo settings** | demo mode flag; clock offset; seed version; last reset at; featured round | |

### 5. State machines

**Round**

- scheduled → open (at its opening time; tiers and fee frozen)
- open → empty (cut-off with no participations; closed silently)
- open → failed (cut-off below the minimum after dropouts; everyone refunded in full)
- open → formed (cut-off at or above the minimum; differences refunded; supplier order drafted)
- formed → ordered (Ops approves the supplier order)
- ordered → confirmed (supplier confirms) → dispatched (supplier marks dispatched) → at hub (hub check done; shortfall refunded; supplier paid)
- at hub → completed (every pickup collected or delivered, and checked)
- formed or ordered → cancelled (Ops or the supplier rejects; everyone refunded in full)
- P1: open → cancelled (Ops emergency cancellation with a reason)

**Participation**

- active (paid, before cut-off) → cancelled (owner, before cut-off; full refund)
- active → dropped for price limit, or refunded because the round failed (full refund)
- active → kept (difference refunded) → refunded because the round was cancelled
- kept → allocated (full or partial) → shorted entirely (all units refunded), or received (delivery check submitted) → closed

**Weekly basket**

- draft → payment pending → paid
- payment pending → draft (payment failed)
- draft → skipped
- draft or payment pending → expired (deadline passed)

**Payment**

- pending → succeeded, failed, or voided (the deadline passed before a result arrived)

**Supplier order**

- awaiting Ops approval → awaiting supplier → confirmed → dispatched → settled (hub check and payout done)
- awaiting Ops approval → rejected by Ops
- awaiting supplier → rejected by supplier

**Consignment**

- planned → dispatched → arrived (pickup point) → completed (all its pickups collected)
- planned → dispatched → out for delivery → delivered (door)

**Pickup**

- waiting (some consignments not yet arrived) → ready (pickup point) or out for delivery (door)
- ready → collected; out for delivery → delivered
- collected or delivered → checked → closed (no claim, or its claim decided)

**Claim**

- submitted → approved (refund issued) or rejected (reason required)

**Approval request**

- pending → approved, rejected (reason required) or expired

### 6. Kongsi Engine rules

The engine is a pure, deterministic module: the same inputs always give the same outputs, and it does no I/O. The application services and the public Kongsi Engine API (§20) both call it, so there is exactly one implementation of every money rule.

**6.1 Money and rounding**

- Every amount is a whole number of sen. Rounding is half-up on non-negative values, applied once per unit amount.
- Per-unit amounts are computed first; every line amount is the per-unit amount × quantity. Refunding k units is therefore always exactly k × the unit amount, and line totals never drift.

**6.2 Tier validation**

- 1 to 5 tiers. Minimum quantities are positive whole numbers and strictly increase; unit prices are positive and strictly decrease.
- Tier 1's quantity is the round's minimum. Tier 1's price is the starting price.

**6.3 Unit amounts at a tier**

- goods = the tier's unit price
- fee = round(goods × fee basis points ÷ 10,000), where the fee is frozen per round at 200 basis points (2%)
- shipping share = the participation's frozen unit shipping share (§10)
- all-in = goods + fee + shipping share

**6.4 Joining**

- The owner pays the starting all-in unit price × quantity, plus the delivery fee for that shop and date if this is its first door line (§10).
- If the price limit is below the starting all-in price, the engine returns the lowest tier at which the shop would stay in, and the UI shows a warning ("You'll only be in if the round reaches 300+ trays"). If no tier satisfies the limit, the UI says so.

**6.5 Quoting before cut-off**

Given the current round total including the caller's own quantity, the quote returns:
- the current tier and the projected all-in price
- the units needed to reach the next tier, and the next tier's price
- a breakdown for "Why this price?"

**6.6 Closing a round**

1. Take the active participations. If there are none, the round is **empty**.
2. Repeat:
   1. total = the sum of the remaining quantities.
   2. If total is below the minimum, the round **fails** and every remaining participation is refunded in full.
   3. Otherwise, tier = the highest tier whose minimum ≤ total. Compute each participation's all-in price at that tier.
   4. Drop every participation whose price limit is set and is below its all-in price (outcome: dropped for price limit, full refund).
   5. If nobody was dropped, stop; otherwise repeat.
3. Every kept participation is refunded (starting all-in − final all-in) × quantity, and its final unit amounts are recorded.

Why this always ends correctly:
- Each repeat removes at least one participation, so the loop ends.
- Removing participations never lowers the total, so the price never falls back below the limit of someone already dropped.
- The final price is never above the starting price, and every kept shop's all-in price is within its limit.

**6.7 Shortfall allocation (first come, first served)**

- Inputs: the kept participations (quantity, joined-at, id, final unit amounts) and the good units received R. If R exceeds the ordered quantity, R is capped at the ordered quantity and the excess is flagged.
- Sort by joined-at, then id. Give each participation its full quantity while units remain; the participation at the boundary gets the remainder; any later ones get zero.
- missing = quantity − allocated; refund = missing × final all-in unit price.
- The final price never changes because of a shortfall.
- Settlement for good units: supplier payable = R × final goods price. Fee revenue = the sum of allocated × unit fee. Logistics payable = the sum of allocated × that participation's unit shipping share.

**6.8 Claim refunds**

- refund = (missing + damaged units found at the shop) × the participation's final all-in unit price.
- Missing plus damaged can never exceed the allocated units.

**6.9 Delivery fee rules**

- One delivery fee per shop per door delivery date, charged with the first payment that includes a door line for that date.
- It is refunded if every participation attached to that door pickup is refunded before the consignment is dispatched.
- Delivery fees are never split across lines or units.

**6.10 Savings**

- Baseline per unit: the usual price frozen when the shop joined. If none was set, the buy-alone price, flagged "estimated vs buying alone".
- unit saving = baseline − final all-in unit price. It can be negative, and is shown honestly if it is.
- Estimated savings (before the delivery check) = unit saving × allocated units.
- Verified savings (after the delivery check) = unit saving × (allocated − missing − damaged).
- Monthly savings = the sum of verified savings for checks submitted in the month − delivery fees for pickups checked in that month.

**6.11 Money invariants**

These are checked by the property tests (§Testing) and live on the Ops money page:
- Every posting moves a positive amount between two accounts, so all account balances (including partner cash) always sum to zero.
- A round's hold is zero once the round is empty, failed, cancelled or settled. Before cut-off it equals the sum paid for its active participations.
- For each participation: paid = all refunds from the round hold + allocated good units × final all-in price.
- No shop balance, round hold or delivery fee hold ever goes negative.
- Kept shops never pay above their price limit, and the final price is never above the starting price.

**6.12 Engine operations**

| Operation | Inputs | Outputs |
|---|---|---|
| validate tiers | tiers | valid, or a list of errors |
| unit amounts | tier price, fee basis points, unit shipping share | goods, fee, shipping share, all-in |
| quote | tiers, fee, unit shipping share, quantity, current round total, optional price limit | starting amounts; current tier and projected amounts; units to the next tier and its price; lowest tier that satisfies the limit; explanation |
| close round | tiers, fee, participations (id, quantity, joined-at, unit shipping share, optional price limit, amount paid) | status (empty, failed or formed); final tier and price; number of iterations; per participation: outcome, unit amounts, final line amount, refund and reason text; totals |
| allocate shortfall | kept participations (id, quantity, joined-at, final unit amounts), good units received, final goods price | per participation: allocated, missing and refund; supplier payable; fee revenue; logistics payable; excess flag |
| claim refund | final unit amounts, allocated, missing, damaged | refund, or a validation error |
| savings | baseline and its flag, final all-in price, units | estimated or verified saving |
| explain | an outcome | plain-English sentences reused by the UI and the activity log, e.g. "Dropped: the final all-in price of RM 12.33 is above your limit of RM 12.20. Full refund: RM 123.30." |

**6.13 Worked examples**

Condensed milk round (tiers: 20+ RM 158.00, 50+ RM 152.00, 100+ RM 146.00):

| | Ipoh (shipping RM 2.93) | Johor Bahru or Kuantan (shipping RM 4.29) |
|---|---|---|
| Starting all-in (158.00 + 3.16 fee + shipping) | RM 164.09 | RM 165.45 |
| Final all-in at tier 3 (146.00 + 2.92 fee + shipping) | RM 151.85 | RM 153.21 |
| Refund per carton at cut-off | RM 12.24 | RM 12.24 |

- Kedai Kopi Contoh pays 6 × RM 164.09 = RM 984.54 and gets back 6 × RM 12.24 = RM 73.44.
- Supplier order: 105 cartons × RM 146.00 = RM 15,330.00.
- Shortfall example: if only 100 good cartons arrive, the supplier is paid 100 × RM 146.00 = RM 14,600.00, and the last joiners lose the 5 missing cartons in reverse join order, each refunded at their own final all-in price.

Grade B eggs for Kafe Contoh (tier 1: 100+ RM 11.70; fee RM 0.23; shipping from the Johor hub to Kuantan RM 0.40):
- Starting all-in RM 12.33, above its limit of RM 12.20. At joining, the warning says the shop stays in only at the 300+ tier (all-in RM 11.93).
- The round closes at 130 trays (tier 1). The shop is dropped and refunded 10 × RM 12.33 = RM 123.30. The round re-checks at 120 trays, still tier 1, and stops.

### 7. Scheduling, time and the demo clock

- **Time zone.** Malaysia time (UTC+8, no daylight saving). Stored in UTC, shown in MYT with weekday names (e.g. "Thu 6 Nov, 8:00 pm").
- **Default weekly calendar.**
  - A new round opens as soon as the previous one closes, so an open round always exists.
  - Monday 06:00: weekly baskets drafted.
  - Wednesday 20:00 and Thursday 17:00: reminders (24 hours and 3 hours before cut-off) to owners who haven't decided.
  - Thursday 20:00: cut-off.
  - Friday 12:00: Ops approval target. Friday 18:00: supplier confirmation target.
  - Saturday: dispatch to the hub. Following Monday: hub check.
  - Tuesday 10:00: ready for pickup or out for delivery. Pickups stay open for 7 days.
- **Fortnightly cadence.** Cut-off every second Thursday (even ISO weeks), otherwise the same pattern. A product's schedule is configurable.
- **Basket composition.** A weekly basket includes products whose current round's cut-off falls inside that basket week. Its deadline is the earliest cut-off among its lines.
- **Jobs.**
  - Open due rounds.
  - Draft weekly baskets. This also runs immediately when an owner finishes setup during an open week.
  - Send reminders.
  - Close due rounds.
  - Expire baskets.
  - P1: late-delivery check, uncollected reminders, photo deletion.
- **How jobs are triggered.**
  - A Vercel Cron schedule calls a protected job endpoint, as often as the hosting plan allows (at least daily). The endpoint needs a secret.
  - The same jobs also run on demand: a "due work" check runs when relevant pages load, and the demo controls call them directly.
  - Every job locks the rows it changes, re-checks status before acting and can safely run twice or at the same time. Correctness never depends on cron precision.
- **Demo clock.**
  - now = real time + a stored offset. All business logic reads time through the Clock interface; tests inject a fixed clock.
  - "Skip to cut-off" sets the offset so that now = the earliest open cut-off + 1 minute, then runs "close due rounds".
  - "Reset demo data" sets the clock to the most recent Monday 06:05 MYT.

### 8. Payments, BeliKongsi balance and ledger

**Approve and pay (weekly basket)**

1. Re-quote every line. Lines whose round has already closed are removed, with a notice.
2. Compute the total at starting prices, plus the delivery fee if one is needed.
3. Apply the BeliKongsi balance first. The external amount is whatever remains.
4. If the external amount is zero, the payment succeeds immediately. Otherwise the basket moves to payment pending and the owner sees the simulated checkout.
5. **Simulated checkout:**
   - a "Simulated payment — no real money moves" banner
   - a choice of "DuitNow QR" (a placeholder QR image) or "FPX online banking" (a list of fictional banks)
   - "Pay (simulated)" and, for testing, "Simulate failure"
   - Payment method names appear as plain text only, with no real logos or bank branding.
6. **On success:** participations are created (joined-at = the success time); postings are written (partner cash → round hold for each line; shop balance → round hold for the balance used; the delivery fee into the delivery fee hold); the basket approval request is marked approved; a receipt is created; notifications, log entries and integration events are written.
7. **On failure:** the basket returns to draft, no postings are made, and the owner can retry. A result that arrives after the deadline voids the payment.

**Joining from the catalogue** uses the same flow, with purpose "join".

**Cancelling a line before cut-off:** round hold → shop balance for the full amount paid. The delivery fee is also refunded if no door lines remain for that date.

**Postings at each later event (from → to)**

| Event | Postings |
|---|---|
| Cut-off, kept participation | round hold → shop balance (the difference) |
| Cut-off, dropped or failed | round hold → shop balance (full amount) |
| Round cancelled after rejection | round hold → shop balance (remaining amount); delivery fee hold → shop balance where no door lines remain |
| Hub check | round hold → shop balance (shortfall refunds); round hold → supplier payable (good units × goods price); round hold → fee revenue; round hold → logistics payable (shipping shares) |
| Supplier payout (simulated, at hub check) | supplier payable → partner cash |
| Door consignment dispatched | delivery fee hold → logistics payable |
| Claim approved | claims expense → shop balance |
| P1 withdrawal | shop balance → partner cash |

**Receipts:** one per payment. Each lists every line (product, quantity, starting all-in price, fee and shipping share), any delivery fee, the balance used and the amount paid, and states "Issued by BeliKongsi (simulated). Not a tax invoice."

**Money history (owner):** a plain list of payments, refunds (with their reason), balance used and claim refunds, with the running balance.

**Ops money overview:** money held per open round, refunds issued, supplier payouts, fee revenue, logistics payable, claims expense and partner cash, plus the invariant checks from §6.11 shown as pass (✅) or fail (❌) with links to any failing round.

### 9. Supplier orders and the hub check

- **Drafting.** When a round forms, the close job drafts one supplier order (final quantity, final goods price, hub) and an Ops approval request. The evidence includes:
  - product and supplier
  - final tier and quantity
  - number of shops
  - the money held compared with order cost + fees + shipping, with the check result
  - a link to the round detail
- **Ops decision.**
  - Approve: the order moves to "awaiting supplier", a supplier confirmation request is created, and the supplier is notified.
  - Reject (reason required): the round is cancelled with full refunds.
- **Supplier decision** (approval type "supplier confirmation", assigned to the supplier organisation).
  - Confirm: requires an expected dispatch date.
  - Reject (reason required): the round is cancelled with full refunds, and Ops is notified.
- **Dispatch.** The supplier marks the order dispatched to the hub.
- **Hub check (Ops).**
  1. Enter good units received, damaged units and notes.
  2. Preview the engine's shortfall allocation and its refunds.
  3. Confirm. In one transaction this writes: the allocations, the shortfall refunds, the settlement postings, the simulated supplier payout, the consignments and pickups (§10), the notifications (shortfall notices to affected owners, a payout notice to the supplier), the log entries and the integration events.
- **Demo "Complete other rounds".** For every formed round except the featured one, it runs the Ops approval, supplier confirmation and dispatch, a hub check with every unit received in good condition, and consignment dispatch and arrival. The actor is "system", and each log entry has the reason "Demo simulation".

### 10. Fulfilment and logistics

- **Network.** Suppliers deliver each round's total to the BeliKongsi hub in their region. The logistics partner moves each shop's goods from that hub to the shop's pickup point, or to its door via the pickup point nearest the shop.
- **Distances.** Straight-line (great-circle) distance between stored coordinates, rounded to 0.1 km and computed on the server. No routing or geocoding calls in P0. A band includes its upper edge (exactly 60.0 km falls in the first band).
- **Shipping share** (simulated partner rate card, synthetic values). Per-unit shipping share = unit weight × rate, rounded to the sen. It is quoted when a shop joins and frozen on the participation.

  | Hub → destination pickup point | Rate per kg |
  |---|---|
  | up to 60 km | 8 sen |
  | over 60 km, up to 200 km | 15 sen |
  | over 200 km, up to 400 km | 22 sen |
  | over 400 km | 30 sen |

- **Delivery fee** (door delivery, from the pickup point nearest the shop).

  | Distance | Fee |
  |---|---|
  | up to 5 km | RM 8.00 |
  | over 5 km, up to 10 km | RM 12.00 |
  | over 10 km, up to 20 km | RM 18.00 |
  | over 20 km | not available (pickup only) |

- **Consignments.** Created at each hub check, one per hub, destination and delivery date. Ops moves them through dispatched → arrived (pickup point) or out for delivery → delivered (door). In real life these updates would arrive from the partner through Orbyte Connect; here an Ops screen simulates them.
- **Pickups.** One per shop, destination and delivery date. A pickup collects that shop's allocations across every consignment going to the same place on the same date.
  - It becomes **ready** (or **out for delivery**) once all its consignments have arrived. P1 adds partial collection.
  - Its 6-digit code is random, unique among open pickups at that destination, and shown to the shop's owner and staff.
  - For door delivery the courier asks for the code, like a delivery PIN.
- **Collecting.** Staff enter or show the code and tap "Collected". The pickup point partner is simulated, so validating the code inside the app stands in for the handover.
- **Background shops.** When a consignment arrives or is delivered, background shops' pickups are collected and checked "All received" automatically. The actor is "system", and each log entry is labelled "background shop simulation".
- **Maps.** See §18.

### 11. Delivery check and claims

- **Check screen (staff or owner).** One line per product in the pickup, showing the expected units (allocated). Staff tap "All received", or enter missing and damaged units per line. Prices are never shown to staff.
- **Photos.** Up to 3 per issue line. Images only, at most 5 MB each, stored in the private bucket. They are uploaded through short-lived signed upload URLs issued by the server, and viewed through signed URLs that expire after 10 minutes. Visible only to the shop's members and Ops.
- **Submitting.**
  - No issues: the pickup moves to checked and then closed, and the savings become verified.
  - With issues: a claim is created with the engine-computed refund for each line, and an Ops approval request of type "claim" is created. The owner is notified with the claimed units; the amount is shown to owners only.
- **Ops decision.** Ops sees the photos, the delivery check lines, the hub check record and the consignment history together.
  - Approve: claims expense → shop balance, and the owner is notified.
  - Reject (reason required): the owner and staff are notified, staff without amounts.
- **Rules.**
  - One delivery check per pickup.
  - Missing plus damaged units can never exceed the allocated units.
  - P1: a 72-hour claim window, a reminder after 24 hours, and automatic closing ("received, not checked", unverified) after 72 hours.

### 12. Approvals (Orbyte-style inbox)

| Type | Created when | Assigned to | Approve means | Reject or expire means |
|---|---|---|---|---|
| Weekly basket | basket drafted | the shop's owner | paid (approval = successful payment) | skipped (optional reason) or expired at the deadline |
| Supplier order | round forms | Ops | order sent to the supplier | rejected (reason required); round cancelled with full refunds |
| Supplier confirmation | Ops approves an order | the supplier organisation | confirmed, with a dispatch date | rejected (reason required); round cancelled with full refunds |
| Claim | delivery check with issues | Ops | refund issued | rejected (reason required) |

- Every request shows: what it is, how much, why approval is needed, the evidence and who (or what) proposed it.
- The inbox shows pending requests for the caller's active role. Each item opens its subject screen; for baskets, the basket screen with "Approve & pay".
- Every decision is logged with the decider, their role and the reason.
- P1: reminders and escalation (supplier confirmation after 12 hours; Ops approvals after 12 hours).

### 13. Notifications

| Notification | To | Example message (WhatsApp preview) |
|---|---|---|
| Basket ready | owner | "Your Kongsi basket for this week is ready: 5 items, RM 1,630.20 now, about RM 1,512 after cut-off. Approve by Thu 8 pm." |
| Basket reminder (24 h, 3 h) | owner | "Reminder: your Kongsi basket closes today at 8 pm." |
| Staff added an item | owner | "Rahim added 1 carton of evaporated milk to this week's basket." |
| Payment succeeded or failed | owner | "Payment received (simulated). You're in 5 Kongsi rounds this week." |
| Round result: kept | owner | "Condensed milk closed at RM 146.00 a carton (105 cartons, 9 shops). RM 73.44 is back in your balance. Ready Tue 11 Nov." |
| Round result: dropped for price limit | owner | "Grade B eggs closed at RM 12.33 all-in, above your limit of RM 12.20. Full refund: RM 123.30." |
| Round failed | owner | "Coffee powder didn't reach 10 cartons. Full refund: RM 255.98. Next round closes Thu 13 Nov." |
| Order rejected (Ops or supplier) | owner | "The supplier couldn't fill flour this week. Full refund: RM 132.84." |
| Shortfall | owner | "The supplier delivered short. 2 cartons of condensed milk refunded: RM 306.42." |
| Ready for pickup | owner and staff | "Ready at Ipoh pickup point (10 am–7 pm). Pickup code 482 913." |
| Out for delivery or delivered | owner and staff | "Your goods are out for delivery today. Have code 482 913 ready." |
| Claim decision | owner (with amount), staff (without) | "Claim approved: RM 151.85 refunded for 1 damaged carton." |
| New order to confirm | supplier | "New BeliKongsi order: 105 cartons of condensed milk for the Klang Valley hub. Please confirm." |
| Payout released | supplier | "Payment released: RM 15,330.00 for 105 cartons (simulated)." |
| Approval needed | Ops | "Supplier order awaiting approval: condensed milk, RM 15,330.00." |
| Supplier rejected | Ops | "Ladang Telur Contoh rejected the Grade A eggs order: out of stock." |

- **Channels.** Each notification appears in the in-app list. It also has WhatsApp preview text (at most 300 characters) and a "Share via WhatsApp" link that opens WhatsApp's share sheet with the text and no phone number. Nothing is ever sent automatically to a real number.
- **Targeting.** Each user receives only their role's notifications for their active organisations. Staff text never includes amounts, prices or balances. Every notification links to its screen.
- **Not notified:** rounds that closed empty.
- **Later:** P1 adds the monthly savings summary, late-delivery and uncollected-goods notices, and supplier and Ops reminders.

### 14. Activity log

- **Fields.**
  - sequence (strictly increasing); occurred at
  - actor: user (if any), role, type (person, system or AI)
  - organisation scope; action code; subject type and id
  - before and after (JSON); reason
  - AI metadata (model, number of lines, average confidence, suggestion run id)
  - previous hash; hash
- **Hash chain.**
  - hash = SHA-256 of (previous hash + a canonical JSON serialisation of the entry's fields with sorted keys).
  - The first entry uses a previous hash of 64 zeros.
  - Writers take a lock on the chain head inside the same transaction as the business change, so entries are never written in parallel.
- **Append-only.**
  - The application never updates or deletes entries.
  - The database role used at runtime has no update or delete permission on the log table, and a trigger rejects updates and deletes.
  - "Reset demo data" truncates everything with a separate privileged path and starts a new chain whose first entry is "demo reset".
- **Verification.** "Verify log" recomputes every hash in order and reports either "valid (N entries)" or the first broken sequence number. Ops can run it; owners see the result on their timelines.
- **Visibility.**
  - Owner: entries scoped to their shop.
  - Staff: their own entries, with amounts redacted.
  - Supplier: entries about their supplier orders.
  - Ops: everything.
- **Action codes (P0).**

  | Area | Actions |
  |---|---|
  | Usual list | AI suggested; confirmed; item updated |
  | Basket | drafted; line added by staff; line changed; fulfilment changed; approved; skipped; expired |
  | Payment and balance | payment created; succeeded; failed; voided; balance applied; refund issued (with kind) |
  | Round | opened; closed (empty, failed or formed); participation joined; cancelled; dropped for price limit |
  | Supplier order | drafted; approved; rejected by Ops; confirmed; rejected by supplier; dispatched |
  | Hub | hub check recorded; shortfall allocated; supplier payout released |
  | Fulfilment | consignment created; consignment status changed; pickup ready; pickup collected; delivered |
  | Check and claim | delivery check submitted; claim submitted; approved; rejected |
  | Shell and demo | signed in; role switched; demo skip to cut-off; demo complete other rounds; demo reset; log verified |

### 15. Roles and permissions

| Action | Owner | Staff | Supplier | Ops |
|---|:-:|:-:|:-:|:-:|
| See product names, packs and pictures | ✅ | ✅ | own products | ✅ |
| See prices, tiers, totals, balance and savings | ✅ own shop | ❌ | own orders and tiers | ✅ |
| Paste an order, edit the usual list, set price limits | ✅ | ❌ | ❌ | ❌ |
| Add an item or change a quantity in a basket draft | ✅ | ✅ | ❌ | ❌ |
| Switch pickup or delivery | ✅ | ❌ | ❌ | ❌ |
| Approve and pay; join a round; cancel before cut-off | ✅ | ❌ | ❌ | ❌ |
| See pickup codes and upcoming pickups or deliveries | ✅ | ✅ | ❌ | ✅ |
| Collect and do the delivery check (with photos) | ✅ | ✅ | ❌ | ❌ |
| See the shop's money history and receipts | ✅ | ❌ | ❌ | ✅ |
| Confirm or reject a supplier order; mark dispatched | ❌ | ❌ | ✅ own | view only |
| Approve or reject a supplier order | ❌ | ❌ | ❌ | ✅ |
| Hub check and supplier payout | ❌ | ❌ | ❌ | ✅ |
| Update consignment status (partner simulation) | ❌ | ❌ | ❌ | ✅ |
| Approve or reject a claim | ❌ | ❌ | ❌ | ✅ |
| See shop names in rounds and orders | own shop only | own shop only | ❌ | ✅ |
| See open round totals and shop counts | ✅ | ❌ | own products | ✅ |
| View the activity log | own shop | own actions | own orders | everything |
| Verify the log; money overview; integration events | ❌ | ❌ | ❌ | ✅ |
| Demo controls (demo mode only) | ✅ | ✅ | ✅ | ✅ |

- **Enforcement.** Every check happens on the server, in the service layer, for every request. Hiding something in the UI is never the protection.
- **Response shaping.**
  - Staff responses are built from dedicated staff views that contain no price, total, balance, savings or amount fields at all.
  - Supplier responses never contain shop identifiers, names or per-shop quantities.
  - Owners only ever receive totals and counts for other shops' participations.
- **Small rounds.** When a round has only two shops, either shop could work out the other's quantity from the total. Identities are still never revealed. This is accepted, and documented in the privacy notice.

### 16. AI: reading orders with Gemini

- **Where AI is used.**
  - P0: a pasted WhatsApp order becomes a usual list.
  - P1: a supplier's price list (text or photo) becomes a draft tier table; an invoice photo becomes a usual list.
- **Where AI is never used.** Prices, tiers, refunds, dropouts, allocation, approvals, "Why this price?" explanations and notifications. Those are fixed rules and templates.
- **Provider and model.**
  - Gemini via Google's official SDK, called only from the server.
  - The model name is configuration. It is chosen from Google's current model list when the build starts: a fast, low-cost model that supports JSON-schema output and image input (image input is needed for P1).
  - One API key is used at a time; the spare keys are not rotated to get around rate limits.
- **Input handling.**
  - At most 2,000 characters and 40 lines.
  - Before sending, the server removes phone numbers (Malaysian and international formats), email addresses and 12-digit identity-card-like numbers.
  - The model is told to ignore greetings, names and delivery chatter.
  - Only the redacted text is sent and stored.
- **Context sent with each request.**
  - For each active product: id, name, pack description, unit name and aliases.
  - A unit alias table:
    - carton = ctn, carton, kotak, 箱
    - tray = papan, tray, 盘, 板
    - tin = tin, tong, 桶
    - sack = guni, karung, sack
    - pack = pek, pack, 包
  - Pack conversions, e.g. 48 tins of condensed milk = 1 carton.
- **Output (enforced with a JSON response schema).**
  - lines: source text; product id (or null); quantity in the product's unit (whole number, or null); unit as written; confidence (0 to 1); up to 3 alternative product ids; a note (e.g. "converted 48 tins to 1 carton")
  - ignored text
- **Server validation.**
  - Product ids must exist and be active. Anything else becomes "not found".
  - Alternatives are filtered the same way.
  - Quantities must be whole numbers ≥ 1.
  - Confidence is clamped to 0–1.
  - Lines with confidence below 0.8, or with alternatives, are highlighted "Please check".
- **Settings.** Low temperature; a 15-second timeout; one retry with a 2-second backoff on rate-limit or server errors; at most 10 parses per shop per hour.
- **Failure.** The error code "AI unavailable" makes the UI offer the catalogue form. In demo mode it also offers "Use saved example", a stored suggestion run for the sample order.
- **Logging.**
  - Each run is stored: redacted input, model, latency and output.
  - An activity log entry with actor "AI" records the line count and average confidence.
  - The owner's confirmation is logged with actor "person" and a summary of what changed (lines accepted unchanged, changed, added, removed).
- **Privacy notice.** Order text is processed by an external AI provider. No names, phone numbers or payment data are sent.
- **Accuracy set.** 20 messy sample orders with expected results (see Testing Decisions). Target: at least 18 of 20 orders with every line correct (product and quantity), and no invented product ids.

### 17. Product images with NVIDIA FLUX.2 Klein

- **Seed-time only.** A one-off seeding step generates one image per product with NVIDIA FLUX.2 Klein. The app never calls the image API at runtime.
- **Prompt template:** "Studio product photo of a plain, unbranded [pack description] on a white background, soft lighting, no text, no logos, no brand names."
- **Process.** A team member reviews every image before it is used. Images are compressed (WebP, about 200 KB at most) and kept with the seed assets, so reseeding and demo resets never call the API again. They are uploaded to the public product-images bucket.
- **Labelling.** Product cards and product detail screens show a small "AI-generated image" caption.
- **Fallback.** If an image is missing or generation fails, a neutral icon for the category is shown.
- **Key handling.** The NVIDIA key is used only from the seeding environment on a developer machine or the server. It never reaches the browser.

### 18. Maps with Google Maps

- **API.** Google Maps JavaScript API in the browser, loaded lazily on the screens that need it.
- **Used on:**
  - the pickup point picker (setup, settings and basket fulfilment): a map with markers, plus a list sorted by distance from the shop, showing opening hours
  - the Ops network map: hubs, pickup points, consignments by status
- **No paid lookups in P0.** All coordinates are stored in the seed data, and distances are computed on the server (§10). No Geocoding, Places or Routes calls.
- **Key.** The browser key is restricted in Google Cloud to the app's production domain and localhost (HTTP referrer restriction), and to the Maps JavaScript API only. It is the only key that reaches the browser.
- **Fallback.** If the map fails to load, the list still works.

### 19. Simulated Orbyte shell and partner adapters

Each outside capability sits behind an interface with a simulated implementation, so the real Orbyte service or partner can replace it without touching business logic.

| Interface | P0 simulated behaviour | Real replacement (P2) |
|---|---|---|
| **Identity** | Sign-in page with "Continue with Microsoft" and "Continue with Google" (simulated) and a list of seeded accounts. The session is an HTTP-only, Secure, SameSite=Lax signed cookie. No passwords. | Orbyte single sign-on (Microsoft or Google; Entra ID) |
| **Directory and roles** | Seeded organisations, users and memberships; a business and role switcher in the top bar | Orbyte org structure, user management, roles and permissions |
| **Approvals** | Approval requests stored in BeliKongsi; a shared inbox component | Orbyte workflow and approvals (with reminders and escalation) |
| **Notifications** | In-app list, WhatsApp preview text and share links | Orbyte notifications, and WhatsApp through Orbyte Connect |
| **Audit trail** | The hash-chained activity log (§14) | Orbyte audit trail |
| **Payments partner** | Simulated checkout page, simulated results, payout references | A licensed payments partner through Orbyte Connect (which would also hold customer funds) |
| **Logistics partner** | Synthetic rate card quotes; consignment statuses clicked by Ops | A logistics partner through Orbyte Connect (quotes, bookings, status webhooks) |
| **AI reader** | Gemini adapter; a fake adapter for tests; a saved-example adapter for demo fallback | Orbyte AI context services, or the same adapter |
| **Clock** | System time plus a demo offset; fixed in tests | System time |

- **Look and feel.** An Orbyte-style top bar with the business switcher and the active role badge, the approvals inbox, the notification bell and the activity log entry point. The "Made-up data" banner stays visible in demo mode.
- **Pricing alignment.** BeliKongsi follows Orbyte's transaction model: free to join, with a fee only when a round succeeds (§26).

### 20. API contracts

- **Format.** JSON over HTTPS. Every endpoint except the public Kongsi Engine API needs the simulated Orbyte session cookie.
- **Responses.** Shaped for the caller's role (§15). Money is always an integer `…Sen` field. Times are ISO 8601 UTC.
- **Lists.** Paginated with a cursor and a limit (default 20, maximum 100).
- **Retries.** Endpoints that create payments or decisions accept an idempotency key.

**Session (simulated Orbyte identity)**

| Method and path | Who | Purpose |
|---|---|---|
| POST /api/session | anyone | Sign in as a seeded user (simulated SSO). Input: user id, provider. Output: user, memberships, active membership. |
| GET /api/session | signed in | Current user, memberships and active membership |
| POST /api/session/active-membership | signed in | Switch business and role. Input: membership id. |
| DELETE /api/session | signed in | Sign out |

**Catalogue and rounds**

| Method and path | Who | Purpose |
|---|---|---|
| GET /api/catalogue?q= | owner, staff, Ops | Search products by name, alias or shorthand. Owner and Ops: tiers, buy-alone price, current open round summary. Staff: names, packs and pictures only. |
| GET /api/rounds?status=open | owner, Ops | Open rounds with progress (total quantity, number of shops, current tier, units to next tier, cut-off) |
| GET /api/rounds/{roundId} | owner, Ops | Round detail. Owners see only their own participations, plus totals and counts. |
| GET /api/rounds/{roundId}/quote?quantity=&destination=&priceLimitSen= | owner | The "Why this price?" breakdown: starting and projected amounts, units to next tier, lowest tier that meets the limit, explanation text |
| POST /api/rounds/{roundId}/participations | owner | Join from the catalogue. Input: quantity, optional price limit, fulfilment and destination. Output: payment summary and checkout link (or immediate success when the balance covers it). |
| POST /api/participations/{id}/cancel | owner | Cancel before cut-off. Full refund to balance. 409 after cut-off. |
| GET /api/shops/{shopId}/participations?status= | owner | My Kongsi rounds and history |

**Usual list and settings**

| Method and path | Who | Purpose |
|---|---|---|
| POST /api/shops/{shopId}/usual-list/parse | owner | AI reading. Input: text. Output: suggestion run id, lines (product id or null, quantity, confidence, alternatives, note), ignored text. Nothing is saved. |
| GET /api/shops/{shopId}/usual-list | owner | Current usual list |
| PUT /api/shops/{shopId}/usual-list | owner | Confirm or replace the list. Input: items (product id, quantity, usual price, price limit), optional suggestion run id. Drafts this week's basket if none exists. |
| PATCH /api/shops/{shopId}/settings | owner | Default fulfilment (pickup point or door), with a quote preview |
| GET /api/pickup-points | owner, staff, Ops | Pickup points with coordinates and hours, sorted by distance from the active shop |

**Weekly basket**

| Method and path | Who | Purpose |
|---|---|---|
| GET /api/shops/{shopId}/baskets/current | owner, staff | This week's basket. Owners get the full money view; staff get products and quantities only. |
| POST /api/baskets/{basketId}/lines | owner, staff | Add an item. Input: product id, quantity. If this week's basket is no longer a draft, staff additions go to next week's draft. |
| PATCH /api/baskets/{basketId}/lines/{lineId} | owner, staff | Change the quantity (both), the price limit (owner) or remove the line (owner) |
| PATCH /api/baskets/{basketId}/fulfilment | owner | Pickup point or door for this week |
| POST /api/baskets/{basketId}/approve | owner | Approve and pay. Output: payment summary, balance applied, external amount, checkout link or immediate success. |
| POST /api/baskets/{basketId}/skip | owner | Skip this week (optional reason) |

**Payments and balance (simulated partner)**

| Method and path | Who | Purpose |
|---|---|---|
| GET /api/payments/{paymentId} | owner | Payment status and summary |
| POST /api/payments/{paymentId}/simulate | owner (from the simulated checkout page) | Simulated partner result. Input: outcome (succeeded or failed), method. Idempotent. |
| GET /api/payments/{paymentId}/receipt | owner | Receipt data |
| GET /api/shops/{shopId}/balance | owner | Balance and money history |
| POST /api/shops/{shopId}/balance/withdraw | owner | P1: simulated withdrawal |
| GET /api/shops/{shopId}/savings?month=YYYY-MM | owner | Estimated and verified savings, refunds, fees and delivery fees for the month |

**Pickups, delivery checks and claims**

| Method and path | Who | Purpose |
|---|---|---|
| GET /api/shops/{shopId}/pickups?status= | owner, staff | Upcoming and past pickups with destination, date, status and code |
| POST /api/pickups/{pickupId}/collect | owner, staff | Input: code. Marks the pickup collected (or delivered, for door). 422 if the code is wrong. |
| POST /api/pickups/{pickupId}/photos | owner, staff | Issues a signed upload URL and photo id (images only, at most 5 MB) |
| POST /api/pickups/{pickupId}/delivery-check | owner, staff | Input: lines (allocation id, received good, missing, damaged, photo ids). Creates a claim when there are issues. |
| GET /api/claims/{claimId} | owner, Ops | Claim detail (owner without other shops' data) |

**Approvals (Orbyte-style)**

| Method and path | Who | Purpose |
|---|---|---|
| GET /api/approvals?status=pending | owner, supplier, Ops | Pending requests for the active role |
| POST /api/approvals/{id}/approve | supplier, Ops | Approve. Input: note; for supplier confirmations, the expected dispatch date. (Basket approvals happen through the basket approve endpoint.) |
| POST /api/approvals/{id}/reject | supplier, Ops | Reject. Input: reason (required). |

**Supplier portal**

| Method and path | Who | Purpose |
|---|---|---|
| GET /api/suppliers/{supplierId}/orders?status= | supplier | Orders (product, total quantity, tier price, total, hub, dispatch date). No shop data. |
| POST /api/supplier-orders/{id}/dispatched | supplier | Mark dispatched to the hub |
| GET /api/suppliers/{supplierId}/rounds?status=open | supplier | Open round totals and shop counts for own products |
| GET /api/suppliers/{supplierId}/products | supplier | Products, tiers, buy-alone prices, schedules (P0 read-only) |
| GET /api/suppliers/{supplierId}/payouts | supplier | Simulated payouts |
| POST /api/suppliers/{supplierId}/products, PATCH …/products/{id} | supplier | P1: create and edit products, tiers and schedules (changes apply from the next round) |
| POST /api/suppliers/{supplierId}/price-list/parse | supplier | P1: AI reading of a price list (text or image) into a draft tier table |

**Ops**

| Method and path | Who | Purpose |
|---|---|---|
| GET /api/ops/rounds?status= | Ops | Rounds board |
| GET /api/ops/rounds/{roundId} | Ops | Participants with shop names, engine outcome, ledger summary, money check |
| POST /api/supplier-orders/{id}/hub-check?preview=true | Ops | Input: good units, damaged units, notes. With preview, returns the allocation and refunds only. |
| POST /api/supplier-orders/{id}/hub-check | Ops | Confirms: allocations, refunds, settlement, payout, consignments and pickups |
| GET /api/ops/consignments?status= | Ops | Consignments board (with map data) |
| POST /api/consignments/{id}/status | Ops | Partner simulation. Input: dispatched, arrived, out for delivery or delivered. Invalid transitions return 409. |
| GET /api/ops/money | Ops | Money overview and invariant results |
| GET /api/ops/events | Ops | Latest 100 integration events |
| POST /api/rounds/{roundId}/cancel | Ops | P1: emergency cancellation (reason required) |

**Activity log, notifications and demo**

| Method and path | Who | Purpose |
|---|---|---|
| GET /api/activity?subjectType=&subjectId=&cursor= | all roles | Role-filtered entries and timelines |
| POST /api/activity/verify | Ops | Recompute the hash chain. Output: valid with a count, or the first broken sequence. |
| GET /api/activity/export | Ops | P1: CSV export with filters |
| GET /api/notifications, POST /api/notifications/{id}/read | all roles | In-app notifications |
| GET /api/demo/state | all (demo mode) | Demo clock, basket week, featured round, banner text |
| POST /api/demo/skip-to-cutoff | all (demo mode) | Move the clock to the earliest cut-off + 1 minute and close due rounds |
| POST /api/demo/complete-other-rounds | all (demo mode) | Run the Ops, supplier, hub and consignment steps for every non-featured formed round |
| POST /api/demo/reset | all (demo mode) | Reseed everything and start a new log chain (target: under 10 seconds) |
| POST /api/jobs/run | scheduler (secret required) | Run all due jobs (idempotent) |

**Public Kongsi Engine API (stateless, reusable by other Orbyte apps)**

- No session is needed. A simulated Orbyte app credential header is accepted and logged. No data is stored.
- Requests are validated with the engine's own rules, and errors return 422 with a field list.
- The API is versioned in the path (v1) and documented in the README with example requests and responses.

| Method and path | Input | Output |
|---|---|---|
| POST /api/engine/v1/quote | tiers (minimum quantity, unit price in sen); fee basis points; unit shipping in sen; quantity; current round total; optional price limit | starting amounts; current tier and projected amounts; units to next tier and its price; lowest tier that meets the limit; explanation |
| POST /api/engine/v1/close-round | tiers; fee basis points; participants (reference, quantity, joined at, unit shipping, optional price limit, amount paid) | status (empty, failed or formed); final tier and unit price; iterations; per participant: outcome, unit amounts, final amount, refund, reason; totals |
| POST /api/engine/v1/allocate-shortfall | kept participants (reference, quantity, joined at, final unit amounts); good units received; final goods price | per participant: allocated, missing, refund; supplier payable; fee revenue; logistics payable; excess flag |

### 21. Integration events

- Events are written to an outbox table in the same transaction as the change they describe.
- P0 shows them on the Ops "Integration events" page. P1 delivers them to registered webhook URLs with a signature header and retries.
- Every event has: event id, type, version, occurred at and data. Data holds ids, quantities, amounts and statuses only, never names or contact details.

| Event type | Data |
|---|---|
| round.opened | round id, product id, supplier id, cut-off, tiers |
| round.closed | round id, outcome (empty, failed or formed), final tier, final unit price, total kept, number of shops |
| round.cancelled | round id, by (Ops or supplier), reason code |
| basket.drafted / basket.approved / basket.skipped / basket.expired | basket id, shop id, week, line count, amount (approved only) |
| participation.joined / participation.cancelled / participation.dropped | participation id, round id, shop id, quantity, outcome |
| refund.issued | shop id, amount, kind (difference, full, shortfall, claim, delivery fee), reference id |
| supplier_order.approved / .confirmed / .rejected / .dispatched | supplier order id, round id, supplier id, quantity, total |
| hub_check.recorded | supplier order id, good units, damaged units, shortfall |
| supplier_payout.released | supplier id, supplier order id, amount |
| consignment.status_changed | consignment id, hub id, destination type and id, status |
| pickup.ready / pickup.collected | pickup id, shop id, destination, date |
| delivery.checked | pickup id, shop id, result |
| claim.submitted / claim.decided | claim id, shop id, units, decision, refund amount |

### 22. Screens and UX rules

**Shared (Orbyte shell)**
- Simulated sign-in
- Top bar with business and role switcher and role badge
- "Made-up data" banner and demo controls (demo mode)
- Notification panel with WhatsApp previews and share links
- Approvals inbox
- Activity log and per-item timelines

**Owner**
- **Home:**
  - this week's basket card: status, amount now, estimated amount after cut-off, estimated savings, countdown, "Approve & pay"
  - next pickup card: place, date, code
  - savings this month
  - balance
  - pending approvals
- **Setup (3 steps):**
  1. Paste an order → review matches (highlights, alternatives, "not found" search) and add usual prices → confirm.
  2. Choose a pickup point (map and list) or door delivery (with a fee preview).
  3. Done. The basket is drafted.
  - Also: the plain-English data notice, and "Try with sample data".
- **Usual list:** quantities, usual prices, price limits; add through catalogue search.
- **Weekly basket:**
  - lines with starting price, projected price and savings, with staff changes highlighted
  - fulfilment switch
  - fee and delivery fee lines, balance used, amount to pay
  - "Approve & pay" and "Skip this week"
  - "Why this price?" sheet on each line
- **Open rounds (catalogue):** product cards with picture, pack, supplier, tier ladder, progress bar, shop count, cut-off countdown and your all-in price. Round detail. "Join" sheet: quantity, price limit, fulfilment.
- **Simulated checkout:** "Simulated" banner, DuitNow QR or FPX, success or failure. Receipt.
- **My Kongsi:** active participations, history, outcomes and refunds.
- **Pickups:** status tracker and codes.
- **Money:** balance and money history.
- **Savings:** the month's figures and per-round detail.
- **Settings:** default fulfilment.

**Staff**
- **Home:** only two big buttons, "Add to next basket" and "Confirm delivery", plus notifications.
- **Add to next basket:** search by any name, quantity stepper. Shows "Waiting for owner's approval".
- **Confirm delivery:** list of pickups → show code → "Collected" → check each line → "All received" or "Report a problem" (missing or damaged, with photos) → done.
- **My actions:** own log entries.

**Supplier**
- Orders list and order detail: confirm with dispatch date, reject with reason, mark dispatched.
- Open round totals.
- Products and tiers (read-only).
- Payouts.

**Ops**
- Approvals inbox (supplier orders, claims)
- Rounds board and round detail
- Hub check form with allocation preview
- Consignments board with status buttons, and the network map
- Claim review
- Money overview with checks
- Integration events
- Activity log with "Verify log"
- Demo controls

**UX rules**
- **Phone first.** Owner and staff screens are designed for 360–430 px widths and work one-handed; on desktop they sit in a centred phone-width column. Ops screens are responsive but optimised for a laptop, using tables.
- **Plain English.** No accounting or logistics jargon in owner and staff screens. Say "money history" (not "ledger"), "your goods" (not "allocation"), "minimum order" (not "MOQ").
- **Formats.** Currency as "RM 1,234.56", dates as "Thu 6 Nov, 8:00 pm". "Kongsi" is always capitalised.
- **Button labels:** "Approve & pay", "Skip this week", "Add to next basket", "Confirm delivery", "All received", "Report a problem", "Why this price?".
- **Accessibility.** Tap targets at least 44 px (48 px preferred); body text at least 16 px; tabular numbers for amounts; WCAG AA colour contrast; visible focus states; labels on every input.
- **States.**
  - Empty states explain what will appear, with an example.
  - Errors say what happened and what to do next.
  - Loading uses skeletons.
- **Honesty labels.**
  - "Simulated" on every payment, payout and partner screen.
  - "AI-generated image" on product pictures.
  - "Estimated" on savings until verified.
  - The "Made-up data" banner.
- **Performance targets.**
  - Owner home usable in under 2 seconds on a mid-range phone over 4G.
  - Reads under 500 ms (95th percentile).
  - Closing a round of 1,000 participations in the engine in under 200 ms.

### 23. Demo mode and synthetic data

**Network (synthetic)**
- **Hubs:**
  - Klang Valley hub (Shah Alam, Selangor), for dry goods and packaging
  - Johor hub (Senai, Johor), for eggs
- **Pickup points:** Ipoh (Perak), Johor Bahru (Johor), Kuantan (Pahang), Petaling Jaya (Selangor), Seremban (Negeri Sembilan), Melaka (Melaka). All open 10 am–7 pm daily.

**Suppliers and catalogue (synthetic, illustrative prices)**

The first tier is about 5–8% below the buy-alone price and the top tier about 12–18% below. Values are tuned with interview data before the final round.

| # | Supplier | Product | Unit | Weight | Buy-alone | Tier 1 | Tier 2 | Tier 3 | Cadence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Pembekal Barang Kering Contoh | Sweetened condensed milk 390 g | carton of 48 tins | 19.5 kg | RM 168.00 | 20+ RM 158.00 | 50+ RM 152.00 | 100+ RM 146.00 | weekly |
| 2 | Pembekal Barang Kering Contoh | Evaporated milk 390 g | carton of 48 tins | 19.5 kg | RM 150.00 | 20+ RM 141.00 | 50+ RM 136.00 | 100+ RM 131.00 | weekly |
| 3 | Pembekal Barang Kering Contoh | Cooking oil (palm olein) 17 kg | tin | 18.0 kg | RM 115.00 | 20+ RM 108.00 | 50+ RM 104.00 | 100+ RM 100.00 | weekly |
| 4 | Pembekal Barang Kering Contoh | Wheat flour 25 kg | sack | 25.0 kg | RM 68.00 | 20+ RM 63.00 | 50+ RM 60.50 | 100+ RM 58.00 | weekly |
| 5 | Pembekal Barang Kering Contoh | Coffee powder 1 kg | carton of 10 packs | 10.5 kg | RM 260.00 | 10+ RM 245.00 | 25+ RM 236.00 | 50+ RM 228.00 | weekly |
| 6 | Pembekal Barang Kering Contoh | Black tea dust 1 kg | carton of 10 packs | 10.5 kg | RM 180.00 | 10+ RM 170.00 | 25+ RM 164.00 | 50+ RM 158.00 | weekly |
| 7 | Ladang Telur Contoh | Grade A eggs | tray of 30 | 1.9 kg | RM 13.20 | 100+ RM 12.30 | 300+ RM 11.90 | 600+ RM 11.50 | weekly |
| 8 | Ladang Telur Contoh | Grade B eggs | tray of 30 | 1.8 kg | RM 12.60 | 100+ RM 11.70 | 300+ RM 11.30 | 600+ RM 10.90 | weekly |
| 9 | Pembungkusan Contoh | 16 oz plastic cups with lids | carton of 1,000 | 9.0 kg | RM 135.00 | 10+ RM 124.00 | 25+ RM 118.00 | 50+ RM 112.00 | fortnightly |
| 10 | Pembungkusan Contoh | 650 ml takeaway containers | carton of 500 | 11.0 kg | RM 98.00 | 10+ RM 90.00 | 25+ RM 86.00 | 50+ RM 82.00 | fortnightly |
| 11 | Pembungkusan Contoh | Plastic carrier bags (medium) | carton of 50 packs | 10.0 kg | RM 85.00 | 10+ RM 78.00 | 25+ RM 74.00 | 50+ RM 70.00 | fortnightly |
| 12 | Pembungkusan Contoh | Kraft paper bags | carton of 1,000 | 12.0 kg | RM 120.00 | 10+ RM 110.00 | 25+ RM 105.00 | 50+ RM 100.00 | fortnightly |

**Aliases (examples).** Each product carries English, Malay, Chinese and shorthand aliases, for example:
- condensed milk: "susu pekat", "炼奶", "SKM"
- evaporated milk: "susu cair", "淡奶", "evap"
- cooking oil: "minyak", "minyak masak", "油"
- flour: "tepung", "面粉"
- coffee powder: "kopi", "咖啡粉"
- tea dust: "teh", "茶"
- eggs: "telur A", "鸡蛋 A", "gred A"
- cups: "cawan 16oz", "杯"
- containers: "bekas tapau", "饭盒"
- carrier bags: "beg plastik", "塑料袋"
- paper bags: "beg kertas", "纸袋"

**Shops and users**

| Shop | Type and place | Fulfilment | Users | Seed state at reset |
|---|---|---|---|---|
| Kedai Kopi Contoh | kopitiam, Ipoh | pickup at the Ipoh pickup point | Ah Seng (owner), Rahim (staff) | No usual list yet: the demo starts with setup |
| Gerai Contoh | hawker stall, Johor Bahru | door delivery, about 6 km from the Johor Bahru pickup point (RM 12.00) | Siti (owner), Kumar (staff) | Usual list; this week's basket paid at 06:01 (includes 4 cartons of condensed milk) |
| Kafe Contoh | café, Kuantan | pickup at the Kuantan pickup point | Mei (owner), Danial (staff) | Usual list; basket paid at 06:03 (includes 3 cartons of condensed milk, and 10 trays of Grade B eggs with a usual price and limit of RM 12.20) |
| About 40 background shops | mixed types across all six regions | mixed | none (simulated) | Paid participations in 2–6 rounds each, joined the previous Friday to Sunday |

- **Other accounts:** one order-desk user per supplier, and one BeliKongsi Ops user.
- **Featured round:** condensed milk. At reset it has 99 cartons (background 92, Gerai Contoh 4, Kafe Contoh 3).
- **Other designed totals:** Grade B eggs at 130 trays, including Kafe Contoh's 10, so the dropout happens. Other rounds land on assorted tiers.
- **History:** a completed previous week (rounds, pickups, verified savings and log entries) for Gerai Contoh, Kafe Contoh and the background shops, so history screens aren't empty.
- **Demo clock at reset:** the most recent Monday 06:05 MYT. The current week is set up so that its packaging (fortnightly) rounds also close this Thursday.

**Demo script (about 4 minutes)**
1. **Owner, Kedai Kopi Contoh.** Sign in (simulated Microsoft). Setup:
   - Paste the sample order. AI suggestions appear, with one highlighted match to confirm.
   - Usual prices come pre-filled from the sample (condensed milk RM 165.00).
   - Pick the Ipoh pickup point on the map. Done.
   - The basket appears. Optional: switch to staff (Rahim) and add 1 carton of evaporated milk, which the owner sees highlighted.
2. **Owner.** Open "Why this price?" on condensed milk: "99 cartons so far, 1 more for RM 146.00". Approve & pay with simulated DuitNow QR, then view the receipt. The round shows 105 cartons, tier 3 reached.
3. **Presenter.** Skip to cut-off.
   - Owner notification: RM 73.44 refunded on condensed milk.
   - Switch to Kafe Contoh's owner: Grade B eggs dropped (limit RM 12.20 against RM 12.33), RM 123.30 refunded.
4. **Ops.** Approvals inbox → condensed milk order (105 cartons, RM 15,330.00, 9 shops, money check ✅) → Approve.
   - Switch to the supplier: confirm with a dispatch date, then mark dispatched.
   - Back to Ops: hub check (105 good) → allocation preview → confirm (simulated payout).
   - Presenter: "Complete other rounds".
   - Ops: mark the Ipoh consignments dispatched → arrived.
5. **Staff, Kedai Kopi Contoh.** Confirm delivery: show the code → Collected. Condensed milk: 1 damaged, with a photo. Everything else received. Submit.
6. **Ops.** Claim review → Approve. RM 151.85 refunded.
7. **Owner.** Home: verified savings, balance, the condensed milk timeline.
   - Ops: "Verify log" ✅ and the money overview ✅.

**Demo controls (visible in demo mode only):** role switcher, "Skip to cut-off", "Complete other rounds", "Reset demo data", "Use saved example" (when the AI fails), and the persistent "Made-up data" banner.

### 24. Security and secrets

- **The key file is never committed.** The plain-text key configuration document (API_Key_Configuration.md) is moved out of the repository folder before the first commit, and the ignore rules also cover it and every local environment file. Secret values never appear in code, docs, the README, logs, screenshots or this PRD.
- **Where secrets live.** Locally in an untracked environment file; in production in Vercel's environment variable settings, scoped to production only.
- **Server-only secrets.** The Supabase service role key, the database password and connection strings, the Gemini key, the NVIDIA key, the session signing secret and the job endpoint secret. None of them ever uses the framework's public (browser-exposed) environment variable prefix.
- **Browser-visible values.** Only the Google Maps key, restricted as in §18. The Supabase anon key isn't needed because the browser never calls Supabase directly. If it is ever used, row-level security still blocks it.
- **Not used by the app.** The Supabase personal access token (account-wide) is not stored in Vercel or the code.
- **Database.**
  - Row-level security is enabled on every table in exposed schemas, with no policies for anonymous or authenticated roles (deny by default).
  - The app connects from the server with its own database role.
  - The runtime role has no update or delete rights on the activity log or ledger tables.
- **Storage.** Product images are in a public bucket. Delivery photos are in a private bucket, reached only through short-lived signed URLs issued by the server after a permission check.
- **Sessions and requests.**
  - Signed, HTTP-only, Secure, SameSite=Lax cookies.
  - Same-origin checks on changing requests.
  - Rate limits on AI parsing (10 per shop per hour) and on sign-in.
  - Input size limits.
  - Uploads checked for type and size.
- **Jobs and demo controls.** The job endpoint needs a secret. Demo controls exist only when demo mode is on.
- **Repository hygiene.** GitHub secret scanning and push protection are on. Dependencies are checked with the package manager's audit before each demo.
- **Rotation.** If the key file was ever shared outside the team or committed, every key in it is regenerated. The database password is replaced with a randomly generated one before deployment.

### 25. Privacy and PDPA

The demo uses synthetic data only. A real deployment would apply Malaysia's PDPA like this:

| PDPA principle | BeliKongsi practice |
|---|---|
| General (consent and purpose) | Data is used only to run group orders, deliveries and refunds. The owner agrees to this at setup. |
| Notice and choice | A plain-English notice at setup says what is collected, why, who processes it (Supabase, Vercel, the AI provider, the payments and logistics partners) and how to stop. |
| Disclosure | No shop's identity or quantities are disclosed to other shops or to suppliers; suppliers see totals only. Integration events carry ids, not names. P2 supplier demand insights are opt-in and only shown as totals from 5 or more shops. |
| Security | Role-based access enforced on the server, encryption in transit and at rest, private photo storage, a record of who viewed what, secrets kept server-side (§24). |
| Retention | Delivery photos deleted after 90 days (P1 job). Order and money records kept for accounting periods, then archived. |
| Data integrity | AI suggestions are always confirmed by a person; owners can correct their usual list and settings at any time. |
| Access | Owners can see and export their data (P1) and request deletion (P1). |

- **Minimisation.** No customer data at all. Staff are a name and a role. Suppliers have work contacts only. BeliKongsi stores no bank or card details, because the payments partner handles them. Pasted order text is redacted before it reaches the AI provider (§16).
- **2024 PDPA amendments.** The plan includes:
  - a named data protection officer
  - a data breach response and notification procedure
  - data portability through the owner export
  - processors bound to security obligations by contract
  - transfers outside Malaysia only to providers with comparable protection, disclosed in the notice
- **Privacy limit.** In a round with only two shops, each could infer the other's quantity from the total, but never the other's identity (§15).

### 26. Business model and fees

- **For shops.** Free to join: no subscription, no per-user fees. BeliKongsi earns a **2% fee on the goods value of successful rounds only**, shown as its own line in every price breakdown. Failed or cancelled rounds cost nothing.
- **Delivery fees.** Passed through to the logistics partner at cost.
- **Suppliers.** Pay nothing at first; growing the catalogue matters more. P2 paid extras: promoted listings and opt-in, anonymous demand insights. These map to Orbyte's premium model.
- **Orbyte alignment.** This is Orbyte's transaction model ("charge when business happens"). The fee could later be settled through Orbyte's shared credit wallet (P2). Goods money stays separate from Orbyte credits.
- **Illustrative unit economics (synthetic).** A shop buying RM 2,000 of staples a month through BeliKongsi pays about RM 40 in fees. In the synthetic catalogue, tiers sit about 5–18% below buy-alone prices. Shipping shares are about 1–3% of the goods value for heavy goods over long distances. The app shows net savings after fees, shipping and delivery, so the claim stays honest.

### 27. Metrics

| Metric | How it is measured | Where it shows |
|---|---|---|
| Verified RM saved per shop per month | Savings rules (§6.10) | Owner home and savings screen (P0); pitch |
| % saved against the usual price | Verified savings ÷ (usual price × units) | Savings screen (P0) |
| Time to approve the weekly basket | Timestamps from opening the basket to successful payment (logged) | Pitch; P1 impact panel |
| Time saved per week | P1: the owner's self-reported old routine minus measured time | Savings screen (P1) |
| Money accuracy | Invariant checks passing (target: 100%); refund mismatches (target: 0) | Ops money overview (P0) |
| Count and split errors | 0 by construction: every quantity and split comes from the engine | Pitch |
| Round success rate, average tier reached, shops per round | Round outcomes | Ops rounds board (P0); pitch |
| Basket approval rate | Approved ÷ drafted baskets | P1 impact panel |
| Claim rate | Claimed units ÷ delivered units | Ops (P1) |
| AI accuracy | Accuracy set results; % of lines accepted unchanged | README; P1 impact panel |
| Supplier reliability | Confirmation time; good units ÷ ordered units | Ops (P1) |

### 28. Deployment and environments

- **Production.**
  - A Vercel project connected to the public GitHub repository, deploying from the main branch.
  - The provided Supabase project is the production database and storage.
  - Environment variables are set in Vercel, production-scoped only.
  - Preview deployments are turned off, or pointed at a separate database, so previews can never change the demo data.
- **Database access.** Prisma uses Supabase's pooled connection for the serverless runtime and a direct connection for migrations.
- **Schema changes.** Every schema change is a reviewed Prisma migration committed to the repository.
- **Local development and tests.** A local Postgres (for example Docker or the Supabase CLI local stack), never the production database. The automated tests use their own disposable test database.
- **Seeding and reset.** One deterministic seed routine creates the demo dataset. The same builders are used by the tests. "Reset demo data" runs it inside a transaction and should finish in under 10 seconds.
- **Scheduled jobs.** A Vercel Cron schedule calls the protected job endpoint (§7).
- **README contents.**
  - the problem
  - the solution
  - the five-step journey
  - an architecture overview
  - how to run locally
  - required environment variable names (never values)
  - how to seed and reset
  - the demo script
  - the Kongsi Engine API with examples
  - how to run the tests
  - the AI accuracy results
  - the synthetic-data and simulation notices
  - known limitations

---

## Testing Decisions

### What makes a good test here

- **It tests behaviour through a public interface.** Use the engine's operations, the HTTP API or the browser, never private functions or database internals. A test should still pass after any refactor that keeps behaviour the same.
- **It is deterministic.** Use a fixed clock, the seeded dataset or explicit builders, the fake AI adapter, and the simulated partners. Unit and API tests make no network calls.
- **Money is asserted exactly, in sen.** No tolerance and no floating point.
- **One behaviour per test, named in plain English** (e.g. "drops a shop whose price limit is below the final all-in price and refunds it in full"). Every rule in §6 and every edge case from the design session has at least one named example test, so the tests document the rules.
- **Asserts outcomes people can see:** statuses, amounts, balances, notifications, log entries and permission errors. Never "function X was called".

### Seams

These were agreed with the product owner during the design session. The fewer seams the better: the API seam is the main integration seam, the engine seam is the unit seam, and the end-to-end test is a single smoke test.

1. **Kongsi Engine** (pure, fastest, the most tests).
   - **Example tests:**
     - every worked example in §6.13 and the example week
     - tier validation errors
     - failed minimum
     - empty round
     - a multi-step price-limit cascade
     - the lowest tier that satisfies a limit
     - shortfall at the boundary participation
     - excess delivery capped
     - claim refund limits
     - savings with the usual-price baseline and with the buy-alone fallback (including negative savings)
     - rounding at half-sen boundaries
   - **Property tests** (fast-check) over thousands of generated rounds: random valid tier ladders, 0–200 participations, quantities 1–200, random optional price limits, random join times, unit shipping shares 0–1,000 sen and random good units received. They check:
     - money is conserved: paid = refunds + kept final amounts; after a shortfall, kept final amounts = settlement + shortfall refunds
     - the final price is never above the starting price
     - no kept participation's all-in price is above its limit
     - below the minimum, everyone is fully refunded
     - every amount is a non-negative integer
     - the same input always gives the same output
     - closing the outcome of a close changes nothing
     - shortfall allocation sums to min(received, ordered), respects join order, and its refunds equal missing × all-in
     - adding a participation with no limit never raises the final price
2. **Application API** (route handlers and services, against a real Postgres test database, with a fixed clock, the fake AI adapter and the simulated partners). Each scenario checks statuses, ledger balances (round hold back to zero), refunds, notifications for the right recipients, activity log entries and a valid hash chain.
   - **Scenarios:**
     - full happy path: setup → basket → pay → close → Ops approve → supplier confirm and dispatch → hub check → consignments → collect → check → claim → approve
     - round fails its minimum
     - price-limit dropout
     - Ops rejects
     - supplier rejects
     - hub shortfall with first-come allocation
     - claim approved and claim rejected
     - cancel before cut-off, and 409 after cut-off
     - payment failure and retry
     - balance covers the whole payment
     - delivery fee charged once per date and refunded when every door line is refunded
     - staff additions after the basket is paid go to next week
     - AI parse is validated: an invented id becomes "not found"
     - redaction removes phone numbers before the AI adapter is called
   - **Permissions:**
     - staff responses contain no price or amount fields
     - staff get 403 on pay, cancel, limits and fulfilment
     - suppliers never receive shop identifiers or names
     - owners get 404 for other shops' resources
     - only Ops can approve supplier orders, run hub checks, update consignments and decide claims
   - **Idempotency:** running "close due rounds", "draft baskets" and the payment simulate call twice changes nothing the second time; two concurrent closes produce one outcome.
   - **Log integrity:** "verify" passes after every scenario. A test that tampers with an entry using a privileged connection makes "verify" report the first broken sequence.
3. **End-to-end smoke test** (Playwright, phone-sized viewport, seeded demo, fake AI adapter in test mode). It follows the demo script (§23) and asserts the visible amounts: RM 984.54 paid, RM 73.44 refunded, RM 123.30 refunded to Kafe Contoh, RM 15,330.00 supplier order, RM 151.85 claim refund, RM 65.75 verified condensed milk savings. It also checks that "Verify log" and the money overview show ✅.

**AI accuracy set (not part of CI, because it calls the real API).**
- 20 messy sample orders covering:
  - Malay, Chinese and English mixed together; typos; emoji
  - units (ctn, 箱, kotak, papan, tin, pek); numbers written as words ("dua ctn")
  - greetings, names, phone numbers and delivery chatter
  - items not in the catalogue, which must come back as "not found"
  - ambiguous items (eggs with no grade, which must offer alternatives)
  - pack conversions (48 tins = 1 carton)
- Run before every demo against the configured Gemini model. Pass: at least 18 of 20 orders fully correct, and 0 invented product ids. Results are recorded in the README.

### Modules covered

| Module | Covered by |
|---|---|
| Kongsi Engine | engine example and property tests (deepest coverage) |
| Rounds, baskets, payments and ledger, supplier orders, fulfilment, delivery checks and claims, approvals, notifications, activity log, identity and permissions, savings, demo controls | API scenario tests |
| UI flows | the single end-to-end smoke test, plus manual demo rehearsal |
| Gemini adapter | AI accuracy set (manual); the fake adapter everywhere else |
| Payments and logistics adapters | contract tests through the API seam (statuses and quotes match the rate card) |
| Image generation | not automated (seed-time only, human-reviewed) |

### Tooling and prior art

- **Prior art.** The repository is new, so there are no existing tests to follow. Use standard Vitest, fast-check and Playwright conventions.
- **Shared builders.** The seed builders for shops, products, tiers, rounds and participations are shared by the tests and the demo seed, so stage numbers equal tested numbers.
- **CI (GitHub Actions) on every push and pull request.** Type check, lint, engine tests, then API tests against a Postgres service container. The end-to-end test runs on the main branch and before each demo.
- **Pre-demo checklist.**
  - the AI accuracy set
  - the end-to-end test against the deployed URL
  - "Reset demo data"
  - "Verify log" ✅
  - money overview ✅

---

## Out of Scope

**Ruled out by the brief (only simulated or prepared here)**
- Processing real payments, refunds, payouts or withdrawals. Holding real customer funds, and any e-money or payment licensing.
- Statutory filings: e-invoice submission (MyInvois), SST returns and other tax filings. Receipts are marked "not a tax invoice".
- Legal, tax or financial advice. Savings figures state facts only.
- Real personal, customer or company data. Everything is synthetic.

**Not built in this product (some appear later as P1 or P2)**
- Real Orbyte single sign-on, directory, approvals, notifications or audit trail (simulated behind interfaces).
- Real logistics partner bookings, tracking or proof of delivery; real pickup point systems.
- Sending real WhatsApp messages (previews and share links only).
- Credit terms or pay-later (P2: pay at cut-off for trusted shops).
- Fresh produce, perishables and cold chain; non-F&B categories and industries (P2).
- Malay and Chinese UI (P2). Native mobile apps; offline mode.
- Owner-led invitations, groups of neighbouring shops and supplier-posted deals (dropped or P2). Shop-to-shop messaging.
- Inventory management, stock counting and demand forecasting beyond the usual list.
- Price Radar, market price indexes and any comparison using other shops' prices.
- LeakCatch-style checking of invoices for purchases made outside BeliKongsi.
- Manager, Bookkeeper and multi-outlet roles (P2).
- Return logistics (sending goods back to suppliers) and legal dispute resolution beyond claims.
- Address geocoding and road-distance routing (P2). Real delivery-time estimates.
- Accounting software exports and tax invoices (P2, through partners).
- Replicating any Orbyte HR or admin function (leave, claims, overtime, attendance, hiring, eSign).

---

## Further Notes

### How BeliKongsi meets the Domain 2 must-haves

| Must-have | How BeliKongsi meets it |
|---|---|
| 1. One clear SME problem | Micro F&B shops overpay for weekly staples because organising group orders is recurring manual busywork. |
| 2. Core automated journey | Weekly basket (trigger) → usual list, tiers, round totals, quotes and balance (connected data) → Kongsi Engine rules (decision) → owner pays, Ops approves the supplier order, supplier confirms (human approval) → refunds, order, pickup code, delivery check and verified savings (outcome), all recorded in the activity log. |
| 3. Accuracy and ease of learning | Every count, split, price and refund is computed by tested rules. Money checks always pass. Plain English, two-button staff screen, 3-step setup, "Why this price?". |
| 4. People stay in control | Role permissions enforced on the server, staff never see prices, owner approval before spending, Ops approval before pooled money is committed, supplier confirmation, reasons for every rejection, a tamper-evident log. |
| 5. Orbyte fit and reuse | Built as an Orbyte module: shared sign-in, roles, approvals, notifications and audit trail; payments and logistics through Orbyte Connect partners; the Kongsi Engine API and events reusable by other Orbyte apps; works for any SME that restocks standard goods. |
| 6. Business benefit and SDG | Verified RM saved per shop per month, time to approve a weekly basket, zero count and split errors. SDG 8 (targets 8.2 and 8.3) and SDG 10. |

### Preliminary rubric mapping

| Criterion (weight) | What we show |
|---|---|
| Innovation & Creativity (30%) | A specific pain point; automatic weekly baskets instead of one-off group buys; anonymous nationwide pooling; AI used only to read messy mixed-language orders; not a chatbot, and not an HR or admin feature. |
| Problem-Solution Fit (25%) | One recurring burden removed; accuracy by construction; no training needed; people in control; fits Orbyte; reusable; stays inside the brief's boundaries (simulated payments, synthetic data). |
| Feasibility of Build (25%) | The full journey runs live from a public GitHub repository, on synthetic data with our own API assumptions. The hardest risk and its fallback are named (below). Nothing depends on the live Orbyte platform. |
| Clarity of Proposal (20%) | Problem → approach → expected outcome, with measurable benefits (RM saved, time to approve, zero errors). The proposal follows the organisers' format and length limits. |

### Good-to-have features

| Good-to-have | In BeliKongsi |
|---|---|
| Real-world validation | 3–5 short interviews with F&B owners before the preliminary submission (plan below). |
| Automatic triggers | Monday basket drafting, scheduled round closing and reminders, all with human approval. |
| Explainable decisions | "Why this price?", plain-English dropout and shortfall reasons, the approval evidence panel. |
| Reusable building block | The Kongsi Engine API (quote, close round, allocate shortfall) and integration events. |
| Business model | Free to join; a 2% fee only on successful rounds; suppliers free at first; matches Orbyte's transaction pricing. |
| Growth path | More categories (kedai runcit goods, fresh produce), other industries (salons, workshops, laundries), real partners through Orbyte Connect, and regional expansion in line with Orbyte's "regional SME ecosystem" horizon. |

### How it fits the Orbyte introduction

- **Shared platform capabilities used:**
  - identity and single sign-on
  - user management
  - roles and permissions
  - notifications
  - workflow and approvals
  - audit trail
  - documents (receipts, photos)
  - open APIs
  - mobile access
  - analytics (savings and round metrics)
- **Integrated partners (Orbyte's "Source 2"):** payments and collections, and logistics. Both are simulated behind adapters.
- **Open API ecosystem (Orbyte's "Source 3"):** the public Kongsi Engine API and events.
- **Pricing:** "Charge when business happens", using the transaction model with no per-seat fees.
- **Business Graph:** BeliKongsi adds supplier, product, order and delivery relationships to the context Orbyte connects.
- **Flywheel:** more shops → bigger rounds → better tiers → more suppliers → more products → more shops.
- **Roadmap fit:** partner-delivered business capability reached from Orbyte (phase 3), open ecosystem (phase 4), regional SME ecosystem (phase 6).
- **Not a closed suite, not an HR system, not a chatbot.**

### SDG contribution

- **SDG 8 (decent work and economic growth).** Target 8.2: higher productivity through technology (weekly ordering becomes one approval). Target 8.3: supports the growth of micro enterprises (lower input costs, less admin).
- **SDG 10 (reduced inequalities).** Micro shops get the wholesale prices that today only chains and large buyers get.
- **SDG 12** is left out unless we can measure an effect, such as fewer separate delivery trips.

### Risks and fallbacks

| Risk | Plan | Fallback |
|---|---|---|
| **Hardest build risk: the money must always be exact** (tiers, price limits, cancellations, refunds, shortfalls, claims) | All money logic lives in the Kongsi Engine. Amounts are whole sen. Property tests run thousands of random rounds, and the money checks run live on the Ops page. | If time runs short, cut P1 items (late or uncollected goods, reminders), never a money rule. |
| **Business risk: owners may not want to pay upfront** (most are used to cash on delivery or credit) | Test it in the interviews. Automatic refunds, price limits and the balance make prepaying feel safe. | P2: trusted repeat shops pay at cut-off. |
| **Supply risk: suppliers may not offer tier prices to an aggregator** | Pitch prepaid, consolidated orders with no credit risk. Start with distributors that already sell to micro shops. | Keep the catalogue to a few willing suppliers per category. |
| **Shipping can eat the savings for far-away shops** | All-in prices, price limits defaulting to the usual price, and honest net savings. | Raise or lower the minimum tiers per region; add regional suppliers. |
| **Demo risk: AI or the internet fails on stage** | Fake adapter in tests; accuracy set checked before each demo. | Catalogue form, "Use saved example", seeded data and "Reset demo data". Nothing depends on the live Orbyte platform. |
| **Scheduling precision on the hosting plan** | Idempotent jobs, also triggered on demand. | Demo controls run every step directly. |
| **Secret leakage from a public repository** | Key file never committed, secret scanning and push protection on, server-only secrets. | Rotate the keys immediately if anything leaks. |

### Validation plan (interviews)

- **Who:** 3–5 owners or managers of kopitiam, hawker stalls or small cafés. About 15 minutes each, before the preliminary submission.
- **Questions:**
  1. How do you restock today: which items, how often, through which channel?
  2. How long does ordering take each week, and what goes wrong?
  3. Have you ever ordered together with other shops? What happened?
  4. Would you pay upfront for a cheaper weekly basket if refunds were automatic? If not, what would make you?
  5. Pickup or delivery? How far would you travel to collect?
  6. Who receives goods at your shop, and should they see prices?
  7. What would you pay for this: a fee per successful order, or a monthly fee?
- **Use:** quotes and numbers go into the pitch; the answers tune the synthetic prices, tiers and fee. If interviews aren't possible in time, the pitch says so and relies on desk research.

### Submission checklist (preliminary round)

- [ ] Proposal follows problem → approach → expected outcome, names measurable benefits, and meets the organisers' format and length limits. These limits are not in the brief PDFs; confirm them on the organisers' Discord.
- [ ] Live demo of the core journey (§23), rehearsed against the deployed link.
- [ ] Public GitHub repository that matches the demo, with README, tests and the engine API docs.
- [ ] Hardest risk and fallback named. SDG contribution stated. PDPA handling explained briefly.
- [ ] Synthetic-data and "simulated" notices visible in the demo and the README.

### Open items to confirm during the build

- The exact Gemini model name, chosen from Google's current list at the start of the build (§16).
- The hosting plan's scheduled-job frequency, which doesn't affect correctness (§7).
- Calibrating synthetic prices, tiers and shipping rates with interview data.
- The proposal's format and length limits.

### Decision log (design session, 21 Oct 2026)

| # | Decision |
|---|---|
| Q1 | Lead the pitch with the burden of organising group orders; savings are the measurable result. |
| Q2 → Q10 | The core is automatic weekly rounds per product and supplier, with usual-list baskets and joining from the catalogue. "Start a Kongsi and invite neighbours" was dropped. |
| Q3 → Q17 | LeakCatch shrinks to the Kongsi delivery check: staff confirm receipt, report problems with photos, and units are refunded. |
| Q4 | First users: F&B micro businesses buying standard staples and packaging. No fresh produce. |
| Q5 → Q9 | BeliKongsi is the buyer. Shops pay upfront, no distance limit, anonymous buying, pickup or paid door delivery. |
| Q6 | A mobile-first web app inside a simulated Orbyte frame; WhatsApp is simulated. |
| Q7 | Team of 3–4 working in JS/TS, about 2–3 weeks; a full-stack prototype; P0/P1/P2 tags. |
| Q8 | Product name BeliKongsi; a group order is "a Kongsi"; the names KongsiBeli, BeliBijak and LeakCatch are retired. |
| Q11 | Pay the starting price on joining; automatic refund of the difference; full refunds for failed rounds, cancellations, price limits and rejections; BeliKongsi balance. |
| Q12 | Suppliers deliver to regional hubs; partners take goods to pickup points (no fee) or doors (fee); all-in prices. |
| Q13 | Shop roles: Owner and Staff only. |
| Q14 | Next.js + TypeScript, Supabase Postgres via Prisma, Tailwind + shadcn/ui, Vercel, scheduled jobs and a demo skip control. |
| Q15 | English-only UI. |
| Q16 | Roles outside the shop: Supplier (small portal) and BeliKongsi Ops. Hubs, pickup points and couriers are simulated partners. |
| Q18 | Savings = usual price − all-in price, with the buy-alone price as a labelled fallback. |
| Q19 | Free to join; 2% fee on successful rounds only; delivery fees passed through; suppliers free. |
| Q20 | Usual list by pasting a WhatsApp order (AI) with confirmation; catalogue form fallback. |
| Q21 | Orbyte fit: learn, integrate, govern, reuse (Kongsi Engine API and events). |
| Q22 | Manual weekly approval in P0; owner auto-approve rule in P1. |
| Q23 | No-training rules: two-button staff screen, owner home, "Why this price?", 3-step setup. |
| Q24 | SDG 8 (8.2, 8.3) and SDG 10; 3–5 owner interviews. |
| Q25 | Append-only, hash-chained activity log with role-based views. |
| Q26 | PDPA handling as in §25. |
| Q27 | Rules for things going wrong: failed minimum, price-limit cascade, supplier rejection, first-come shortfall, frozen prices; late delivery and uncollected goods in P1. |
| Q28 | AI only reads (P0 orders; P1 price lists and invoices) and never decides money. Provider: Gemini (from the key file). |
| Q29 | One demo story with "Contoh" shops, about 40 background shops, 3 suppliers, 12 products, 2 hubs and 6 pickup points. |
| Q30 | Hardest risk: exact money; business risk: paying upfront; demo risk: AI or network failure. |
| Q31 | Tests at three seams: engine (example and property), API lifecycle, one end-to-end smoke test, plus the AI accuracy set. |
| Key file | Gemini for AI reading; NVIDIA FLUX.2 Klein for seed-time product images; Google Maps for pickup maps; Supabase for database and storage; strict secret handling (§24). |

### What changed from the BeliBijak spec

- **KongsiBeli** became the whole product, now with BeliKongsi as the buyer, prepayment, hubs, pickup points and anonymous nationwide pooling.
- **LeakCatch** (invoice checking) was reduced to the Kongsi delivery check.
- **Price Radar** was dropped: there is no reliable price data without invoice checking. Owner-entered usual prices are used for savings and price limits instead.
- **Kept and adapted:** the approval center, the activity log (with the hash chain), notifications, the ease-of-learning rules, demo mode and synthetic data, PDPA handling, and Orbyte integration with open APIs.

### Naming and copy rules

- Product: **BeliKongsi**. A group order: **a Kongsi** ("Join this week's Kongsi", "Kongsi delivery check").
- Never use "KongsiBeli", "BeliBijak" or "LeakCatch" in the product, code or pitch.
- Every business, person and product brand in data, screenshots and the pitch is fictional. Businesses use the "… Contoh" pattern. No real brands, logos or bank branding.
- Tagline: "Beli sama-sama, harga borong" ("Buy together, pay wholesale").
