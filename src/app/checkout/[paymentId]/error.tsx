'use client';

import { PageError } from '@/components/common/page-error';
import { PhoneColumn } from '@/components/common/phone-column';

export default function CheckoutError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main id="main" className="flex min-h-screen flex-col px-4 py-5">
      <PhoneColumn>
        <PageError retry={retry} />
      </PhoneColumn>
    </main>
  );
}
