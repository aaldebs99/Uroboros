import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const chip =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium focus-visible:ring-[3px] focus-visible:ring-ring/45 focus-visible:outline-none";

export function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(chip, pressed ? "bg-foreground text-background" : "bg-raised hover:bg-accent")}
    >
      {children}
    </button>
  );
}

/** An active filter the person can drop. */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove filter: ${label}`}
      onClick={onRemove}
      className={cn(chip, "bg-foreground text-background")}
    >
      {label}
      <X className="size-4" aria-hidden />
    </button>
  );
}

/** The chips, scrolling sideways when they don't fit (`min-w-0` lets a flex row shrink it). */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div role="toolbar" aria-label="Filter" className="flex min-w-0 gap-2 overflow-x-auto">
      {children}
    </div>
  );
}
