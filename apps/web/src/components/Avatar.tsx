import { cn } from "@/lib/utils";

/** A round avatar: the name's initial on `bg-raised` until real pictures exist. */
export function Avatar({ name, className }: { name: string | null; className?: string }) {
  const initial = (name ?? "").trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full bg-raised text-sm font-medium text-foreground",
        className,
      )}
    >
      {initial}
    </span>
  );
}
