import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Owner and staff screens: full width on a phone, a centred 430 px column on anything wider. */
export function PhoneColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[430px]', className)}>{children}</div>;
}
