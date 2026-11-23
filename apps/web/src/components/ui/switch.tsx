import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border border-border bg-raised transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:opacity-45 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:shadow-glow",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-muted-foreground transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-white" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
