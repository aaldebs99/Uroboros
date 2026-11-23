import { Check, ChevronRight } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const contentClasses =
  "z-50 min-w-56 overflow-hidden rounded-[0.75rem] bg-popover py-2 text-popover-foreground shadow-menu data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0";
const itemClasses =
  "relative flex cursor-default items-center gap-3 px-4 py-2.5 text-sm outline-none select-none focus:bg-raised data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-4.5 [&_svg]:shrink-0";

function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(contentClasses, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(itemClasses, destructive && "text-destructive", className)}
      {...props}
    />
  );
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        itemClasses,
        "pr-10 data-[state=checked]:bg-accent data-[state=checked]:text-primary",
        className,
      )}
      {...props}
    >
      {children}
      <DropdownMenuPrimitive.ItemIndicator className="absolute right-4">
        <Check aria-hidden />
      </DropdownMenuPrimitive.ItemIndicator>
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(itemClasses, "data-[state=open]:bg-raised", className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" aria-hidden />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        className={cn(contentClasses, "min-w-44", className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("px-4 py-2 text-sm font-medium", className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("my-2 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
