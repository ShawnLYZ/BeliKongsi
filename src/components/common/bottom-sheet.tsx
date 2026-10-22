'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * A sheet that slides up from the bottom, as wide as the phone column. It has a 48 px close button
 * and 16 px text (G9); focus is trapped while it is open and returns to the trigger afterwards.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line under the title; screen readers announce it with the title. */
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="bg-card text-card-foreground mx-auto max-h-[90vh] w-full max-w-[430px] gap-0 overflow-y-auto rounded-t-2xl text-base"
      >
        <SheetHeader className="flex-row items-start justify-between gap-3 p-4 pb-2">
          <div className="flex flex-col gap-1">
            <SheetTitle className="text-xl font-bold">{title}</SheetTitle>
            <SheetDescription className="text-muted-foreground text-base">
              {description}
            </SheetDescription>
          </div>
          <SheetClose className="hover:bg-muted focus-visible:ring-ring/60 -mt-1 -mr-1 inline-flex size-12 shrink-0 items-center justify-center rounded-xl outline-none focus-visible:ring-3">
            <X aria-hidden="true" className="size-6" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
