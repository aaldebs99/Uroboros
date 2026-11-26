import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

import { openSave, savesInWindow } from "./saveInWindow";

/**
 * A Save button (docs/downloads.md#saving-a-file): a plain download link, or in the installed iPhone
 * app (`savesInWindow`) a button that saves through a window of its own, sent to the save link `link`
 * makes. A URL that needs no session (a public link's) has no `link`: there it opens in a new window
 * as it is.
 */
export function SaveButton({
  href,
  link,
  children,
  ...button
}: Omit<ComponentProps<typeof Button>, "asChild" | "onClick"> & {
  href: string;
  link?: () => Promise<string>;
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
  if (link === undefined) {
    return (
      <Button {...button} asChild>
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      </Button>
    );
  }
  return (
    <Button
      {...button}
      onClick={() => {
        openSave(link);
      }}
    >
      {children}
    </Button>
  );
}
