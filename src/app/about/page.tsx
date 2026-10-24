import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Wordmark } from '@/components/shell/brand-mark';

export const metadata: Metadata = {
  title: 'About BeliKongsi',
  description:
    'What BeliKongsi is for, how a Kongsi works, how it fits Orbyte, and what is simulated.',
};

const JOURNEY: { step: string; inBeliKongsi: string }[] = [
  {
    step: '1. Trigger',
    inBeliKongsi:
      'Every Monday at 06:00 (Malaysia time) a weekly basket is drafted from each shop’s usual list. Owners can also join any open round by hand.',
  },
  {
    step: '2. Connected data',
    inBeliKongsi:
      'The usual list (items, quantities, usual prices, price limits), the supplier’s price tiers, live round totals, shipping and delivery quotes from the logistics partner, and the shop’s BeliKongsi balance.',
  },
  {
    step: '3. Decision logic',
    inBeliKongsi:
      'The Kongsi Engine applies fixed rules: which price tier was reached, each shop’s all-in price, price-limit dropouts, refunds and short-delivery allocation. AI makes no decisions.',
  },
  {
    step: '4. Human approval',
    inBeliKongsi:
      'The owner approves and pays the basket. Ops approves the consolidated supplier order. The supplier confirms it. Ops decides claims.',
  },
  {
    step: '5. Visible outcome and log',
    inBeliKongsi:
      'The final price and refunds are shown and notified, the order is placed, a pickup code is issued, the delivery is checked and verified savings appear. Every step is in the hash-chained activity log.',
  },
];

const PRIVACY: { principle: string; practice: string }[] = [
  {
    principle: 'Consent and purpose',
    practice:
      'Data is used only to run a Kongsi: group orders, deliveries and refunds. The owner agrees to this at setup.',
  },
  {
    principle: 'Notice and choice',
    practice:
      'A plain-English notice at setup says what is collected, why, who processes it and how to stop.',
  },
  {
    principle: 'Disclosure',
    practice:
      'No shop’s identity or quantities are shown to other shops or to suppliers. Suppliers see totals only, and integration events carry ids, not names.',
  },
  {
    principle: 'Security',
    practice:
      'Access by role is enforced on the server, data is encrypted in transit and at rest, delivery photos are kept private, and secrets stay on the server.',
  },
  {
    principle: 'Retention',
    practice:
      'Delivery photos are deleted 90 days after upload. Order and money records are kept for accounting periods, then archived.',
  },
  {
    principle: 'Data integrity',
    practice:
      'AI suggestions are always confirmed by a person, and owners can correct their usual list and settings at any time.',
  },
  {
    principle: 'Access',
    practice: 'Owners can see and export their data and ask for it to be deleted.',
  },
];

const SIMULATED: { name: string; text: string }[] = [
  {
    name: 'Payments',
    text: 'Checkout and its results are simulated. No real money moves and no card or bank details are stored.',
  },
  { name: 'Payouts', text: 'Supplier payouts and their references are simulated.' },
  {
    name: 'Logistics',
    text: 'Delivery quotes come from a made-up rate card, and Ops clicks the consignment statuses.',
  },
  {
    name: 'Sign-in',
    text: '“Continue with Microsoft” and “Continue with Google” are simulated, and there are no passwords.',
  },
  {
    name: 'WhatsApp',
    text: 'Messages appear as previews and share links. Nothing is sent.',
  },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="flex scroll-mt-6 flex-col gap-4 border-t pt-8 first:border-t-0 first:pt-0"
    >
      <h2 id={id} className="text-2xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

const CONTENTS = [
  { id: 'problem', title: 'The problem' },
  { id: 'journey', title: 'The five-step journey' },
  { id: 'orbyte', title: 'How it fits Orbyte' },
  { id: 'sdg', title: 'SDG contribution' },
  { id: 'privacy', title: 'Privacy (PDPA)' },
  { id: 'simulated', title: 'What’s simulated' },
] as const;

const PROSE = 'max-w-[68ch] text-base leading-relaxed';
const BULLETS =
  'marker:text-accent flex max-w-[68ch] list-disc flex-col gap-2.5 pl-5 text-base leading-relaxed';

/** Terms and explanations divided by hairlines, rather than one box per row. */
function TermList({ rows }: { rows: { term: string; text: string }[] }) {
  return (
    <dl className="bg-card divide-y rounded-2xl border">
      {rows.map((row) => (
        <div key={row.term} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[11rem_1fr] sm:gap-4">
          <dt className="text-base font-semibold">{row.term}</dt>
          <dd className="text-muted-foreground text-base">{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-topbar text-topbar-foreground">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 pt-4 pb-10 sm:px-6 lg:pb-14">
          <div className="flex items-center justify-between gap-3">
            <Wordmark />
            <Link
              href="/sign-in"
              className="text-topbar-muted inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-base font-semibold underline outline-none hover:text-white focus-visible:ring-3 focus-visible:ring-white"
            >
              <ArrowLeft aria-hidden className="size-4" />
              Back to sign in
            </Link>
          </div>
          <div className="flex max-w-2xl flex-col gap-3">
            <h1 className="text-4xl leading-[1.1] font-bold text-white sm:text-5xl">
              About BeliKongsi
            </h1>
            <p className="text-topbar-muted text-lg leading-relaxed">
              <span lang="ms" className="text-accent font-semibold">
                Beli sama-sama, harga borong.
              </span>{' '}
              Buy together, pay wholesale. A group order is called a Kongsi.
            </p>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1 px-4 py-8 sm:px-6 lg:py-12">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-8">
              <p className="text-muted-foreground mb-2 text-sm font-semibold">On this page</p>
              <ul className="flex flex-col border-l">
                {CONTENTS.map((c) => (
                  <li key={c.id}>
                    <a
                      href={`#${c.id}`}
                      className="text-muted-foreground hover:border-primary hover:text-foreground focus-visible:ring-ring/60 -ml-px block border-l-2 border-transparent py-1.5 pl-3 text-base no-underline outline-none focus-visible:ring-3"
                    >
                      {c.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
          <div className="flex min-w-0 flex-col gap-10">
            <Section id="problem" title="The problem">
              <ul className={BULLETS}>
                <li>
                  <strong>It is a recurring job.</strong> Micro food and drink businesses restock
                  the same shelf-stable staples and packaging every week or two.
                </li>
                <li>
                  <strong>Their orders are too small for wholesale prices.</strong> Each shop orders
                  below suppliers’ minimum order quantities and cheaper price tiers, so it pays the
                  buy-alone price, often through middlemen or cash-and-carry stores.
                </li>
                <li>
                  <strong>Buying together would fix it, but organising it is busywork.</strong>{' '}
                  Pooling orders means collecting quantities over WhatsApp, adding them up,
                  negotiating, splitting deliveries and bills, collecting money and chasing late
                  payers, every cycle.
                </li>
                <li>
                  <strong>So it rarely happens, and when it does, it goes wrong.</strong> Manual
                  tallies and splits cause short deliveries, overpayments and arguments. There is no
                  shared record of who ordered, paid or received what.
                </li>
                <li>
                  <strong>Today’s tools don’t help.</strong> WhatsApp groups, paper and spreadsheets
                  don’t track price tiers, hold money, split deliveries or keep a record.
                </li>
                <li>
                  <strong>The people involved are busy.</strong> Owners decide and pay. Workers
                  receive the goods and shouldn’t see prices. Nobody has time for training.
                </li>
                <li>
                  <strong>Privacy matters.</strong> Nearby shops are often competitors. They don’t
                  want others to see what they buy or what they pay.
                </li>
              </ul>
            </Section>

            <Section id="journey" title="The five-step journey">
              <ol className="flex flex-col">
                {JOURNEY.map((row, i) => (
                  <li
                    key={row.step}
                    className="relative grid grid-cols-[2.25rem_1fr] gap-4 pb-6 last:pb-0"
                  >
                    {i < JOURNEY.length - 1 ? (
                      <span
                        aria-hidden
                        className="bg-border absolute top-10 bottom-1 left-[1.07rem] w-0.5"
                      />
                    ) : null}
                    <span
                      aria-hidden
                      className="bg-primary text-primary-foreground grid size-9 place-items-center rounded-full text-base font-bold tabular-nums"
                    >
                      {i + 1}
                    </span>
                    <div className="pt-1">
                      <h3 className="text-lg font-semibold">
                        <span className="sr-only">{i + 1}. </span>
                        {row.step.replace(/^\d+\.\s*/, '')}
                      </h3>
                      <p className="text-muted-foreground mt-1 max-w-[64ch] text-base leading-relaxed">
                        {row.inBeliKongsi}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>

            <Section id="orbyte" title="How it fits Orbyte">
              <p className={PROSE}>
                BeliKongsi is built as a connected app inside the Orbyte hub, not a closed suite. It
                reuses the shared platform and adds supplier, product, order and delivery
                relationships to what Orbyte already connects.
              </p>
              <ul className={BULLETS}>
                <li>
                  <strong>Shared platform:</strong> sign-in, roles and permissions, approvals,
                  notifications and the audit trail.
                </li>
                <li>
                  <strong>Partners:</strong> payments and logistics are reached through partner
                  interfaces. Both are simulated here, so a real partner can replace them without
                  changing the business rules.
                </li>
                <li>
                  <strong>Engine API:</strong> the Kongsi Engine, which holds the pricing rules, has
                  a public API that other apps can call.
                </li>
                <li>
                  <strong>Webhooks:</strong> other Orbyte apps can subscribe to BeliKongsi events
                  and receive each one as a signed message, with automatic retries. Events carry
                  ids, quantities, amounts and statuses only, never names or contact details.
                </li>
              </ul>
            </Section>

            <Section id="sdg" title="SDG contribution">
              <ul className={BULLETS}>
                <li>
                  <strong>SDG 8, decent work and economic growth.</strong> Target 8.2: higher
                  productivity through technology, as weekly ordering becomes one approval. Target
                  8.3: support for the growth of micro enterprises, with lower input costs and less
                  admin.
                </li>
                <li>
                  <strong>SDG 10, reduced inequalities.</strong> Micro shops get the wholesale
                  prices that today only chains and large buyers get.
                </li>
              </ul>
            </Section>

            <Section id="privacy" title="Privacy (PDPA)">
              <p className={PROSE}>
                This demo uses made-up data only. A real deployment would follow Malaysia’s PDPA
                like this.
              </p>
              <TermList rows={PRIVACY.map((r) => ({ term: r.principle, text: r.practice }))} />
            </Section>

            <Section id="simulated" title="What’s simulated">
              <p className={PROSE}>
                This is a demonstration. Every business in it is fictional, and the data is{' '}
                <strong>Made-up data</strong>. These parts are <strong>Simulated</strong>:
              </p>
              <TermList rows={SIMULATED.map((r) => ({ term: r.name, text: r.text }))} />
            </Section>
          </div>
        </div>
      </main>
    </div>
  );
}
