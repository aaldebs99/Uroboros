import { cn } from "@/lib/utils";

/** A loading placeholder in the content's shape; the region around it sets `aria-busy`. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("shimmer rounded-full bg-raised", className)} />;
}

/** A video tile's placeholder: the 16:9 block, the avatar and two text bars. */
export function TileSkeleton() {
  return (
    <div aria-hidden className="grid gap-3">
      <Skeleton className="aspect-video rounded-[12px]" />
      <div className="flex gap-3">
        <Skeleton className="size-9 shrink-0" />
        <div className="grid flex-1 gap-2 pt-1">
          <Skeleton className="h-3 w-[90%]" />
          <Skeleton className="h-3 w-[60%]" />
        </div>
      </div>
    </div>
  );
}
