import { ShieldCheck } from 'lucide-react';

/** The plain-English data notice shown at setup (PRD §25 "Notice and choice"). */
export function DataNotice() {
  return (
    <section
      aria-labelledby="data-notice-title"
      className="bg-card flex flex-col gap-2 rounded-2xl border p-4"
    >
      <h2 id="data-notice-title" className="flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck aria-hidden="true" className="text-primary size-5 shrink-0" />
        About your data
      </h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-base">
        <li>
          <strong>What BeliKongsi keeps:</strong> your shop&apos;s name and address, your usual list
          (products, quantities and prices), your Kongsi orders, payments and refunds, and a record
          of who did what. We keep no customer data and no bank or card details.
        </li>
        <li>
          <strong>Why:</strong> only to run your group orders, deliveries and refunds.
        </li>
        <li>
          <strong>Who handles it for us:</strong> Supabase (our database and photo storage), Vercel
          (our website host), the AI provider that reads your pasted order, and our payments and
          logistics partners. Some of them may keep data outside Malaysia, with similar protection.
        </li>
        <li>
          <strong>Your pasted order:</strong> phone numbers, email addresses and IC numbers are
          removed before the AI sees the text, so please leave out people&apos;s names. We keep that
          cleaned text with the AI&apos;s suggestions as a record. The AI only suggests: nothing
          goes on your usual list until you confirm.
        </li>
        <li>
          <strong>How to stop:</strong> you can stop at any step. Later you can change or empty your
          usual list, skip any week, or ask BeliKongsi to delete your shop&apos;s data.
        </li>
      </ul>
      <p className="text-muted-foreground text-base">
        By confirming your usual list, you agree to this.
      </p>
    </section>
  );
}
