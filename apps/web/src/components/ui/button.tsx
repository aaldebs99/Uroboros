import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** Buttons from the design system (references/actions-and-forms.md). */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] text-sm font-medium whitespace-nowrap transition-[background-color,color,box-shadow,filter] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        /** The one main action in a region. */
        primary: "bg-primary text-primary-foreground shadow-glow hover:brightness-110",
        /** Other actions. */
        secondary:
          "border border-border bg-card text-foreground shadow-[0_1px_2px_oklch(0.228_0.049_254.6/6%)] hover:bg-raised",
        /** Cancel, Select none, View all. */
        quiet: "bg-transparent text-primary hover:bg-raised",
        /** Remove, Delete, Cancel a download: a tonal fill, never solid red. */
        destructive: "bg-destructive/13 text-destructive hover:bg-destructive/20",
        /** Icon buttons in bars and ⋮: no fill until hovered. */
        ghost: "text-foreground hover:bg-accent hover:text-primary",
        /** A filled icon button. */
        icon: "bg-raised text-foreground hover:bg-accent hover:text-primary",
        /** A destructive icon button: stays danger on hover. */
        ghostDestructive: "text-destructive hover:bg-destructive/13",
      },
      size: {
        default: "h-11 px-5",
        compact: "h-9 px-3.5 text-[13px]",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
