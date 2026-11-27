import { type ReactNode, useState } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { fullTime } from "./format";

/**
 * A relative time ("2 minutes ago") that shows the real date and time, in the viewer's own time
 * zone (`fullTime`), on hover, and swaps to it when clicked (and back on another click); swapped,
 * its tooltip says the relative time.
 */
export function At({
  iso,
  className,
  children,
}: {
  iso: string;
  className?: string;
  children: ReactNode;
}) {
  const [real, setReal] = useState(false);
  const full = fullTime(iso);
  return (
    <Tooltip label={real ? children : full}>
      <button
        type="button"
        aria-pressed={real}
        className={cn(
          "cursor-pointer rounded-[0.25rem] text-left outline-none hover:underline focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45",
          className,
        )}
        onClick={() => {
          setReal((r) => !r);
        }}
      >
        <time dateTime={iso}>{real ? full : children}</time>
      </button>
    </Tooltip>
  );
}
