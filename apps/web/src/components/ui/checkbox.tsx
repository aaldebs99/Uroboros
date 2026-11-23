import { Check } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** A native checkbox drawn at 18px; the check glows when ticked. */
function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <span className={cn("relative inline-grid size-[18px] shrink-0 place-items-center", className)}>
      <input
        type="checkbox"
        data-slot="checkbox"
        className="peer size-[18px] cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-muted-foreground outline-none checked:border-primary checked:bg-primary checked:shadow-[0_0_10px] checked:shadow-primary/45 focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:opacity-45"
        {...props}
      />
      <Check
        className="pointer-events-none absolute size-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100"
        strokeWidth={3}
        aria-hidden
      />
    </span>
  );
}

export { Checkbox };
