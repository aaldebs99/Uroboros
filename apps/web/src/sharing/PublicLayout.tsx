import type { ReactNode } from "react";

import { Brand } from "@/components/Brand";
import { Toaster } from "@/components/ui/sonner";

/** A public link's frame: the brand mark and the page, without the app's navigation or account. */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page-glow min-h-dvh">
      <header className="flex h-12 items-center px-4 md:h-14">
        <Brand />
      </header>
      <main className="grid grid-cols-1 px-4 pb-8 md:px-6">{children}</main>
      <Toaster />
    </div>
  );
}
