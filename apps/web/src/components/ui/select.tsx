import { ChevronDown } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** A native `<select>` drawn as a box, with a chevron; the native popup and keys stay. */
function Select({
  className,
  compact = false,
  ...props
}: React.ComponentProps<"select"> & { compact?: boolean }) {
  return (
    <span className={cn("relative inline-flex min-w-0", className)}>
      <select
        data-slot="select"
        className={cn(
          "w-full min-w-0 appearance-none rounded-[0.625rem] border border-border bg-card pr-9 pl-3.5 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 disabled:opacity-45",
          compact ? "h-9 text-[0.8125rem]" : "h-11",
        )}
        {...props}
      />
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </span>
  );
}

export { Select };
