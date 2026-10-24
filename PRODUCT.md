# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Owners** of Malaysian micro F&B businesses (kopitiam, hawker stalls, small cafés). Busy, mixed digital confidence, on a phone in the shop. They approve and pay one weekly basket.
- **Staff** of those shops. Two jobs: add to next basket, confirm delivery. Never see prices.
- **Suppliers** (distributors). Receive one prepaid consolidated order per round; manage products and price tiers.
- **BeliKongsi Ops.** Approve supplier orders, check deliveries at the hub, decide claims, prove the money balances. Work at desktop widths.
- **Hackathon judges** (SDC Hackathon, Domain 2, Orbyte Smart SME Challenge) are the audience this pass optimises for: demo on a laptop or projector, while staying credible as a phone app for owners.

## Product Purpose

Group buying for micro food businesses, built as a module of the Orbyte business hub. Weekly restocking becomes one approval: the usual list becomes a weekly basket, shops pool orders into a Kongsi round, the combined quantity reaches a cheaper price tier, and every unit paid for is delivered or refunded.

## Positioning

BeliKongsi is the buyer: it collects payment, places one consolidated order at the tier the combined quantity reaches, and keeps shops anonymous to each other and to suppliers. Everyone in a round pays the same final price; overpayment returns automatically to the shop's balance.

## Operating Context

Owner and staff screens are phone-first (a centred 430px column on wider screens). Ops and supplier screens use a wide layout. Demo mode always shows a non-dismissible "Made-up data" banner. Sign-in is a simulated Orbyte sign-in that lists seeded accounts.

## Capabilities and Constraints

- Terminology is fixed by the PRD glossary (Kongsi, round, cut-off, price tiers, all-in unit price, usual list, weekly basket, pickup code, BeliKongsi balance). UI copy uses these exact meanings.
- Synthetic data only; every business is named "… Contoh". Payments, payouts, logistics, sign-in and WhatsApp are simulated and labelled as such.
- AI only reads messy text into drafts a person confirms; rules decide prices and refunds.
- Stack: Next.js App Router, Tailwind v4, shadcn primitives, lucide icons, Geist.

## Brand Commitments

- Name "BeliKongsi"; tagline "Beli sama-sama, harga borong · Buy together, pay wholesale."
- Incumbent identity confirmed for refinement (Oct 2026): cream ground, teal primary, amber accent, navy top bar.
- Plain English, few screens, big buttons, phone first.

## Evidence on Hand

PRD.md, README.md and the About page hold the product truth. There are no real customers, testimonials or metrics; never invent them. Price examples must be labelled as examples.

## Product Principles

1. One approval a week.
2. Buy together, stay anonymous.
3. Honest all-in prices, explained ("Why this price?").
4. Delivered or refunded.
5. People stay in control; AI reads, rules decide.

## Accessibility & Inclusion

16px minimum body text and 48px tap targets on owner and staff screens, visible keyboard focus, WCAG AA contrast. Users have mixed digital confidence and no training.
