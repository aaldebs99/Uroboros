import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

import { openOutside, openSave, savesInWindow } from "./saveInWindow";

/**
 * A Save button (docs/downloads.md#saving-a-file): a plain download link, or in the installed iPhone
 * app (`savesInWindow`) a button that hands the file to Safari through a save link, registered with
 * `link`. A URL that needs no session (a public link's) has no `link`: it is handed over as it is.
 */
export function SaveButton({
  href,
  link,
  children,
  ...button
}: Omit<ComponentProps<typeof Button>, "asChild" | "onClick"> & {
  href: string;
  link?: (token: string) => Promise<unknown>;
}) {
  if (!savesInWindow()) {
    return (
      <Button {...button} asChild>
        <a href={href} download>
          {children}
        </a>
      </Button>
    );
  }
  return (
    <Button
      {...button}
      onClick={() => {
        if (link === undefined) openOutside(new URL(href, window.location.origin).href);
        else openSave(link);
      }}
    >
      {children}
    </Button>
  );
}
