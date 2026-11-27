import { EyeOff } from "lucide-react";

import { errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";

/**
 * Hide from library, for a playlist or a channel: pressed, its videos stay out of Library › Videos
 * and Audio until it is pressed again (docs/library.md "Hiding from the library"). `toggle` asks
 * the server for the new state; the toast says what came of it.
 */
export function HideFromLibraryButton({
  hidden,
  pending,
  toggle,
}: {
  hidden: boolean;
  pending: boolean;
  toggle: (hidden: boolean) => Promise<unknown>;
}) {
  return (
    <Button
      variant="secondary"
      aria-pressed={hidden}
      disabled={pending}
      onClick={() => {
        toggle(!hidden).then(
          () => {
            notify.success(
              hidden
                ? "Its videos show in your library again."
                : "Its videos are hidden from your library.",
            );
          },
          (error: unknown) => {
            notify.error(errorText(error));
          },
        );
      }}
    >
      <EyeOff aria-hidden /> Hide from library
    </Button>
  );
}
