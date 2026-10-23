'use client';

import { PageError } from '@/components/common/page-error';

export default function ShellError({ retry }: { error: unknown; retry: () => void }) {
  return <PageError retry={retry} />;
}
