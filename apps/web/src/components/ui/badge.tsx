import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** An outlined pill: a 45% tone border, tone text, no fill and no dot. */
const badgeVariants = cva(
  "inline-flex h-5.5 w-fit shrink-0 items-center gap-1 rounded-full border border-current/45 px-2 text-[0.71875rem] font-medium whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      tone: {
        primary: "text-primary",
        success: "text-success",
        warning: "text-warning",
        destructive: "text-destructive",
        muted: "text-muted-foreground",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants, type BadgeTone };
