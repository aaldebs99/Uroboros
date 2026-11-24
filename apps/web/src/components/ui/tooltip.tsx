import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

/**
 * Names an icon-only control on hover and keyboard focus (never on touch, where its `aria-label`
 * does the work): a small dark label under it. The other props and the ref go to the trigger, so
 * it can sit inside another `asChild` trigger (a menu's).
 */
export function Tooltip({
  label,
  side = "bottom",
  children,
  ...trigger
}: {
  label: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
} & Omit<ComponentProps<typeof TooltipPrimitive.Trigger>, "children" | "asChild">) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild {...trigger}>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="z-50 rounded-[0.5rem] bg-overlay px-2 py-1 text-xs font-medium text-overlay-foreground shadow-menu data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
