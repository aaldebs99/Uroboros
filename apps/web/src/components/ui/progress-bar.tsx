import { cn } from "@/lib/utils";

/** The design system's thick glowing bar, for a real percentage only. */
export function ProgressBar({
  label,
  percent,
  className,
}: {
  /** Names it for screen readers ("<title> progress"). */
  label: string;
  /** 0 to 100. */
  percent: number;
  className?: string;
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn("h-2 overflow-hidden rounded-full bg-raised", className)}
    >
      <div
        className="h-full rounded-full bg-linear-to-r from-primary-strong to-primary shadow-[0_0_0.75rem] shadow-primary/60 transition-[width]"
        style={{ width: `${String(value)}%` }}
      />
    </div>
  );
}
